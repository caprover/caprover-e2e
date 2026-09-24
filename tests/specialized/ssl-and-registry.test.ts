import { checkServerIdentity, connect } from 'node:tls'
import { expect, test } from 'vitest'
import type { TestContext } from '../../src/context'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
    waitForServiceStable,
    withDeploymentDiagnostics,
} from '../../src/helpers/deployment'
import { createTestNames } from '../../src/helpers/names'
import { eventually } from '../../src/helpers/retry'
import { sourceArchive } from '../../src/helpers/source-fixture'
import { cleanUpApp, withTestContext } from '../../src/helpers/test-context'
import { requireEphemeral } from '../../src/test-selection'

const REGISTRY_PORT = 996

test('trusted application SSL and the self-hosted registry work through their full lifecycle', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { runId } = createTestNames()
        const compactId = runId.replaceAll('-', '')
        const appName = `ssl-${compactId}`
        // CapRover accepts a custom domain below the root domain only when
        // it remains under this app's own default subdomain.
        const customDomain = `custom.${appName}.${rootDomain}`
        const httpUrl = `http://${appName}.${rootDomain}`
        const httpsUrl = `https://${appName}.${rootDomain}`
        const customHttpsUrl = `https://${customDomain}`
        const marker = `ssl-${runId}`
        const pushedMarker = `registry-${runId}`
        const api = context.caprover

        const server = await api.getServerInfo()
        expect(new URL(process.env.CAPROVER_URL!).protocol).toBe('https:')
        expect(server.hasRootSsl).toBe(true)
        expect(server.forceSsl).toBe(true)

        const initialRegistries = await api.getDockerRegistries()
        expect(
            initialRegistries.registries.some(
                (registry) => registry.registryType === 'LOCAL_REG'
            )
        ).toBe(false)
        expect(initialRegistries.defaultPushRegistryId).toBeFalsy()

        cleanUpApp(context, cleanup, appName)
        await api.createApp(appName)
        await waitForServiceStable(context, appName)
        await deploySource(context, appName, marker)
        await context.http.waitUntilReachable(httpUrl, marker)

        await api.enableSslForBaseDomain(appName)
        await eventually(
            async () => {
                expect((await api.getApp(appName)).hasDefaultSubDomainSsl).toBe(
                    true
                )
            },
            {
                timeoutMs: 60_000,
                description: `${appName} base-domain SSL state`,
            }
        )
        await waitForTrustedCertificate(`${appName}.${rootDomain}`, 443)
        await context.http.waitUntilReachable(httpsUrl, marker, 60_000)

        await api.updateApp(appName, { forceSsl: true })
        await eventually(async () => {
            expect((await api.getApp(appName)).forceSsl).toBe(true)
            const response = await context.http.get(httpUrl, {
                redirect: 'manual',
            })
            expect(response.status).toBe(302)
            expect(response.headers.get('location')).toBe(`${httpsUrl}/`)
        })

        await api.attachCustomDomain(appName, customDomain)
        await api.enableSslForCustomDomain(appName, customDomain)
        await eventually(
            async () => {
                expect((await api.getApp(appName)).customDomain).toContainEqual(
                    {
                        publicDomain: customDomain,
                        hasSsl: true,
                    }
                )
            },
            {
                timeoutMs: 60_000,
                description: `${customDomain} SSL state`,
            }
        )
        await waitForTrustedCertificate(customDomain, 443)
        await context.http.waitUntilReachable(customHttpsUrl, marker, 60_000)

        cleanup.add(async () => {
            const current = await api.getDockerRegistries()
            const local = current.registries.find(
                (registry) => registry.registryType === 'LOCAL_REG'
            )
            if (!local) return
            if (current.defaultPushRegistryId === local.id) {
                await api.setDefaultPushDockerRegistry('')
            }
            await api.disableSelfHostedDockerRegistry()
        })

        await api.enableSelfHostedDockerRegistry()
        const localRegistry = await eventually(
            async () => {
                const current = await api.getDockerRegistries()
                const local = current.registries.find(
                    (registry) => registry.registryType === 'LOCAL_REG'
                )
                expect(local).toBeDefined()
                return local!
            },
            {
                timeoutMs: 60_000,
                description: 'self-hosted registry API entry',
            }
        )
        expect(localRegistry.registryUser).toBe('captain')
        expect(localRegistry.registryImagePrefix).toBe('captain')
        expect(localRegistry.registryDomain).toBe(
            `registry.${rootDomain}:${REGISTRY_PORT}`
        )
        if (!localRegistry.registryPassword) {
            throw new Error(
                'Self-hosted registry API entry did not include its generated credential'
            )
        }

        await waitForServiceStable(context, 'captain-registry')
        expect(
            await context.docker.getServicePublishedPorts('captain-registry')
        ).toContainEqual({
            targetPort: 5000,
            publishedPort: REGISTRY_PORT,
            protocol: 'tcp',
            publishMode: 'ingress',
        })
        expect(
            await context.docker.getServiceEnvironment('captain-registry')
        ).toEqual(
            expect.arrayContaining([
                expect.stringMatching(
                    /^REGISTRY_HTTP_TLS_CERTIFICATE=\/cert-files\/live\//
                ),
                expect.stringMatching(
                    /^REGISTRY_HTTP_TLS_KEY=\/cert-files\/live\//
                ),
                'REGISTRY_AUTH=htpasswd',
                'REGISTRY_STORAGE_DELETE_ENABLED=true',
            ])
        )

        const registryHost = `registry.${rootDomain}`
        const registryUrl = `https://${registryHost}:${REGISTRY_PORT}`
        await waitForTrustedCertificate(registryHost, REGISTRY_PORT)
        await eventually(
            async () => {
                const response = await context.http.get(`${registryUrl}/v2/`)
                expect(response.status).toBe(401)
                expect(
                    response.headers.get('docker-distribution-api-version')
                ).toBe('registry/2.0')
            },
            {
                timeoutMs: 60_000,
                description: 'self-hosted registry anonymous endpoint',
            }
        )

        const registryAuthorization = `Basic ${Buffer.from(
            `${localRegistry.registryUser}:${localRegistry.registryPassword}`
        ).toString('base64')}`
        await eventually(
            async () => {
                const response = await context.http.get(`${registryUrl}/v2/`, {
                    headers: { authorization: registryAuthorization },
                })
                expect(response.status).toBe(200)
            },
            {
                timeoutMs: 60_000,
                description: 'self-hosted registry authenticated endpoint',
            }
        )

        await api.setDefaultPushDockerRegistry(localRegistry.id)
        expect((await api.getDockerRegistries()).defaultPushRegistryId).toBe(
            localRegistry.id
        )
        await expect(
            api.deleteDockerRegistry(localRegistry.id)
        ).rejects.toMatchObject({
            captainStatus: 1110,
            captainMessage: expect.stringContaining(
                'Cannot remove the default push'
            ),
        })

        await api.setDefaultPushDockerRegistry('')
        await expect(
            api.deleteDockerRegistry(localRegistry.id)
        ).rejects.toMatchObject({
            captainStatus: 1108,
            captainMessage: expect.stringContaining(
                'cannot delete self-hosted registry'
            ),
        })
        await api.setDefaultPushDockerRegistry(localRegistry.id)

        let pushedVersion = 0
        await withDeploymentDiagnostics(context, appName, async () => {
            pushedVersion = await deploySource(context, appName, pushedMarker)
        })
        const expectedImage = `${localRegistry.registryDomain}/${localRegistry.registryImagePrefix}/img-captain-${appName}:${pushedVersion}`
        const pushedApp = await api.getApp(appName)
        expect(
            pushedApp.versions.find(
                (version) => version.version === pushedVersion
            )?.deployedImageName
        ).toBe(expectedImage)
        await waitForImage(context, appName, expectedImage)
        await context.http.waitUntilReachable(httpsUrl, pushedMarker, 60_000)

        const repositoryPath = `${localRegistry.registryImagePrefix}/img-captain-${appName}`
        const tags = await context.http.get(
            `${registryUrl}/v2/${repositoryPath}/tags/list`,
            { headers: { authorization: registryAuthorization } }
        )
        expect(tags.status).toBe(200)
        const tagsBody = JSON.parse(tags.body) as {
            name: string
            tags: string[]
        }
        expect(tagsBody.name).toBe(repositoryPath)
        expect(tagsBody.tags).toContain(String(pushedVersion))

        await api.setDefaultPushDockerRegistry('')
        await api.disableSelfHostedDockerRegistry()
        await eventually(async () => {
            expect(
                (await api.getDockerRegistries()).registries.some(
                    (registry) => registry.registryType === 'LOCAL_REG'
                )
            ).toBe(false)
            expect(await context.docker.serviceExists('captain-registry')).toBe(
                false
            )
        })

        await api.removeCustomDomain(appName, customDomain)
        await eventually(async () => {
            expect(
                (await api.getApp(appName)).customDomain.some(
                    (domain) => domain.publicDomain === customDomain
                )
            ).toBe(false)
        })
        await context.http.waitUntilNotMatching(
            customHttpsUrl,
            pushedMarker,
            60_000
        )
    })
}, 600_000)

