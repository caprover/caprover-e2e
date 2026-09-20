import { expect, test, vi } from 'vitest'
import {
    buildImmediateDiagnosticSections,
    captureImmediateDiagnostics,
} from '../../src/diagnostics'

test('immediate diagnostics capture volatile CapRover failure evidence', () => {
    const sections = buildImmediateDiagnosticSections(
        'https://captain.example.com'
    )
    const commands = sections.map((section) => section.command).join('\n')

    expect(commands).toContain('docker service ps')
    expect(commands).toContain('captain-captain')
    expect(commands).toContain('captain-nginx')
    expect(commands).toContain('docker service logs')
    expect(commands).toContain('docker events')
    expect(commands).toContain('127.0.0.1:3000')
    expect(commands).toContain('--resolve')
    expect(commands).not.toContain('docker service inspect')
    expect(commands).not.toContain('printenv')
})

test('diagnostic command failures do not stop later sections', async () => {
    let calls = 0
    const ssh = {
        exec: vi.fn(async () => {
            calls++
            if (calls === 1) throw new Error('first command failed')
            return { stdout: 'ok', stderr: '', exitCode: 0 }
        }),
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
        await expect(
            captureImmediateDiagnostics(
                ssh,
                'https://captain.example.com',
                new Error('socket hang up')
            )
        ).resolves.toBeUndefined()
    } finally {
        log.mockRestore()
    }

    expect(ssh.exec).toHaveBeenCalledTimes(
        buildImmediateDiagnosticSections('https://captain.example.com').length
    )
})
