import { expect, test } from 'vitest'
import { waitForOneClickDeployment } from '../../src/helpers/one-click'

test('one-click polling returns a successful monotonic terminal state', async () => {
    const states = [
        { steps: ['queue', 'deploy'], currentStep: 0, error: '' },
        { steps: ['queue', 'deploy'], currentStep: 1, error: '' },
        {
            steps: ['queue', 'deploy'],
            currentStep: 2,
            error: '',
            successMessage: 'complete',
        },
    ]
    const result = await waitForOneClickDeployment(
        async () => states.shift()!,
        { intervalMs: 0 }
    )
    expect(result.outcome).toBe('success')
    expect(result.history.map((state) => state.currentStep)).toEqual([0, 1, 2])
})

test('one-click polling returns an asynchronous deployment error', async () => {
    const result = await waitForOneClickDeployment(
        async () => ({
            steps: ['Parsing the template'],
            currentStep: 0,
            error: 'Cannot parse the template',
        }),
        { intervalMs: 0 }
    )
    expect(result.outcome).toBe('error')
    expect(result.state.error).toContain('Cannot parse')
})

test('one-click polling rejects a regressing progress state', async () => {
    const states = [
        { steps: ['queue', 'deploy'], currentStep: 1, error: '' },
        { steps: ['queue', 'deploy'], currentStep: 0, error: '' },
    ]
    await expect(
        waitForOneClickDeployment(async () => states.shift()!, {
            intervalMs: 0,
        })
    ).rejects.toThrow('regressed from 1 to 0')
})
