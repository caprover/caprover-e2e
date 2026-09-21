import { expect, test } from 'vitest'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
    waitForServiceStable,
} from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { addNginxResponseHeader } from '../src/helpers/nginx'
import { eventually } from '../src/helpers/retry'
import { sourceArchive } from '../src/helpers/source-fixture'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const RESPONSE_HEADER = 'X-Caprover-E2e'

test('custom domains and app-level Nginx configuration preserve routing safety', async () => {
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { runId } = createTestNames()
        const compactId = runId.replaceAll('-', '')
        const firstApp = `a${compactId}`
        const secondApp = `b${compactId}`
        const marker = `app-nginx-${runId}`
        const customDomain = `custom.${firstApp}.${rootDomain}`
        const defaultUrl = `http://${firstApp}.${rootDomain}`
        const customUrl = `http://${customDomain}`
        const api = context.caprover

        cleanUpApp(context, cleanup, firstApp)
        await api.createApp(firstApp)
        await waitForServiceStable(context, firstApp)
        const expectedVersion = nextVersion(await api.getApp(firstApp))
        await api.uploadSource(firstApp, await sourceArchive(marker), false)
        const deployed = await waitForDeployment(
            context,
            firstApp,
            expectedVersion
        )
        const deployedImage = deployed.versions.find(
            (version) => version.version === expectedVersion
        )?.deployedImageName
        expect(deployedImage).toBeTruthy()
        await waitForImage(context, firstApp, deployedImage!)
        await context.http.waitUntilReachable(defaultUrl, marker)

        cleanUpApp(context, cleanup, secondApp)
        await api.createApp(secondApp)
        await waitForServiceStable(context, secondApp)

        await api.attachCustomDomain(firstApp, customDomain)
        await eventually(async () => {
            expect((await api.getApp(firstApp)).customDomain).toContainEqual({
                publicDomain: customDomain,
                hasSsl: false,
            })
        })
        await context.http.waitUntilReachable(customUrl, marker)

        await expect(
            api.attachCustomDomain(secondApp, customDomain)
        ).rejects.toMatchObject({
            captainStatus: 1110,
            captainMessage: expect.stringContaining(
                `already attached to app ${firstApp}`
            ),
        })
        expect((await api.getApp(secondApp)).customDomain).toEqual([])

        await api.removeCustomDomain(firstApp, customDomain)
        await eventually(async () => {
            expect(
                (await api.getApp(firstApp)).customDomain
            ).not.toContainEqual(
                expect.objectContaining({ publicDomain: customDomain })
            )
        })
        await context.http.waitUntilNotMatching(customUrl, marker)

        const { defaultNginxConfig } = await api.getApps()
        const customNginxConfig = addNginxResponseHeader(
            defaultNginxConfig,
            RESPONSE_HEADER,
            marker
        )
        await api.updateApp(firstApp, { customNginxConfig })
        await waitForHeader(context.http, defaultUrl, RESPONSE_HEADER, marker)
        expect((await api.getApp(firstApp)).customNginxConfig).toBe(
            customNginxConfig
        )

        await expect(
            api.updateApp(firstApp, {
                customNginxConfig: 'server { e2e_invalid_directive_for_test; }',
            })
        ).rejects.toMatchObject({ captainStatus: 1116 })
        await eventually(async () => {
            expect((await api.getApp(firstApp)).customNginxConfig).toBe(
                customNginxConfig
            )
            expect(
                (await context.http.get(defaultUrl)).headers.get(
                    RESPONSE_HEADER
                )
            ).toBe(marker)
        })

        await api.updateApp(firstApp, { customNginxConfig: '' })
        await eventually(async () => {
            expect((await api.getApp(firstApp)).customNginxConfig).toBe('')
            const response = await context.http.get(defaultUrl)
            expect(response.status).toBe(200)
            expect(response.body).toContain(marker)
            expect(response.headers.get(RESPONSE_HEADER)).toBeNull()
        })
    })
})

function waitForHeader(
    http: { get(url: string): Promise<{ status: number; headers: Headers }> },
    url: string,
    name: string,
    value: string
): Promise<void> {
    return eventually(
        async () => {
            const response = await http.get(url)
            expect(response.status).toBe(200)
            expect(response.headers.get(name)).toBe(value)
        },
        { description: `${url} to return ${name}` }
    )
}
