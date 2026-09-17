import { describe, expect, test } from 'vitest'
import { createTestNames } from '../../src/helpers/names.js'
import { eventually } from '../../src/helpers/retry.js'

describe('createTestNames', () => {
    test('creates valid, related, unique app names', () => {
        const names = createTestNames(new Date('2026-09-17T12:00:00Z'))

        expect(names.runId).toMatch(/^20260917-[a-f0-9]{6}$/)
        expect(names.initialAppName).toBe(`e2e-${names.runId}-initial`)
        expect(names.renamedAppName).toBe(`e2e-${names.runId}-renamed`)
        expect(names.initialAppName.length).toBeLessThan(50)
        expect(names.renamedAppName.length).toBeLessThan(50)
    })
})

describe('eventually', () => {
    test('returns after a later attempt succeeds', async () => {
        let attempts = 0

        const result = await eventually(
            () => {
                attempts += 1
                if (attempts < 3) throw new Error('not ready')
                return 'ready'
            },
            { timeoutMs: 100, intervalMs: 1 }
        )

        expect(result).toBe('ready')
        expect(attempts).toBe(3)
    })

    test('includes the last failure in timeout diagnostics', async () => {
        await expect(
            eventually(
                () => {
                    throw new Error('still converging')
                },
                {
                    timeoutMs: 5,
                    intervalMs: 1,
                    description: 'test state',
                }
            )
        ).rejects.toThrow(
            'Timed out after 5ms while waiting for test state. Last error: still converging'
        )
    })
})
