import { expect, test } from 'vitest'
import { NginxConfig } from '../src/clients/caprover'
import { loadConfig } from '../src/config'
import { CleanupRegistry } from '../src/helpers/cleanup'
import { createTestNames } from '../src/helpers/names'
import { addNginxResponseHeader } from '../src/helpers/nginx'
import { eventually } from '../src/helpers/retry'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const RESPONSE_HEADER = 'X-Caprover-E2e-System'

test('global Nginx configuration rejects invalid syntax without losing the last valid config', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const original = await api.getNginxConfig()
        const originalBase = original.baseConfig.customValue ?? ''
        const originalCaptain = original.captainConfig.customValue ?? ''
        const effectiveBase = originalBase || original.baseConfig.byDefault
        const marker = `system-nginx-${createTestNames().runId}`
        const customizedBase = addNginxResponseHeader(
            effectiveBase,
            RESPONSE_HEADER,
            marker
        )
        const caproverUrl = loadConfig().caproverUrl

        restoreNginxConfig(context, cleanup, original, caproverUrl, marker)

        await api.setNginxConfig(customizedBase, originalCaptain)
        await eventually(
            async () => {
                const current = await api.getNginxConfig()
                expect(current.baseConfig.customValue).toBe(customizedBase)
                expect(current.captainConfig.customValue).toBe(originalCaptain)
                const response = await context.http.get(caproverUrl)
                expect(response.status).toBe(200)
                expect(response.headers.get(RESPONSE_HEADER)).toBe(marker)
            },
            { description: 'global Nginx response header to become observable' }
        )

        await expect(
            api.setNginxConfig(
                addInvalidDirective(customizedBase),
                originalCaptain
            )
        ).rejects.toMatchObject({ captainStatus: 1116 })

        await eventually(
            async () => {
                const current = await api.getNginxConfig()
                expect(current.baseConfig.customValue).toBe(customizedBase)
                expect(current.captainConfig.customValue).toBe(originalCaptain)
                const response = await context.http.get(caproverUrl)
                expect(response.status).toBe(200)
                expect(response.headers.get(RESPONSE_HEADER)).toBe(marker)
            },
            {
                description:
                    'last valid global Nginx configuration to remain active',
            }
        )
    })
})

function restoreNginxConfig(
    context: import('../src/context').TestContext,
    cleanup: CleanupRegistry,
    original: NginxConfig,
    caproverUrl: string,
    marker: string
): void {
    cleanup.add(async () => {
        const baseConfig = original.baseConfig.customValue ?? ''
        const captainConfig = original.captainConfig.customValue ?? ''
        await context.caprover.setNginxConfig(baseConfig, captainConfig)
        await eventually(
            async () => {
                const restored = await context.caprover.getNginxConfig()
                expect(restored.baseConfig.customValue ?? '').toBe(baseConfig)
                expect(restored.captainConfig.customValue ?? '').toBe(
                    captainConfig
                )
                const response = await context.http.get(caproverUrl)
                expect(response.headers.get(RESPONSE_HEADER)).not.toBe(marker)
            },
            {
                description:
                    'original global Nginx configuration to be restored',
            }
        )
    })
}

function addInvalidDirective(config: string): string {
    const closingBrace = config.trimEnd().lastIndexOf('}')
    if (closingBrace < 0) {
        throw new Error('Global Nginx base config has no http-block close')
    }
    return `${config.slice(0, closingBrace)}    e2e_invalid_directive_for_test;\n${config.slice(closingBrace)}`
}
