import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

export interface OneClickRepositoryFixtureData {
    list: { oneClickApps: unknown[] }
    templates: Record<string, unknown>
}

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
    return fixtureArchive('routing', 'routing-app')
}

export async function customPortsSourceArchive(): Promise<File> {
    return fixtureArchive('custom-ports', 'custom-ports-app')
}

export async function oneClickRepositorySourceArchive(
    data: OneClickRepositoryFixtureData
): Promise<File> {
    const temporary = await mkdtemp(join(tmpdir(), 'caprover-e2e-one-click-'))
    try {
        const source = join(temporary, 'source')
        await cp(
            join(process.cwd(), 'tests/fixtures/one-click-repository-app'),
            source,
            { recursive: true }
        )
        await writeFile(
            join(source, 'repository-data.json'),
            `${JSON.stringify(data, null, 2)}\n`
        )
        return await archiveFixture(
            source,
            'one-click-repository-source.tar',
            temporary
        )
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}

async function fixtureArchive(
    name: string,
    fixtureDirectory: string
): Promise<File> {
    const temporary = await mkdtemp(join(tmpdir(), `caprover-e2e-${name}-`))
    try {
        return await archiveFixture(
            join(process.cwd(), 'tests/fixtures', fixtureDirectory),
            `${name}-source.tar`,
            temporary
        )
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}

async function archiveFixture(
    source: string,
    fileName: string,
    destinationDirectory: string
): Promise<File> {
    const archive = join(destinationDirectory, fileName)
    await promisify(execFile)('tar', ['-cf', archive, '-C', source, '.'], {
        timeout: 10_000,
    })
    return new File([new Uint8Array(await readFile(archive))], fileName, {
        type: 'application/x-tar',
    })
}
