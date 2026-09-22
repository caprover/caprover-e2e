import { expect, test } from 'vitest'
import { loadConfig } from '../src/config'
import { DockerNode } from '../src/inspectors/docker'
import { eventually } from '../src/helpers/retry'
import { withTestContext } from '../src/helpers/test-context'

const COUNTER_FIELDS = [
    'activeConnections',
    'accepted',
    'handled',
    'total',
    'reading',
    'writing',
    'waiting',
] as const

test('system information is internally consistent with Docker and public Nginx', async () => {
    await withTestContext(async (context) => {
        const [
            server,
            apps,
            version,
            initialLoadBalancer,
            apiNodes,
            proState,
            proConfigs,
        ] = await Promise.all([
            context.caprover.getServerInfo(),
            context.caprover.getApps(),
            context.caprover.getVersionInfo(),
            context.caprover.getLoadBalancerInfo(),
            context.caprover.getAllNodes(),
            context.caprover.getProFeaturesState(),
            context.caprover.getProConfigs(),
        ])

        expect(server.rootDomain).toBe(apps.rootDomain)
        expect(new URL(loadConfig().caproverUrl).hostname).toBe(
            `${server.captainSubDomain}.${server.rootDomain}`
        )
        expect(typeof server.hasRootSsl).toBe('boolean')
        expect(typeof server.forceSsl).toBe('boolean')
        if (server.forceSsl) expect(server.hasRootSsl).toBe(true)

        expect(version.currentVersion.length).toBeGreaterThan(0)
        expect(version.latestVersion.length).toBeGreaterThan(0)
        expect(typeof version.canUpdate).toBe('boolean')
        expect(typeof version.changeLogMessage).toBe('string')
        expectCounters(initialLoadBalancer)

        for (let index = 0; index < 3; index++) {
            expect(
                (await context.http.get(loadConfig().caproverUrl)).status
            ).toBe(200)
        }
        await eventually(
            async () => {
                const current = await context.caprover.getLoadBalancerInfo()
                expectCounters(current)
                expect(current.total).toBeGreaterThan(initialLoadBalancer.total)
                expect(current.accepted).toBeGreaterThanOrEqual(
                    initialLoadBalancer.accepted
                )
                expect(current.handled).toBeGreaterThanOrEqual(
                    initialLoadBalancer.handled
                )
            },
            { description: 'load-balancer request counters to increase' }
        )

        const dockerNodes = await context.docker.getNodes()
        expect(new Set(apiNodes.nodes.map((node) => node.nodeId))).toEqual(
            new Set(dockerNodes.map((node) => node.ID))
        )
        for (const dockerNode of dockerNodes) {
            const apiNode = apiNodes.nodes.find(
                (node) => node.nodeId === dockerNode.ID
            )
            expect(apiNode).toEqual(nodeFromDocker(dockerNode))
            expect(apiNode!.nanoCpu).toBeGreaterThan(0)
            expect(apiNode!.memoryBytes).toBeGreaterThan(0)
        }
        const localNodeId = await context.docker.getLocalManagerNodeId()
        expect(apiNodes.nodes).toContainEqual(
            expect.objectContaining({ nodeId: localNodeId, type: 'manager' })
        )
        expect(
            dockerNodes.filter((node) => node.ManagerStatus?.Leader)
        ).toHaveLength(1)

        expect(typeof proState.isSubscribed).toBe('boolean')
        expect(typeof proState.isFeatureFlagEnabled).toBe('boolean')
        expect(Array.isArray(proConfigs.alerts)).toBe(true)
        for (const alert of proConfigs.alerts) {
            expect(alert).toMatchObject({
                event: expect.any(String),
                action: { actionType: expect.any(String) },
            })
        }
    })
})

function expectCounters(
    value: import('../src/clients/caprover').LoadBalancerInfo
): void {
    for (const field of COUNTER_FIELDS) {
        expect(Number.isFinite(value[field])).toBe(true)
        expect(Number.isInteger(value[field])).toBe(true)
        expect(value[field]).toBeGreaterThanOrEqual(0)
    }
}

function nodeFromDocker(node: DockerNode) {
    return {
        nodeId: node.ID,
        type: node.Spec.Role,
        isLeader:
            node.Spec.Role === 'manager' && node.ManagerStatus?.Leader === true,
        hostname: node.Description.Hostname,
        architecture: node.Description.Platform.Architecture,
        operatingSystem: node.Description.Platform.OS,
        nanoCpu: node.Description.Resources.NanoCPUs,
        memoryBytes: node.Description.Resources.MemoryBytes,
        dockerEngineVersion: node.Description.Engine.EngineVersion,
        ip: node.Status.Addr,
        state: node.Status.State,
        status: node.Spec.Availability,
    }
}
