import { randomBytes } from 'node:crypto'

export interface TestNames {
    runId: string
    initialAppName: string
    renamedAppName: string
}

export function createTestNames(now: Date = new Date()): TestNames {
    const date = now.toISOString().slice(0, 10).replaceAll('-', '')
    const random = randomBytes(3).toString('hex')
    const runId = `${date}-${random}`

    return {
        runId,
        initialAppName: `e2e-${runId}-initial`,
        renamedAppName: `e2e-${runId}-renamed`,
    }
}
