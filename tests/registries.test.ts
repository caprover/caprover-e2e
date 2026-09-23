import { expect, test } from 'vitest'
import { createTestNames } from '../src/helpers/names'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

test('registry validation and rejected credentials preserve the registry state', async () => {
    requireEphemeral()
    await withTestContext(async (context) => {
        const { runId } = createTestNames()
        const api = context.caprover
        const initial = await api.getDockerRegistries()
        expect(Array.isArray(initial.registries)).toBe(true)
        if (initial.defaultPushRegistryId !== undefined) {
            expect(initial.registries.map((registry) => registry.id)).toContain(
                initial.defaultPushRegistryId
            )
        }

        await expect(
            api.setDefaultPushDockerRegistry(`e2e-missing-registry-${runId}`)
        ).rejects.toMatchObject({ captainStatus: 1111 })
        expect(await api.getDockerRegistries()).toEqual(initial)

        // A 1112 alone can also represent a network failure. Check the actual
        // CapRover host's path to the registry immediately before authentication.
        const probe = await context.ssh.exec(
            'curl --connect-timeout 5 --max-time 10 -sS -D - -o /dev/null https://ghcr.io/v2/',
            15_000
        )
        expect(probe.exitCode, `Registry probe failed: ${probe.stderr}`).toBe(0)
        expect(probe.stdout).toMatch(/^HTTP\/\S+ 401\b/m)
        expect(probe.stdout).toMatch(/^www-authenticate:\s*Bearer\b/im)

        await expect(
            api.addDockerRegistry({
                id: '',
                registryUser: `e2e-${runId}`,
                registryPassword: `invalid-${runId}`,
                registryDomain: 'ghcr.io',
                registryImagePrefix: `e2e-${runId}`,
                registryType: 'REMOTE_REG',
            })
        ).rejects.toMatchObject({ captainStatus: 1112 })
        expect(await api.getDockerRegistries()).toEqual(initial)
    })
})
