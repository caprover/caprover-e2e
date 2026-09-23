import { expect, test } from 'vitest'
import { GoAccessInfo } from '../src/clients/caprover'
import { waitForServiceStable } from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const NGINX_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'
const CONTAINER = 'captain-goaccess-container'

test('GoAccess records routed traffic and serves a live report', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { runId } = createTestNames()
        const appName = `e2e-${runId}-goaccess`
        const appUrl = `http://${appName}.${rootDomain}`
        const api = context.caprover

        cleanUpApp(context, cleanup, appName)
        await api.createApp(appName)
        await api.deployImage(appName, NGINX_IMAGE)
        await waitForServiceStable(context, appName)
        await context.http.waitUntilReachable(appUrl, 'Welcome to nginx!')

        const original = await api.getGoAccessInfo()
        const restore: GoAccessInfo = {
            isEnabled: original.isEnabled,
            data: {
                rotationFrequencyCron: original.data.rotationFrequencyCron,
                logRetentionDays: original.data.logRetentionDays ?? 180,
            },
        }
        cleanup.add(async () => {
            await api.updateGoAccessInfo(restore)
            await eventually(
                async () => {
                    expect(await api.getGoAccessInfo()).toEqual(restore)
                    expect(
                        await context.docker.getContainerState(CONTAINER)
                    ).toBe(original.isEnabled ? 'running' : 'absent')
                },
                {
                    timeoutMs: 60_000,
                    description: 'GoAccess settings and container restoration',
                }
            )
        })

        const enabled: GoAccessInfo = {
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
            { timeoutMs: 60_000, description: 'GoAccess container startup' }
        )

        for (let request = 0; request < 3; request++) {
            expect((await context.http.get(appUrl)).status).toBe(200)
        }

        const reports = await api.getGoAccessReports(appName)
        const live = reports.find(
            (report) =>
                report.domainName === `${appName}.${rootDomain}` &&
                report.name.endsWith('--Live.html')
        )
        expect(live).toBeDefined()
        expect(live?.url).toMatch(
            new RegExp(`^/user/system/goaccess/${appName}/files/`)
        )

        await eventually(
            async () => {
                const html = await api.getGoAccessReport(live!.url)
                expect(html.length).toBeGreaterThan(500)
                expect(html.toLowerCase()).toContain('<html')
            },
            { timeoutMs: 60_000, description: 'GoAccess live HTML report' }
        )

        await expect(
            api.getGoAccessReports(`e2e-${runId}-missing`)
        ).rejects.toMatchObject({ captainStatus: 1000 })
        const missingUrl = live!.url.replace(
            '--Live.html',
            `--Missing-${runId}.html`
        )
        expect(missingUrl).not.toBe(live!.url)
        await expect(api.getGoAccessReport(missingUrl)).rejects.toMatchObject({
            captainStatus: 1111,
        })
    })
})