async function deploySource(
    context: TestContext,
    appName: string,
    marker: string
): Promise<number> {
    const api = context.caprover
    const version = nextVersion(await api.getApp(appName))
    await api.uploadSource(appName, await sourceArchive(marker), false)
    const app = await waitForDeployment(context, appName, version)
    const image = app.versions.find(
        (candidate) => candidate.version === version
    )?.deployedImageName
    expect(image).toBeTruthy()
    await waitForImage(context, appName, image!)
    return version
}

function verifyTrustedCertificate(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = connect({
            host,
            port,
            servername: host,
            rejectUnauthorized: true,
        })
        const fail = (error: unknown) => {
            socket.destroy()
            reject(error)
        }

        socket.setTimeout(10_000, () =>
            fail(new Error(`TLS connection to ${host}:${port} timed out`))
        )
        socket.once('error', fail)
        socket.once('secureConnect', () => {
            try {
                if (!socket.authorized) {
                    throw new Error(
                        `TLS authorization failed for ${host}:${port}`
                    )
                }
                const certificate = socket.getPeerCertificate()
                const identityError = checkServerIdentity(host, certificate)
                if (identityError) throw identityError
                if (Date.parse(certificate.valid_to) <= Date.now()) {
                    throw new Error(`TLS certificate for ${host} is expired`)
                }
                socket.end()
                resolve()
            } catch (error) {
                fail(error)
            }
        })
    })
}

function waitForTrustedCertificate(host: string, port: number): Promise<void> {
    return eventually(() => verifyTrustedCertificate(host, port), {
        timeoutMs: 60_000,
        description: `trusted TLS certificate for ${host}:${port}`,
    })
}
