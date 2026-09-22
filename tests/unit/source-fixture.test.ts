import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import {
    customPortsSourceArchive,
    routingSourceArchive,
    sourceArchive,
} from '../../src/helpers/source-fixture'

test.each([false, true])(
    'source tar contains the selected definition and unique response (alternate=%s)',
    async (alternate) => {
        const archive = await sourceArchive('fixture-marker', alternate)
        expect(archive).toBeInstanceOf(File)
        const temporary = await mkdtemp(
            join(tmpdir(), 'caprover-fixture-test-')
        )
        try {
            const path = join(temporary, 'fixture.tar')
            await writeFile(path, new Uint8Array(await archive.arrayBuffer()))
            const { stdout } = await promisify(execFile)('tar', ['-tf', path])
            expect(stdout.includes('./captain-definition')).toBe(!alternate)
            expect(stdout.includes('./alternate-definition')).toBe(alternate)
            const response = await promisify(execFile)('tar', [
                '-xOf',
                path,
                './response.txt',
            ])
            expect(response.stdout).toBe('fixture-marker')
            const script = await promisify(execFile)('tar', [
                '-xOf',
                path,
                './log-marker.sh',
            ])
            expect(script.stdout).toContain('fixture-marker café فارسی')
        } finally {
            await rm(temporary, { recursive: true, force: true })
        }
    }
)

test('routing source tar contains the HTTP and WebSocket fixture', async () => {
    const archive = await routingSourceArchive()
    const temporary = await mkdtemp(join(tmpdir(), 'caprover-routing-test-'))
    try {
        const path = join(temporary, 'fixture.tar')
        await writeFile(path, new Uint8Array(await archive.arrayBuffer()))
        const { stdout } = await promisify(execFile)('tar', ['-tf', path])
        expect(stdout).toContain('./captain-definition')
        expect(stdout).toContain('./Dockerfile')
        expect(stdout).toContain('./server.js')
        const server = await promisify(execFile)('tar', [
            '-xOf',
            path,
            './server.js',
        ])
        expect(server.stdout).toContain("server.on('upgrade'")
        expect(server.stdout).toContain('server.listen(8080')
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
})

test('custom-port source tar contains the TCP and UDP echo fixture', async () => {
    const archive = await customPortsSourceArchive()
    const temporary = await mkdtemp(
        join(tmpdir(), 'caprover-custom-ports-test-')
    )
    try {
        const path = join(temporary, 'fixture.tar')
        await writeFile(path, new Uint8Array(await archive.arrayBuffer()))
        const { stdout } = await promisify(execFile)('tar', ['-tf', path])
        expect(stdout).toContain('./captain-definition')
        expect(stdout).toContain('./Dockerfile')
        expect(stdout).toContain('./server.js')
        const server = await promisify(execFile)('tar', [
            '-xOf',
            path,
            './server.js',
        ])
        expect(server.stdout).toContain('tcpServer.listen(7000')
        expect(server.stdout).toContain('udpServer.bind(7001')
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
})
