import { expect, test } from 'vitest'
import { loadConfig } from '../src/config'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

test('fresh provisioning has expected system and Pro defaults', async () => {
    requireEphemeral()
    await withTestContext(async (context) => {
        const [server, apps, nodes, proState, proConfigs] = await Promise.all([
            context.caprover.getServerInfo(),
            context.caprover.getApps(),
            context.caprover.getAllNodes(),
            context.caprover.getProFeaturesState(),
            context.caprover.getProConfigs(),
        ])

        expect(server.rootDomain).toBe(apps.rootDomain)
        expect(server.rootDomain).toMatch(/^e2e-[a-z0-9-]+\./)
        const dashboardUrl = new URL(loadConfig().caproverUrl)
        const httpsEnabled = dashboardUrl.protocol === 'https:'
        expect(server.hasRootSsl).toBe(httpsEnabled)
        expect(server.forceSsl).toBe(httpsEnabled)
        expect(dashboardUrl.hostname).toBe(
            `${server.captainSubDomain}.${server.rootDomain}`
        )

        expect(nodes.nodes).toHaveLength(1)
        expect(nodes.nodes[0]).toMatchObject({
            type: 'manager',
            isLeader: true,
        })
        expect(nodes.nodes[0].nodeId).toBe(
            await context.docker.getLocalManagerNodeId()
        )

        expect(proState.isSubscribed).toBe(false)
        expect(typeof proState.isFeatureFlagEnabled).toBe('boolean')
        expect(proConfigs.alerts).toEqual([])
    })
})
