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
