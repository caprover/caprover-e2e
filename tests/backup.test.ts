import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { loadConfig } from '../src/config'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const execFile = promisify(execFileCallback)

test('backup download is inspectable, contains owned configuration, and is one-time', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const { initialAppName: appName } = createTestNames()
        const marker = `backup-${randomUUID()}`
        cleanUpApp(context, cleanup, appName)
        await context.caprover.createApp(appName)
        await context.caprover.updateApp(appName, { description: marker })
        expect((await context.caprover.getApp(appName)).description).toBe(
            marker
        )

        const { downloadToken } = await context.caprover.createBackup()
        expect(downloadToken.length).toBeGreaterThan(0)
        const downloadUrl = backupUrl(downloadToken)

        const invalid = await context.http.getBinary(
            backupUrl(`${downloadToken}x`)
        )
        expect(isTarArchive(invalid)).toBe(false)
        expect(parseEnvelopeStatus(invalid.body)).toBe(1106)

        const archive = await context.http.getBinary(downloadUrl)
        expect(archive.status).toBeGreaterThanOrEqual(200)
        expect(archive.status).toBeLessThan(300)
        expect(archive.body.length).toBeGreaterThan(0)
        expect(archive.headers.get('content-disposition')).toContain(
            'caprover-backup-'
        )
        expect(isTarArchive(archive)).toBe(true)

        const directory = await mkdtemp(join(tmpdir(), 'caprover-e2e-backup-'))
        try {
            const archivePath = join(directory, 'backup.tar')
            await writeFile(archivePath, archive.body)
            const entries = await tarList(archivePath)
            expect(entries).toContain('meta/backup.json')
            expect(entries).toContain('data/config-captain.json')

            const meta = JSON.parse(
                await tarRead(archivePath, 'meta/backup.json')
            ) as { nodes?: Array<{ nodeId?: string }>; salt?: string }
            expect(meta.nodes?.length).toBeGreaterThan(0)
            expect(new Set(meta.nodes?.map((node) => node.nodeId))).toEqual(
                new Set(
                    (await context.caprover.getAllNodes()).nodes.map(
                        (node) => node.nodeId
                    )
                )
            )
            expect(typeof meta.salt).toBe('string')
            expect(meta.salt?.length).toBeGreaterThan(0)

            const config = JSON.parse(
                await tarRead(archivePath, 'data/config-captain.json')
            ) as {
                appDefinitions?: Record<string, { description?: string }>
            }
            expect(config.appDefinitions?.[appName]?.description).toBe(marker)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }

        await eventually(
            async () => {
                const repeated = await context.http.getBinary(downloadUrl)
                expect(isTarArchive(repeated)).toBe(false)
                expect(repeated.status).toBeGreaterThan(0)
            },
            { description: 'one-time backup download to become unavailable' }
        )
    })
})

function backupUrl(downloadToken: string): string {
    const url = new URL('/api/v2/download', loadConfig().caproverUrl)
    url.searchParams.set('namespace', 'captain')
    url.searchParams.set('downloadToken', downloadToken)
    return url.toString()
}

function isTarArchive(response: { status: number; headers: Headers }): boolean {
    return (
        response.status >= 200 &&
        response.status < 300 &&
        response.headers.get('content-disposition')?.includes('.tar') === true
    )
}

function parseEnvelopeStatus(body: Buffer): number | undefined {
    try {
        const value = JSON.parse(body.toString('utf8')) as { status?: unknown }
        return typeof value.status === 'number' ? value.status : undefined
    } catch {
        return undefined
    }
}

async function tarList(archivePath: string): Promise<string[]> {
    const { stdout } = await execFile('tar', ['-tf', archivePath])
    return stdout
        .split(/\r?\n/)
        .map((entry) => entry.replace(/^\.\//, ''))
        .filter(Boolean)
}

async function tarRead(archivePath: string, entry: string): Promise<string> {
    const { stdout } = await execFile('tar', ['-xOf', archivePath, entry])
    return stdout
}
