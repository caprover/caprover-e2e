import { CapRoverModels } from 'caprover-api'
import { expect, test } from 'vitest'
import { createTestNames } from '../src/helpers/names'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

test('registry validation leaves global state intact', async () => {
    requireEphemeral()
    await withTestContext(async ({ caprover: api, ssh }) => {
        const initial = await api.getDockerRegistries()
        expect(Array.isArray(initial.registries)).toBe(true)
        if (initial.defaultPushRegistryId) {
            expect(initial.registries.map((registry) => registry.id)).toContain(
                initial.defaultPushRegistryId
            )
        }

        const { runId } = createTestNames()
        await expect(
            api.setDefaultPushDockerRegistry(`e2e-missing-registry-${runId}`)
        ).rejects.toMatchObject({ captainStatus: 1111 })
        expect(await api.getDockerRegistries()).toEqual(initial)

        // Probe from the Docker host: an API 1112 alone also covers network failures.
        const probe = await ssh.exec(
            'curl --connect-timeout 5 --max-time 10 -sS -D - -o /dev/null https://ghcr.io/v2/'
        )
        expect(
            probe.exitCode,
            `Registry probe failed: ${probe.stderr.trim()}`
        ).toBe(0)
        expect(probe.stdout).toMatch(/^HTTP\/\S+ 401\b/m)
        expect(probe.stdout).toMatch(/^www-authenticate:\s*\S+/im)

        const registry: CapRoverModels.IRegistryInfo = {
            id: '',
            registryType: 'REMOTE_REG',
            registryDomain: 'ghcr.io',
            registryImagePrefix: `e2e-${runId}`,
            registryUser: `e2e-invalid-${runId}`,
            registryPassword: `e2e-invalid-${runId}`,
        }
        await expect(api.addDockerRegistry(registry)).rejects.toMatchObject({
            captainStatus: 1112,
        })
        expect(await api.getDockerRegistries()).toEqual(initial)
    })
})
