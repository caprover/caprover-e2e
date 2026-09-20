import { randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import { RawApiClient } from '../src/clients/raw-api'
import { loadConfig } from '../src/config'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
    waitForServiceStable,
    withDeploymentDiagnostics,
} from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const FIRST_IMAGE =
    'nginx:1.28.3-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236'
const SECOND_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'

test('attached and detached deployment, controlled failure, missing image, and recovery', async () => {
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { initialAppName: name, runId } = createTestNames()
        const api = context.caprover
        cleanUpApp(context, cleanup, name)
        await api.createApp(name)
        await waitForServiceStable(context, name)
        await withDeploymentDiagnostics(context, name, async () => {
            const url = `http://${name}.${rootDomain}`
            const before = await api.getApp(name)
            const gitHash = randomBytes(20).toString('hex')
            await api.deployDefinition(
                name,
                { schemaVersion: 2, imageName: FIRST_IMAGE },
                gitHash
            )
            let app = await waitForDeployment(
                context,
                name,
                nextVersion(before),
                gitHash
            )
            expect(app.deployedVersion).toBe(before.deployedVersion + 1)
            expect(
                app.versions.find(
                    (item) => item.version === app.deployedVersion
                )?.deployedImageName
            ).toBe(FIRST_IMAGE)
            await waitForImage(context, name, FIRST_IMAGE)
            await context.http.waitUntilReachable(url, 'Welcome to nginx!')

            const config = loadConfig()
            const raw = new RawApiClient(config.caproverUrl)
            await raw.login(config.caproverPassword)
            const detachedHash = randomBytes(20).toString('hex')
            const expectedVersion = nextVersion(app)
            const response = await raw.request(
                'POST',
                `/user/apps/appData/${name}?detached=1`,
                {
                    captainDefinitionContent: JSON.stringify({
                        schemaVersion: 2,
                        imageName: SECOND_IMAGE,
                    }),
                    gitHash: detachedHash,
                }
            )
            expect(response.status).toBe(101)
            app = await waitForDeployment(
                context,
                name,
                expectedVersion,
                detachedHash
            )
            expect(
                app.versions.find(
                    (item) => item.version === app.deployedVersion
                )?.deployedImageName
            ).toBe(SECOND_IMAGE)
            await waitForImage(context, name, SECOND_IMAGE)
            await context.http.waitUntilReachable(url, 'Welcome to nginx!')
            const workingVersion = app.deployedVersion

            const marker = `intentional-failure-${runId}`
            await api.deployDefinition(
                name,
                {
                    schemaVersion: 2,
                    dockerfileLines: [
                        `FROM ${SECOND_IMAGE}`,
                        `RUN echo ${marker} && exit 42`,
                    ],
                },
                randomBytes(20).toString('hex'),
                true
            )
            await eventually(
                async () => {
                    const build = await api.getBuildLogs(name)
                    expect(build.isAppBuilding).toBe(false)
                    expect(build.isBuildFailed).toBe(true)
                    expect(build.logs.lines.join('\n')).toContain(marker)
                },
                { timeoutMs: 90_000, description: 'controlled build failure' }
            )
            expect((await api.getApp(name)).deployedVersion).toBe(
                workingVersion
            )
            await waitForImage(context, name, SECOND_IMAGE)
            await context.http.waitUntilReachable(url, 'Welcome to nginx!')

            // A unique nonexistent tag in the same public repository; transport failures do not count.
            const missing = `nginx:caprover-e2e-missing-${runId}`
            await api.deployDefinition(
                name,
                { schemaVersion: 2, imageName: missing },
                randomBytes(20).toString('hex'),
                true
            )
            await eventually(
                async () => {
                    const build = await api.getBuildLogs(name)
                    expect(build.isAppBuilding).toBe(false)
                    expect(build.isBuildFailed).toBe(true)
                    const logs = build.logs.lines.join('\n')
                    expect(logs).toContain(missing)
                    const missingManifest =
                        /manifest unknown|manifest.*not found/i.test(logs)
                    const missingReference =
                        logs.includes('(HTTP code 404)') &&
                        logs.includes('failed to resolve reference') &&
                        logs.includes(`${missing}: not found`)
                    expect(missingManifest || missingReference).toBe(true)
                },
                { timeoutMs: 90_000, description: 'missing-image rejection' }
            )
            expect((await api.getApp(name)).deployedVersion).toBe(
                workingVersion
            )
            await waitForImage(context, name, SECOND_IMAGE)
            await context.http.waitUntilReachable(url, 'Welcome to nginx!')

            const recoveryVersion = nextVersion(await api.getApp(name))
            const recoveryHash = randomBytes(20).toString('hex')
            await api.deployDefinition(
                name,
                { schemaVersion: 2, imageName: FIRST_IMAGE },
                recoveryHash
            )
            await waitForDeployment(
                context,
                name,
                recoveryVersion,
                recoveryHash
            )
            await waitForImage(context, name, FIRST_IMAGE)
            await context.http.waitUntilReachable(url, 'Welcome to nginx!')
        })
    })
})
