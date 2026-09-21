import { randomBytes } from 'node:crypto'

export interface TestNames {
    runId: string
    initialAppName: string
    renamedAppName: string
}

export interface CustomPortAllocation {
    tcpIngress: number
    udpIngress: number
    tcpHost: number
    replacementTcpIngress: number
}

export const CUSTOM_PORT_RANGE = { start: 40_000, end: 40_999 } as const

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

export function allocateCustomPorts(runId: string): CustomPortAllocation {
    if (!/^[a-z0-9-]+$/.test(runId)) {
        throw new Error('Unsafe run ID for custom port allocation')
    }

    const size = 4
    const rangeSize = CUSTOM_PORT_RANGE.end - CUSTOM_PORT_RANGE.start + 1
    const blocks = Math.floor(rangeSize / size)
    const block = stableHash(runId) % blocks
    const start = CUSTOM_PORT_RANGE.start + block * size

    return {
        tcpIngress: start,
        udpIngress: start + 1,
        tcpHost: start + 2,
        replacementTcpIngress: start + 3,
    }
}

function stableHash(value: string): number {
    let hash = 2_166_136_261
    for (const character of value) {
        hash ^= character.charCodeAt(0)
        hash = Math.imul(hash, 16_777_619)
    }
    return hash >>> 0
}
