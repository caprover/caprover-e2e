import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

export async function sourceArchive(
    marker: string,
    alternate = false
): Promise<File> {
    if (!/^[a-z0-9-]+$/.test(marker)) throw new Error('Unsafe fixture marker')
    const temporary = await mkdtemp(join(tmpdir(), 'caprover-e2e-'))
    try {
        const source = join(temporary, 'source')
        await cp(join(process.cwd(), 'tests/fixtures/source-app'), source, {
            recursive: true,
        })
        await writeFile(join(source, 'response.txt'), marker)
        // One startup record, stable across repeated log snapshots and safe to print in diagnostics.
        await writeFile(
            join(source, 'log-marker.sh'),
            `#!/bin/sh\nprintf '%s\\n' '${marker} café فارسی'\n`
        )
        if (alternate) {
            await cp(
                join(source, 'captain-definition'),
                join(source, 'alternate-definition')
            )
            await rm(join(source, 'captain-definition'))
        }
        const archive = join(temporary, 'source.tar')
        await promisify(execFile)('tar', ['-cf', archive, '-C', source, '.'], {
            timeout: 10_000,
        })
        return new File(
            [new Uint8Array(await readFile(archive))],
            'source.tar',
            { type: 'application/x-tar' }
        )
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}

export async function routingSourceArchive(): Promise<File> {
    const temporary = await mkdtemp(join(tmpdir(), 'caprover-e2e-routing-'))
    try {
        const archive = join(temporary, 'source.tar')
        await promisify(execFile)(
            'tar',
            [
                '-cf',
                archive,
                '-C',
                join(process.cwd(), 'tests/fixtures/routing-app'),
                '.',
            ],
            { timeout: 10_000 }
        )
        return new File(
            [new Uint8Array(await readFile(archive))],
            'routing-source.tar',
            { type: 'application/x-tar' }
        )
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}
