import { expect, test } from 'vitest'
import { SshClient, SshCommandResult } from '../../src/clients/ssh'
import { loadConfig } from '../../src/config'
import type { TestContext } from '../../src/context'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
    waitForServiceStable,
} from '../../src/helpers/deployment'
import { createTestNames } from '../../src/helpers/names'
import { eventually } from '../../src/helpers/retry'
import { sourceArchive } from '../../src/helpers/source-fixture'
import { cleanUpApp, withTestContext } from '../../src/helpers/test-context'
import { DockerInspector } from '../../src/inspectors/docker'
import { requireEphemeral } from '../../src/test-selection'

const FIRST_IMAGE =
    'nginx:1.28.3-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236'
const SECOND_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'
const VOLUME_PATH = '/e2e-data'

test('a worker runs pinned stateless and persistent applications', async () => {
    requireEphemeral()
    const config = loadConfig()
    if (!config.workerIpAddress) {
        throw new Error(
            'Multi-node tests require E2E_WORKER_IP from E2E_PROVISION_WORKER=true provisioning'
        )
    }

    const workerSsh = new SshClient({
        host: config.workerIpAddress,
        port: 22,
        username: 'root',
        privateKey: config.sshPrivateKey,
        commandTimeoutMs: 30_000,
    })
    const workerDocker = new DockerInspector(workerSsh)

    await workerSsh.connect()
    try {
        await withTestContext(async (context, cleanup, rootDomain) => {
            const { runId } = createTestNames()
            const compactId = runId.replaceAll('-', '')
            const statelessApp = `node-${compactId}-s`
            const persistentApp = `node-${compactId}-p`
            const volumeName = `e2e-${runId}-worker-volume`
            const sourceMarker = `worker-source-${runId}`
            const volumeMarker = `worker-volume-${runId}`
            let workerNodeId: string | undefined

            expect(new URL(config.caproverUrl).protocol).toBe('https:')
            expect(await context.caprover.getServerInfo()).toMatchObject({
                hasRootSsl: true,
                forceSsl: true,
            })
            expect(await context.docker.getNodes()).toHaveLength(1)

            cleanup.add(async () => {
                await removeWorkerNode(context, workerSsh, workerNodeId)
            })
            cleanup.add(async () => {
                await disableLocalRegistry(context)
            })

            const registry = await enableDefaultLocalRegistry(context)
            await context.caprover.addDockerNode(
                'worker',
                config.sshPrivateKey,
                config.workerIpAddress!,
                '22',
                'root',
                config.sshHost
            )

            workerNodeId = await eventually(
                async () => {
                    const workerLocalNodeId =
                        await workerDocker.getLocalNodeId()
                    const apiNodes = (await context.caprover.getAllNodes())
                        .nodes
                    const worker = apiNodes.find(
                        (node) => node.nodeId === workerLocalNodeId
                    )
                    expect(worker).toMatchObject({
                        nodeId: workerLocalNodeId,
                        type: 'worker',
                        ip: config.workerIpAddress,
                        state: 'ready',
                        status: 'active',
                    })

                    const dockerNodes = await context.docker.getNodes()
                    expect(dockerNodes).toHaveLength(2)
                    expect(
                        dockerNodes.find(
                            (node) => node.ID === workerLocalNodeId
                        )
                    ).toMatchObject({
                        ID: workerLocalNodeId,
                        Spec: { Role: 'worker', Availability: 'active' },
                        Status: {
                            Addr: config.workerIpAddress,
                            State: 'ready',
                        },
                    })
                    return workerLocalNodeId
                },
                {
                    timeoutMs: 90_000,
                    description: 'worker registration in CapRover and Swarm',
                }
            )

            cleanUpApp(context, cleanup, statelessApp)
            await context.caprover.createApp(statelessApp)
            await waitForServiceStable(context, statelessApp)
            await context.caprover.updateApp(statelessApp, {
                nodeId: workerNodeId,
            })
            await assertWorkerPlacement(context, statelessApp, workerNodeId)
            const sourceVersion = nextVersion(
                await context.caprover.getApp(statelessApp)
            )
            await context.caprover.uploadSource(
                statelessApp,
                await sourceArchive(sourceMarker),
                false
            )
            const sourceApp = await waitForDeployment(
                context,
                statelessApp,
                sourceVersion
            )
            const sourceImage = sourceApp.versions.find(
                (version) => version.version === sourceVersion
            )?.deployedImageName
            expect(sourceImage).toBe(
                `${registry.registryDomain}/${registry.registryImagePrefix}/img-captain-${statelessApp}:${sourceVersion}`
            )
            await waitForImage(context, statelessApp, sourceImage!)
            await assertWorkerPlacement(context, statelessApp, workerNodeId)
            await context.http.waitUntilReachable(
                `http://${statelessApp}.${rootDomain}`,
                sourceMarker,
                60_000
            )

            cleanup.add(async () => {
                await eventually(
                    async () => {
                        await workerDocker.removeVolume(volumeName)
                        expect(
                            await workerDocker.volumeExists(volumeName)
                        ).toBe(false)
                    },
                    { description: `worker volume ${volumeName} deletion` }
                )
            })
            cleanUpApp(context, cleanup, persistentApp)
            await context.caprover.createPersistentApp(persistentApp)
            await context.caprover.updateApp(persistentApp, {
                nodeId: workerNodeId,
                volumes: [{ volumeName, containerPath: VOLUME_PATH }],
            })
            await assertWorkerPlacement(context, persistentApp, workerNodeId)
            expect(
                await context.docker.getServiceVolumeSources(persistentApp)
            ).toEqual([volumeName])
            expect(await workerDocker.volumeExists(volumeName)).toBe(true)
            await context.caprover.deployImage(persistentApp, FIRST_IMAGE)
            await waitForImage(context, persistentApp, FIRST_IMAGE)
            await assertWorkerPlacement(context, persistentApp, workerNodeId)
            expect(
                await context.docker.getServiceVolumeSources(persistentApp)
            ).toEqual([volumeName])
            expect(await workerDocker.volumeExists(volumeName)).toBe(true)
            await workerDocker.writeVolumeMarker(volumeName, volumeMarker)
            const firstTaskIds =
                await context.docker.getRunningTaskIds(persistentApp)
            expect(firstTaskIds).toHaveLength(1)

            await context.caprover.deployImage(persistentApp, SECOND_IMAGE)
            await waitForImage(context, persistentApp, SECOND_IMAGE)
            await assertWorkerPlacement(context, persistentApp, workerNodeId)
            const secondTaskIds =
                await context.docker.getRunningTaskIds(persistentApp)
            expect(secondTaskIds).toHaveLength(1)
            expect(secondTaskIds[0]).not.toBe(firstTaskIds[0])
            expect(await workerDocker.readVolumeMarker(volumeName)).toBe(
                volumeMarker
            )

            await context.caprover.deleteApp(statelessApp)
            await context.caprover.deleteApp(persistentApp)
            await eventually(async () => {
                expect(await context.caprover.appExists(statelessApp)).toBe(
                    false
                )
                expect(await context.caprover.appExists(persistentApp)).toBe(
                    false
                )
                expect(await context.docker.serviceExists(statelessApp)).toBe(
                    false
                )
                expect(await context.docker.serviceExists(persistentApp)).toBe(
                    false
                )
            })
            await eventually(
                async () => {
                    await workerDocker.removeVolume(volumeName)
                    expect(await workerDocker.volumeExists(volumeName)).toBe(
                        false
                    )
                },
                { description: `worker volume ${volumeName} deletion` }
            )

            await disableLocalRegistry(context)
            await removeWorkerNode(context, workerSsh, workerNodeId)
            await eventually(async () => {
                expect(
                    (await context.caprover.getAllNodes()).nodes
                ).toHaveLength(1)
                expect(await context.docker.getNodes()).toHaveLength(1)
            })
        })
    } finally {
        workerSsh.close()
    }
}, 720_000)

