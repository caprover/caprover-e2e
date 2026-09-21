import { expect, test } from 'vitest'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
} from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { routingSourceArchive } from '../src/helpers/source-fixture'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const ROUTING_MARKER = 'caprover-routing-fixture'

test('container port, exposure, HTTP auth, redirect, and WebSocket routing', async () => {
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { initialAppName: name, runId } = createTestNames()
        const api = context.caprover
        const url = `http://${name}.${rootDomain}`

        cleanUpApp(context, cleanup, name)
        await api.createApp(name)
        await api.updateApp(name, { containerHttpPort: 8080 })
        const version = nextVersion(await api.getApp(name))
        await api.uploadSource(name, await routingSourceArchive(), false)
        const deployed = await waitForDeployment(context, name, version)
        const image = deployed.versions.find(
            (entry) => entry.version === version
        )?.deployedImageName
        expect(image).toBeTruthy()
        await waitForImage(context, name, image!)
        await context.http.waitUntilReachable(url, ROUTING_MARKER)
        expect((await api.getApp(name)).containerHttpPort).toBe(8080)

        await api.updateApp(name, { notExposeAsWebApp: true })
        expect((await api.getApp(name)).notExposeAsWebApp).toBe(true)
        await eventually(
            async () => {
                expect(await context.docker.getRunningReplicas(name)).toBe(1)
            },
            { description: `${name} to remain healthy while hidden` }
        )
        await context.http.waitUntilNotMatching(url, ROUTING_MARKER)

        await api.updateApp(name, { notExposeAsWebApp: false })
        expect((await api.getApp(name)).notExposeAsWebApp).toBe(false)
        await context.http.waitUntilReachable(url, ROUTING_MARKER)

        const firstCredentials = {
            user: `first-${runId}`,
            password: `first-${runId}-password`,
        }
        await api.updateApp(name, { httpAuth: firstCredentials })
        await expectAuthState(context.http, url, firstCredentials)
        expect(await api.getApp(name)).toMatchObject({
            httpAuth: {
                user: firstCredentials.user,
                passwordHashed: expect.stringMatching(/^\$apr1\$/),
            },
        })

        const secondCredentials = {
            user: `second-${runId}`,
            password: `second-${runId}-password`,
        }
        await api.updateApp(name, { httpAuth: secondCredentials })
        await eventually(
            async () => {
                expect(
                    (
                        await context.http.get(url, {
                            headers: basicAuth(firstCredentials),
                        })
                    ).status
                ).toBe(401)
                const response = await context.http.get(url, {
                    headers: basicAuth(secondCredentials),
                })
                expect(response.status).toBe(200)
                expect(response.body).toContain(ROUTING_MARKER)
            },
            { description: `${name} HTTP authentication change` }
        )
        expect((await api.getApp(name)).httpAuth?.user).toBe(
            secondCredentials.user
        )

        await api.updateApp(name, { httpAuth: { user: '' } })
        await context.http.waitUntilReachable(url, ROUTING_MARKER)
        expect((await api.getApp(name)).httpAuth).toBeUndefined()

        const redirectDomain = `redirect-${runId}.${rootDomain}`
        const requestPath = `/routing-path?run=${runId}`
        await api.updateApp(name, { redirectDomain })
        expect((await api.getApp(name)).redirectDomain).toBe(redirectDomain)
        await eventually(
            async () => {
                const response = await context.http.get(
                    `${url}${requestPath}`,
                    {
                        redirect: 'manual',
                    }
                )
                expect(response.status).toBe(302)
                expect(response.headers.get('location')).toBe(
                    `http://${redirectDomain}${requestPath}`
                )
            },
            { description: `${name} redirect routing` }
        )

        await api.updateApp(name, { redirectDomain: '' })
        expect((await api.getApp(name)).redirectDomain).toBe('')
        await context.http.waitUntilReachable(url, ROUTING_MARKER)

        await api.updateApp(name, { websocketSupport: true })
        expect((await api.getApp(name)).websocketSupport).toBe(true)
        await eventually(
            () => websocketEcho(`ws://${name}.${rootDomain}/echo`, runId),
            { description: `${name} WebSocket echo` }
        )
    })
})

function basicAuth(credentials: { user: string; password: string }) {
    return {
        authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`,
    }
}

async function expectAuthState(
    http: import('../src/clients/http').HttpClient,
    url: string,
    credentials: { user: string; password: string }
): Promise<void> {
    await eventually(
        async () => {
            const anonymous = await http.get(url)
            expect(anonymous.status).toBe(401)
            expect(anonymous.headers.get('www-authenticate')).toContain('Basic')
            expect(
                (
                    await http.get(url, {
                        headers: basicAuth({
                            user: credentials.user,
                            password: 'incorrect-password',
                        }),
                    })
                ).status
            ).toBe(401)
            const authenticated = await http.get(url, {
                headers: basicAuth(credentials),
            })
            expect(authenticated.status).toBe(200)
            expect(authenticated.body).toContain(ROUTING_MARKER)
        },
        { description: `${url} HTTP authentication` }
    )
}

function websocketEcho(url: string, marker: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url)
        let settled = false
        const timeout = setTimeout(() => {
            finish(new Error(`WebSocket echo timed out for ${url}`))
        }, 10_000)

        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            if (
                socket.readyState === WebSocket.CONNECTING ||
                socket.readyState === WebSocket.OPEN
            ) {
                socket.close()
            }
            if (error) reject(error)
            else resolve()
        }

        socket.addEventListener('open', () => socket.send(marker))
        socket.addEventListener('message', (event) => {
            if (event.data !== marker) {
                finish(
                    new Error(
                        `WebSocket echoed an unexpected payload for ${url}`
                    )
                )
                return
            }
            finish()
        })
        socket.addEventListener('error', () => {
            finish(new Error(`WebSocket connection failed for ${url}`))
        })
    })
}
