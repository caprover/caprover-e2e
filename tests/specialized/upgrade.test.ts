import { expect, test } from 'vitest'
import { CapRoverClient } from '../../src/clients/caprover'
import { loadConfig } from '../../src/config'
import {
    waitForImage,
    waitForServiceStable,
} from '../../src/helpers/deployment'
import { createTestNames } from '../../src/helpers/names'
import { eventually } from '../../src/helpers/retry'
import {
    cleanUpApp,
    cleanUpVolume,
    withTestContext,
} from '../../src/helpers/test-context'
import { requireEphemeral } from '../../src/test-selection'

const APP_IMAGE =
    'nginx:1.28.3-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236'

test('a released server preserves its data through edge and the edge update API', async () => {
    requireEphemeral()
    const config = loadConfig()
    const release = process.env.E2E_UPGRADE_RELEASE_TAG
    const from = process.env.E2E_UPGRADE_EDGE_FROM_SHA
    const to = process.env.E2E_UPGRADE_EDGE_TO_SHA
    const releaseDigest = process.env.E2E_UPGRADE_RELEASE_DIGEST
    const fromDigest = process.env.E2E_UPGRADE_EDGE_FROM_DIGEST
    const toDigest = process.env.E2E_UPGRADE_EDGE_TO_DIGEST
    if (
        !/^\d+\.\d+\.\d+$/.test(release ?? '') ||
        !/^[a-f0-9]{40}$/.test(from ?? '') ||
        !/^[a-f0-9]{40}$/.test(to ?? '') ||
        ![releaseDigest, fromDigest, toDigest].every((digest) =>
            /^sha256:[a-f0-9]{64}$/.test(digest ?? '')
        ) ||
        from === to ||
        fromDigest === toDigest
    ) {
        throw new Error('Run the pinned upgrade-image preflight before testing')
    }
    const releasedImage = `caprover/caprover:${release}@${releaseDigest}`
    const edgeFrom = `caprover/caprover-edge:${from}@${fromDigest}`
    const edgeTo = `caprover/caprover-edge:${to}@${toDigest}`

    await withTestContext(async (context, cleanup, rootDomain) => {
        const { runId } = createTestNames()
        const projectName = `e2e-${runId}-upgrade`
        const appName = `e2e-${runId}-upgrade-app`
        const volumeName = `e2e-${runId}-upgrade-data`
        const marker = `upgrade-marker-${runId}`
        const description = `Upgrade fixture ${runId}`
        const volume = { containerPath: '/e2e-data', volumeName }
        const appUrl = `http://${appName}.${rootDomain}`

        // The installer must have installed the release, not just run its CLI image.
        const releaseImageId = await pullAndGetImageId(releasedImage)
        await waitForCaptain(releasedImage, releaseImageId)
        expect((await context.caprover.getVersionInfo()).currentVersion).toBe(
            release
        )

        cleanup.add(async () => {
            const { projects } = await context.caprover.getProjects()
            for (const project of projects.filter(
                (item) => item.name === projectName
            )) {
                await context.caprover.deleteProject(project.id)
            }
        })
        const project = await context.caprover.createProject(
            projectName,
            description
        )
        cleanUpVolume(context, cleanup, volumeName)
        cleanUpApp(context, cleanup, appName)
        await context.caprover.createPersistentApp(appName)
        await waitForServiceStable(context, appName)
        await context.caprover.updateApp(appName, {
            description,
            projectId: project.id,
            volumes: [volume],
        })
        await waitForServiceStable(context, appName)
        await context.docker.writeVolumeMarker(volumeName, marker)
        await context.caprover.deployImage(appName, APP_IMAGE)
        await waitForImage(context, appName, APP_IMAGE)
        await verifyFixture()

        // A release's built-in update API only targets caprover/caprover.
        // Switch repositories using Docker, preserving the Swarm service and data.
        const edgeFromId = await pullAndGetImageId(edgeFrom)
        const firstUpdate = await context.ssh.exec(
            `docker service update --detach=false --image '${edgeFrom}' captain-captain`,
            240_000
        )
        if (firstUpdate.exitCode !== 0) {
            throw new Error(
                `Release to edge service update failed: ${firstUpdate.stderr}`
            )
        }
        await waitForCaptain(edgeFrom, edgeFromId)
        await verifyFixture()

        // CapRover's edge image declares caprover/caprover-edge as its update
        // repository; its API accepts the target's commit SHA as a version tag.
        const edgeToId = await pullAndGetImageId(edgeTo)
        try {
            await context.caprover.performUpdate(to!)
        } catch (error) {
            if (
                error &&
                typeof error === 'object' &&
                'captainStatus' in error
            ) {
                throw error
            }
            // The server may close its own request while replacing its task.
            // The observed running image and fresh login below decide success.
        }
        await waitForCaptain(edgeTo, edgeToId)
        await verifyFixture()

        async function pullAndGetImageId(image: string): Promise<string> {
            const pull = await context.ssh.exec(
                `docker pull '${image}'`,
                180_000
            )
            if (pull.exitCode !== 0) {
                throw new Error(`Could not pull pinned upgrade image: ${image}`)
            }
            const inspect = await context.ssh.exec(
                `docker image inspect '${image}' --format '{{.Id}}'`
            )
            if (
                inspect.exitCode !== 0 ||
                !/^sha256:[a-f0-9]{64}$/.test(inspect.stdout.trim())
            ) {
                throw new Error(
                    `Could not inspect pinned upgrade image: ${image}`
                )
            }
            return inspect.stdout.trim()
        }

        async function waitForCaptain(
            image: string,
            expectedImageId?: string
        ): Promise<void> {
            await eventually(
                async () => {
                    const service = await context.ssh.exec(
                        "docker service inspect captain-captain --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}|{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}'"
                    )
                    expect(service.exitCode).toBe(0)
                    const [actualImage, updateState] = service.stdout
                        .trim()
                        .split('|')
                    const tag = image.split('@')[0]
                    expect(
                        actualImage === image ||
                            actualImage === tag ||
                            actualImage.startsWith(`${tag}@`)
                    ).toBe(true)
                    expect(
                        updateState === '' || updateState === 'completed'
                    ).toBe(true)

                    const containers = await context.ssh.exec(
                        "docker ps --filter 'label=com.docker.swarm.service.name=captain-captain' --format '{{.ID}}'"
                    )
                    expect(containers.exitCode).toBe(0)
                    const ids = containers.stdout
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                    expect(ids).toHaveLength(1)
                    const running = await context.ssh.exec(
                        `docker inspect '${ids[0]}' --format '{{.Image}}'`
                    )
                    expect(running.exitCode).toBe(0)
                    if (expectedImageId)
                        expect(running.stdout.trim()).toBe(expectedImageId)

                    const fresh = new CapRoverClient(
                        config.caproverUrl,
                        config.caproverPassword
                    )
                    try {
                        await fresh.login()
                        expect((await fresh.getServerInfo()).rootDomain).toBe(
                            rootDomain
                        )
                    } finally {
                        fresh.destroy()
                    }
                },
                {
                    timeoutMs: 240_000,
                    intervalMs: 3_000,
                    description: `captain to run ${image}`,
                }
            )
        }

        async function verifyFixture(): Promise<void> {
            await eventually(
                async () => {
                    const app = await context.caprover.getApp(appName)
                    expect(app.description).toBe(description)
                    expect(app.projectId).toBe(project.id)
                    expect(app.volumes).toEqual([volume])
                    expect(
                        (await context.caprover.getProjects()).projects
                    ).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                id: project.id,
                                name: projectName,
                                description,
                            }),
                        ])
                    )
                    expect(
                        await context.docker.readVolumeMarker(volumeName)
                    ).toBe(marker)
                    expect(
                        await context.docker.getServiceVolumeSources(appName)
                    ).toEqual([volumeName])
                    await waitForImage(context, appName, APP_IMAGE)
                    await context.http.waitUntilReachable(
                        appUrl,
                        'Welcome to nginx!'
                    )
                },
                { timeoutMs: 120_000, description: 'upgrade fixture recovery' }
            )
        }
    })
}, 900_000)