async function enableDefaultLocalRegistry(context: TestContext) {
    const api = context.caprover
    const initial = await api.getDockerRegistries()
    expect(
        initial.registries.some(
            (registry) => registry.registryType === 'LOCAL_REG'
        )
    ).toBe(false)

    await api.enableSelfHostedDockerRegistry()
    const local = await eventually(
        async () => {
            const current = await api.getDockerRegistries()
            const candidate = current.registries.find(
                (registry) => registry.registryType === 'LOCAL_REG'
            )
            expect(candidate).toBeDefined()
            return candidate!
        },
        {
            timeoutMs: 60_000,
            description: 'self-hosted registry API entry',
        }
    )
    await waitForServiceStable(context, 'captain-registry')
    await api.setDefaultPushDockerRegistry(local.id)
    expect((await api.getDockerRegistries()).defaultPushRegistryId).toBe(
        local.id
    )
    return local
}

async function disableLocalRegistry(context: TestContext): Promise<void> {
    const current = await context.caprover.getDockerRegistries()
    const local = current.registries.find(
        (registry) => registry.registryType === 'LOCAL_REG'
    )
    if (!local) return
    if (current.defaultPushRegistryId === local.id) {
        await context.caprover.setDefaultPushDockerRegistry('')
    }
    await context.caprover.disableSelfHostedDockerRegistry()
    await eventually(async () => {
        expect(
            (await context.caprover.getDockerRegistries()).registries.some(
                (registry) => registry.registryType === 'LOCAL_REG'
            )
        ).toBe(false)
        expect(await context.docker.serviceExists('captain-registry')).toBe(
            false
        )
    })
}

