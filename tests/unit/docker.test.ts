import { describe, expect, test, vi } from 'vitest'
import { SshClient } from '../../src/clients/ssh'
import { DockerInspector } from '../../src/inspectors/docker'

const docker = new DockerInspector({} as SshClient)

describe('DockerInspector.imageMatches', () => {
    test('matches an exact image tag', () => {
        expect(
            docker.imageMatches('nginx:1.29.8-alpine', 'nginx:1.29.8-alpine')
        ).toBe(true)
    })

    test('matches Docker digest resolution for the expected tag', () => {
        expect(
            docker.imageMatches(
                'nginx:1.29.8-alpine@sha256:abc123',
                'nginx:1.29.8-alpine'
            )
        ).toBe(true)
    })

    test('rejects another image version', () => {
        expect(
            docker.imageMatches('nginx:1.28.3-alpine', 'nginx:1.29.8-alpine')
        ).toBe(false)
    })
})

describe('DockerInspector volume operations', () => {
    test('resolves named volume sources from the application service', async () => {
        const exec = vi.fn().mockResolvedValue({
            stdout: JSON.stringify([
                {
                    Spec: {
                        TaskTemplate: {
                            ContainerSpec: {
                                Mounts: [
                                    {
                                        Type: 'volume',
                                        Source: 'owned-volume',
                                        Target: '/data',
                                    },
                                    {
                                        Type: 'bind',
                                        Source: '/host/path',
                                        Target: '/host',
                                    },
                                ],
                            },
                        },
                    },
                },
            ]),
            stderr: '',
            exitCode: 0,
        })
        const inspector = new DockerInspector({ exec } as unknown as SshClient)

        await expect(
            inspector.getServiceVolumeSources('owned-app')
        ).resolves.toEqual(['owned-volume'])
    })

    test.each([
        'Error: No such volume: owned-volume',
        'Error response from daemon: volume owned-volume not found',
    ])(
        'treats an already absent exact volume as removed: %s',
        async (error) => {
            const exec = vi.fn().mockResolvedValue({
                stdout: '',
                stderr: error,
                exitCode: 1,
            })
            const inspector = new DockerInspector({
                exec,
            } as unknown as SshClient)

            await expect(inspector.volumeExists('owned-volume')).resolves.toBe(
                false
            )
            await expect(inspector.removeVolume('owned-volume')).resolves.toBe(
                undefined
            )
            expect(exec).toHaveBeenNthCalledWith(
                2,
                "docker volume rm 'owned-volume'"
            )
        }
    )

    test('rejects unsafe volume names before running Docker commands', async () => {
        const exec = vi.fn()
        const inspector = new DockerInspector({ exec } as unknown as SshClient)

        await expect(inspector.removeVolume('owned volume')).rejects.toThrow(
            'Unsafe or invalid Docker volume name'
        )
        await expect(inspector.removeVolume('owned--volume')).rejects.toThrow(
            'Unsafe or invalid Docker volume name'
        )
        expect(exec).not.toHaveBeenCalled()
    })
})

test('normalizes service published ports and tolerates an omitted Docker field', async () => {
    const exec = vi.fn().mockResolvedValue({
        stdout: JSON.stringify([
            {
                Spec: {
                    EndpointSpec: {
                        Ports: [
                            {
                                TargetPort: 7000,
                                PublishedPort: 40000,
                                Protocol: 'TCP',
                                PublishMode: 'INGRESS',
                            },
                            {
                                TargetPort: 7001,
                                PublishedPort: 40001,
                                Protocol: 'udp',
                                PublishMode: 'host',
                            },
                            {
                                TargetPort: 0,
                                PublishedPort: 40002,
                                Protocol: 'tcp',
                                PublishMode: 'ingress',
                            },
                            {
                                TargetPort: 7000,
                                PublishedPort: 65536,
                                Protocol: 'tcp',
                                PublishMode: 'ingress',
                            },
                            {
                                TargetPort: 7000,
                                PublishedPort: 40003,
                                Protocol: 'sctp',
                                PublishMode: 'ingress',
                            },
                            {
                                TargetPort: 7000,
                                PublishedPort: 40004,
                                Protocol: 'tcp',
                                PublishMode: 'bridge',
                            },
                        ],
                    },
                },
            },
        ]),
        stderr: '',
        exitCode: 0,
    })
    const inspector = new DockerInspector({ exec } as unknown as SshClient)

    await expect(
        inspector.getServicePublishedPorts('owned-app')
    ).resolves.toEqual([
        {
            targetPort: 7000,
            publishedPort: 40000,
            protocol: 'tcp',
            publishMode: 'ingress',
        },
        {
            targetPort: 7001,
            publishedPort: 40001,
            protocol: 'udp',
            publishMode: 'host',
        },
    ])

    const noPorts = {
        stdout: JSON.stringify([{ Spec: { EndpointSpec: {} } }]),
        stderr: '',
        exitCode: 0,
    }
    exec.mockResolvedValueOnce(noPorts).mockResolvedValueOnce(noPorts)
    await expect(
        inspector.getServicePublishedPorts('owned-app')
    ).resolves.toEqual([])
})

test('reads node placement, update configuration, task nodes, and container labels', async () => {
    const service = {
        Spec: {
            TaskTemplate: {
                Placement: { Constraints: ['node.id == manager-node-id'] },
                ContainerSpec: {
                    Labels: { 'com.caprover.e2e.predeploy': 'marker' },
                },
            },
            UpdateConfig: { Parallelism: 1, Delay: 2_000_000_000 },
        },
    }
    const exec = vi.fn(async (command: string) => {
        if (command === "docker info --format '{{.Swarm.NodeID}}'") {
            return { stdout: 'manager-node-id\n', stderr: '', exitCode: 0 }
        }
        if (command.startsWith('docker service inspect')) {
            return {
                stdout: JSON.stringify([service]),
                stderr: '',
                exitCode: 0,
            }
        }
        if (command.startsWith('docker service ps')) {
            return { stdout: 'task-id\n', stderr: '', exitCode: 0 }
        }
        if (command.startsWith('docker inspect')) {
            return {
                stdout: JSON.stringify([
                    {
                        ID: 'task-id',
                        NodeID: 'manager-node-id',
                        DesiredState: 'running',
                        Status: { State: 'running' },
                    },
                ]),
                stderr: '',
                exitCode: 0,
            }
        }
        throw new Error(`Unexpected Docker command: ${command}`)
    })
    const inspector = new DockerInspector({ exec } as unknown as SshClient)

    await expect(inspector.getLocalManagerNodeId()).resolves.toBe(
        'manager-node-id'
    )
    await expect(
        inspector.getServicePlacementConstraints('owned-app')
    ).resolves.toEqual(['node.id == manager-node-id'])
    await expect(inspector.getRunningTaskNodeIds('owned-app')).resolves.toEqual(
        ['manager-node-id']
    )
    await expect(
        inspector.getServiceUpdateConfig('owned-app')
    ).resolves.toEqual({
        parallelism: 1,
        delay: 2_000_000_000,
    })
    await expect(
        inspector.getServiceContainerLabels('owned-app')
    ).resolves.toEqual({
        'com.caprover.e2e.predeploy': 'marker',
    })
})
