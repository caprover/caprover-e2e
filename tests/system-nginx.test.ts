import { expect, test } from 'vitest'
import { loadConfig } from '../src/config'
import { addNginxResponseHeader } from '../src/helpers/nginx'
import { eventually } from '../src/helpers/retry'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const RESPONSE_HEADER = 'X-Caprover-E2e-Global'

test('global Nginx customization is observable, rejects invalid syntax, and restores safely', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const caproverUrl = loadConfig().caproverUrl
        const original = await api.getNginxConfig()
        const originalBase = original.baseConfig.customValue
        const originalCaptain = original.captainConfig.customValue
        cleanup.add(async () => {
            await api.setNginxConfig(originalBase, originalCaptain)
            await eventually(
                async () => {
                    const restored = await api.getNginxConfig()
                    expect(restored.baseConfig.customValue).toBe(originalBase)
                    expect(restored.captainConfig.customValue).toBe(
                        originalCaptain
                    )
                    const response = await context.http.get(caproverUrl)
                    expect(response.status).toBeLessThan(500)
                    expect(response.headers.get(RESPONSE_HEADER)).not.toBe(
                        marker
                    )
                },
                {
                    description:
                        'original global Nginx overrides to be restored',
                }
            )
        })

        const marker = `global-nginx-${Date.now()}`
        const activeBase = originalBase || original.baseConfig.byDefault
        const customizedBase = addNginxResponseHeader(
            activeBase,
            RESPONSE_HEADER,
            marker
        )

        await api.setNginxConfig(customizedBase, originalCaptain)
        await eventually(
            async () => {
                const current = await api.getNginxConfig()
                expect(current.baseConfig.customValue).toBe(customizedBase)
                expect(current.captainConfig.customValue).toBe(originalCaptain)
                const response = await context.http.get(caproverUrl)
                expect(response.status).toBeLessThan(500)
                expect(response.headers.get(RESPONSE_HEADER)).toBe(marker)
            },
            { description: 'global Nginx response header to become observable' }
        )

        await expect(
            api.setNginxConfig(
                'events { e2e_invalid_directive_for_test; }',
                originalCaptain
            )
        ).rejects.toMatchObject({ captainStatus: 1116 })

        await eventually(
            async () => {
                const current = await api.getNginxConfig()
                expect(current.baseConfig.customValue).toBe(customizedBase)
                expect(current.captainConfig.customValue).toBe(originalCaptain)
                const response = await context.http.get(caproverUrl)
                expect(response.status).toBeLessThan(500)
                expect(response.headers.get(RESPONSE_HEADER)).toBe(marker)
            },
            {
                description:
                    'last valid global Nginx configuration to remain active',
            }
        )
    })
})