async function assertWorkerPlacement(
    context: TestContext,
    appName: string,
    workerNodeId: string
): Promise<void> {
    expect((await context.caprover.getApp(appName)).nodeId).toBe(workerNodeId)
    await eventually(
        async () => {
            expect(
                await context.docker.getServicePlacementConstraints(appName)
            ).toContain(`node.id == ${workerNodeId}`)
            expect(await context.docker.getRunningTaskNodeIds(appName)).toEqual(
                [workerNodeId]
            )
            await waitForServiceStable(context, appName)
        },
        {
            timeoutMs: 90_000,
            description: `${appName} placement on the worker`,
        }
    )
}

async function removeWorkerNode(
    context: TestContext,
    workerSsh: SshClient,
    workerNodeId: string | undefined
): Promise<void> {
    const failures: Error[] = []
    let nodeId = workerNodeId
    if (!nodeId) {
        try {
            const info = await workerSsh.exec(
                "docker info --format '{{.Swarm.NodeID}}'"
            )
            if (info.exitCode === 0 && info.stdout.trim()) {
                nodeId = info.stdout.trim()
            }
        } catch (error) {
            failures.push(asError(error))
        }
    }

    try {
        const leave = await workerSsh.exec('docker swarm leave')
        if (leave.exitCode !== 0 && !isAlreadyOutsideSwarm(leave)) {
            failures.push(commandError('worker swarm leave', leave))
        }
    } catch (error) {
        failures.push(asError(error))
    }

    if (nodeId) {
        if (!/^[a-z0-9]{25}$/.test(nodeId)) {
            failures.push(new Error(`Unsafe Docker node ID: ${nodeId}`))
        } else {
            try {
                await eventually(
                    async () => {
                        const result = await context.ssh.exec(
                            `docker node rm --force '${nodeId}'`
                        )
                        if (result.exitCode !== 0 && !isMissingNode(result)) {
                            throw commandError('manager node removal', result)
                        }
                        expect(
                            (await context.docker.getNodes()).some(
                                (node) => node.ID === nodeId
                            )
                        ).toBe(false)
                    },
                    {
                        timeoutMs: 45_000,
                        description: 'worker Swarm node removal',
                    }
                )
            } catch (error) {
                failures.push(asError(error))
            }
        }
    }

    if (failures.length) {
        throw new AggregateError(failures, 'Failed to remove worker node')
    }
}

function isAlreadyOutsideSwarm(result: SshCommandResult): boolean {
    return `${result.stdout}\n${result.stderr}`
        .toLowerCase()
        .includes('not part of a swarm')
}

function isMissingNode(result: SshCommandResult): boolean {
    return /no such node|node .+ not found/i.test(
        `${result.stdout}\n${result.stderr}`
    )
}

function commandError(description: string, result: SshCommandResult): Error {
    return new Error(
        `${description} failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`
    )
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}
