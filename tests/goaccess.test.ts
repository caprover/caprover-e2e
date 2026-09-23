import { expect, test } from 'vitest'
import { GoAccessSettings } from '../src/clients/caprover'
import { waitForImage } from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'
const CONTAINER = 'captain-goaccess-container'

test('GoAccess generates a live report and restores its original configuration', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup, rootDomain) => {
        const api = context.caprover
        const { runId } = createTestNames()
        const appName = `e2e-${runId}-goaccess`
        const appUrl = `http://${appName}.${rootDomain}`

        cleanUpApp(context, cleanup, appName)
        await api.createApp(appName)
        await api.deployImage(appName, IMAGE)
        await waitForImage(context, appName, IMAGE)
        await context.http.waitUntilReachable(appUrl, 'Welcome to nginx')

        const original = await api.getGoAccessInfo()
        cleanup.add(async () => {
            await api.updateGoAccessInfo(original as GoAccessSettings)
            await eventually(
                async () => {
                    expect(await api.getGoAccessInfo()).toEqual(original)
                    expect(
                        await context.docker.getContainerState(CONTAINER)
                    ).toBe(original.isEnabled ? 'running' : 'absent')
                },
                { description: 'GoAccess settings and container restoration' }
            )
        })

        const enabled: GoAccessSettings = {
            isEnabled: true,
            data: { rotationFrequencyCron: '0 0 1 * *', logRetentionDays: 7 },
        }
        await api.updateGoAccessInfo(enabled)
        await eventually(
            async () => {
                expect(await api.getGoAccessInfo()).toEqual(enabled)
                expect(await context.docker.getContainerState(CONTAINER)).toBe(
                    'running'
                )
            },
            { description: 'GoAccess container to start' }
        )

        for (let index = 0; index < 3; index++) {
            expect((await context.http.get(appUrl)).status).toBe(200)
        }
        const reports = await api.getGoAccessReports(appName)
        const live = reports.find(
            (report) =>
                report.domainName === `${appName}.${rootDomain}` &&
                report.name.endsWith('--Live.html')
        )
        expect(live?.url).toMatch(/^\/user\/system\/goaccess\//)
        await eventually(
            async () => {
                const html = await api.getGoAccessReport(live!.url)
                expect(html.length).toBeGreaterThan(100)
                expect(html.toLowerCase()).toContain('<html')
            },
            { timeoutMs: 60_000, description: 'GoAccess live HTML report' }
        )

        await expect(
            api.getGoAccessReports(`e2e-missing-${runId}`)
        ).rejects.toMatchObject({ captainStatus: 1000 })
        const missingUrl = live!.url.replace(
            /--Live\.html$/,
            `--missing-${runId}.html`
        )
        expect(missingUrl).not.toBe(live!.url)
        await expect(api.getGoAccessReport(missingUrl)).rejects.toMatchObject({
            captainStatus: 1111,
        })
    })
})
