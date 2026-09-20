import { expect, test } from 'vitest'
import { RawApiClient } from '../src/clients/raw-api'
import { loadConfig } from '../src/config'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
    withDeploymentDiagnostics,
} from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { sourceArchive } from '../src/helpers/source-fixture'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

test('source upload, alternate definition, input validation, and runtime log encodings', async () => {
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { initialAppName: name, runId } = createTestNames()
        const api = context.caprover
        cleanUpApp(context, cleanup, name)
        await api.createApp(name)
        await withDeploymentDiagnostics(context, name, async () => {
            const url = `http://${name}.${rootDomain}`
            let lastMarker = ''
            for (const [label, detached, alternate] of [
                ['attached', false, false],
                ['detached', true, false],
                ['alternate', false, true],
            ] as const) {
                lastMarker = `source-${runId}-${label}`
                const archive = await sourceArchive(lastMarker, alternate)
                await api.updateApp(name, {
                    captainDefinitionRelativeFilePath: alternate
                        ? 'alternate-definition'
                        : 'captain-definition',
                })
                const version = nextVersion(await api.getApp(name))
                await api.uploadSource(name, archive, detached)
                const app = await waitForDeployment(context, name, version)
                const image = app.versions.find(
                    (entry) => entry.version === version
                )!.deployedImageName!
                await waitForImage(context, name, image)
                await context.http.waitUntilReachable(url, lastMarker)
                expect(
                    (await api.getBuildLogs(name)).logs.lines.join('\n')
                ).toContain('E2E_SOURCE_BUILD_COMPLETE')
            }
            const unicodeMarker = `${lastMarker} café فارسی`
            await eventually(
                async () => {
                    expect(
                        (await api.getRuntimeLogs(name, 'ascii')).logs
                    ).toContain(lastMarker)
                    const utf8 = (await api.getRuntimeLogs(name, 'utf8')).logs
                    const hex = (await api.getRuntimeLogs(name, 'hex')).logs
                    expect(utf8).toContain(unicodeMarker)
                    // Docker log snapshots may grow between requests; compare the stable startup record.
                    expect(Buffer.from(hex, 'hex').toString('utf8')).toContain(
                        unicodeMarker
                    )
                },
                { description: 'fixture startup logs' }
            )
            await expect(
                api.getRuntimeLogs(`missing-${runId}`, 'utf8')
            ).rejects.toMatchObject({ captainStatus: expect.any(Number) })

            const config = loadConfig()
            const raw = new RawApiClient(config.caproverUrl)
            await raw.login(config.caproverPassword)
            const path = `/user/apps/appData/${name}`
            expect((await raw.request('POST', path, {})).status).toBe(1108)
            const both = new FormData()
            both.append('sourceFile', await sourceArchive(`both-${runId}`))
            both.append(
                'captainDefinitionContent',
                JSON.stringify({
                    schemaVersion: 2,
                    imageName: 'nginx:1.29.8-alpine',
                })
            )
            expect((await raw.request('POST', path, both)).status).toBe(1108)
            // Reset the path before checking malformed inline captain-definition JSON.
            await api.updateApp(name, {
                captainDefinitionRelativeFilePath: 'captain-definition',
            })
            const workingVersion = (await api.getApp(name)).deployedVersion
            // Unhandled JSON syntax errors use HTTP 500 in CapRover's error catcher.
            await expect(
                raw.request('POST', path, {
                    captainDefinitionContent: '{not-json',
                })
            ).rejects.toMatchObject({ httpStatus: 500 })
            const failedBuild = await api.getBuildLogs(name)
            expect(failedBuild.isAppBuilding).toBe(false)
            expect(failedBuild.isBuildFailed).toBe(true)
            const failureLogs = failedBuild.logs.lines.join('\n')
            expect(failureLogs).toContain(`Build started for ${name}`)
            expect(failureLogs).toMatch(
                /SyntaxError:.*captain-definition.*JSON/
            )
            expect((await api.getApp(name)).deployedVersion).toBe(
                workingVersion
            )
            await context.http.waitUntilReachable(url, lastMarker)
        })
    })
})
