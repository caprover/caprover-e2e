import { expect, test } from 'vitest'
import { withCleanup } from '../../src/helpers/cleanup'

test('cleans up in reverse order after an ambiguous create failure', async () => {
    const events: string[] = []
    const failure = new Error('response lost')
    await expect(
        withCleanup(async (cleanup) => {
            cleanup.add(async () => {
                events.push('first')
            })
            cleanup.add(async () => {
                events.push('second')
            })
            throw failure
        })
    ).rejects.toBe(failure)
    expect(events).toEqual(['second', 'first'])
})

test('attempts all cleanup and preserves both test and cleanup failures', async () => {
    const failure = new Error('test failed')
    const cleanupFailure = new Error('delete failed')
    let finalCleanup = false
    try {
        await withCleanup(async (cleanup) => {
            cleanup.add(async () => {
                finalCleanup = true
            })
            cleanup.add(async () => {
                throw cleanupFailure
            })
            throw failure
        })
        expect.unreachable()
    } catch (error) {
        expect(error).toBeInstanceOf(AggregateError)
        const aggregate = error as AggregateError
        expect(aggregate.cause).toBe(failure)
        expect(aggregate.errors[1].errors).toEqual([cleanupFailure])
    }
    expect(finalCleanup).toBe(true)
})

test('cleanup failure fails an otherwise passing operation', async () => {
    await expect(
        withCleanup(async (cleanup) => {
            cleanup.add(async () => {
                throw new Error('delete failed')
            })
        })
    ).rejects.toThrow('Resource cleanup failed')
})
