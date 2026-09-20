import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { sourceArchive } from '../../src/helpers/source-fixture'

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
