import { expect, test, vi } from 'vitest'
import {
    buildImmediateDiagnosticSections,
    captureImmediateDiagnostics,
    redactSensitiveValues,
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

    const captainLogs = sections.find(
        (section) => section.title === 'Captain recent logs'
    )!
    const nginxLogs = sections.find(
        (section) => section.title === 'Nginx recent logs'
    )!
    const dockerEvents = sections.find(
        (section) => section.title === 'Recent Docker events'
    )!

    expect(captainLogs.command).toContain('--tail 200')
    expect(captainLogs.command).not.toContain('--since')
    expect(captainLogs.preserveNewestOnClip).toBe(true)

    expect(nginxLogs.command).toContain('--tail 115')
    expect(nginxLogs.command).not.toContain('--since')
    expect(nginxLogs.preserveNewestOnClip).toBe(true)

    expect(dockerEvents.command).toContain('| tail -n 75')
    expect(dockerEvents.preserveNewestOnClip).toBe(true)
    expect(commands).toContain('nf_conntrack_count')
    expect(commands).toContain('nf_conntrack_max')
    expect(commands).toContain('table full')
    expect(commands).toContain('127.0.0.1:3000')
    expect(commands).toContain('--resolve')
    expect(commands).toContain('captain.example.com:443:127.0.0.1')
    expect(commands).not.toContain('docker service inspect')
    expect(commands).not.toContain('printenv')
})

test('HTTP diagnostics probe port 80', () => {
    const sections = buildImmediateDiagnosticSections(
        'http://captain.example.com'
    )
    const command = sections[0].command
    expect(command).toContain('captain.example.com:80:127.0.0.1')
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

test('diagnostics redact raw, escaped, and URL-encoded credentials', () => {
    const environment = {
        E2E_GIT_HTTP_PASSWORD: 'token:value/with spaces',
        E2E_PRO_API_KEY: 'apikey_pro-test-value',
        E2E_GIT_SSH_PRIVATE_KEY:
            '-----BEGIN KEY-----\\nprivate-material\\n-----END KEY-----\\n',
    }
    const rawKey = environment.E2E_GIT_SSH_PRIVATE_KEY.replace(/\\n/g, '\n')
    const output = [
        environment.E2E_GIT_HTTP_PASSWORD,
        environment.E2E_PRO_API_KEY,
        encodeURIComponent(environment.E2E_GIT_HTTP_PASSWORD),
        environment.E2E_GIT_SSH_PRIVATE_KEY,
        rawKey,
        rawKey.trim(),
        encodeURIComponent(rawKey),
        encodeURIComponent(rawKey.trim()),
        'POST /triggerbuild?namespace=captain&token=generated-webhook-token',
    ].join('\n')

    const redacted = redactSensitiveValues(output, environment)
    expect(redacted).not.toContain('token:value')
    expect(redacted).not.toContain(environment.E2E_PRO_API_KEY)
    expect(redacted).not.toContain(
        encodeURIComponent(environment.E2E_GIT_HTTP_PASSWORD)
    )
    expect(redacted).not.toContain('private-material')
    expect(redacted).not.toContain('generated-webhook-token')
    expect(redacted).toContain('[REDACTED]')
})
