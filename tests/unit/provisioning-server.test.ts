import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProvisioningConfig } from '../../provisioning/config'
import {
    prepareServer,
    prepareWorker,
} from '../../provisioning/infrastructure/server'

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    exec: vi.fn(),
    close: vi.fn(),
}))

vi.mock('../../src/clients/ssh', () => ({
    SshClient: class {
        connect = mocks.connect
        exec = mocks.exec
        close = mocks.close
    },
}))

const config: ProvisioningConfig = {
    digitalOceanToken: 'do-token',
    digitalOceanSshKeyId: 'ssh-key-id',
    cloudflareApiToken: 'cf-token',
    cloudflareZoneId: 'zone-id',
    baseDomain: 'example.test',
    sshPrivateKey: 'private-key',
    digitalOceanRegion: 'nyc3',
    digitalOceanFallbackRegions: ['nyc1', 'sfo3'],
    digitalOceanSize: 's-1vcpu-2gb',
    digitalOceanImage: 'docker-20-04',
    caproverImage: 'caprover/caprover-edge',
    enableHttps: true,
    provisionWorker: false,
}

describe('Docker host preparation', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        mocks.connect.mockResolvedValue(undefined)
        mocks.exec.mockImplementation(async (command: string) =>
            dockerResult(command)
        )
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    test('preserves the ordinary manager firewall setup', async () => {
        await prepareServer('192.0.2.10', 'initial-password', config)

        const command = mocks.exec.mock.calls[0][0] as string
        expect(command).toContain('ufw allow 80/tcp')
        expect(command).toContain('ufw allow 40000:40999/udp')
        expect(command).not.toContain('apt-get install -y -qq ufw')
        expect(command).not.toContain('ufw allow 2377/tcp')
    })

    test('opens the manager ports required by the node-join contract', async () => {
        await prepareServer('192.0.2.10', 'initial-password', {
            ...config,
            provisionWorker: true,
        })

        expect(mocks.exec.mock.calls[0][0]).toEqual(
            expect.stringContaining('ufw allow 2377/tcp')
        )
        expect(mocks.exec.mock.calls[0][0]).toEqual(
            expect.stringContaining('ufw allow 7946/udp')
        )
        expect(mocks.exec.mock.calls[0][0]).toEqual(
            expect.stringContaining('ufw allow 4789/udp')
        )
    })

    test('resolves a digest-pinned install through the running container without inspecting its untagged local alias', async () => {
        const releaseImage = `caprover/caprover:1.15.4@sha256:${'b'.repeat(64)}`
        mocks.exec.mockImplementation(async (command: string) => {
            if (command.includes('docker service inspect captain-captain'))
                return result('caprover/caprover:1.15.4\n')
            if (command.includes('.RepoDigests'))
                return result(`caprover/caprover@sha256:${'b'.repeat(64)}\n`)
            return dockerResult(command)
        })
        await prepareServer('192.0.2.10', 'initial-password', {
            ...config,
            caproverImage: releaseImage,
        })
        expect(mocks.exec.mock.calls.map(([command]) => command)).toContain(
            `docker image inspect '${releaseImage}' --format '{{.Id}}'`
        )
        expect(mocks.exec.mock.calls.map(([command]) => command)).toContain(
            `docker image inspect 'sha256:${'c'.repeat(64)}' --format '{{join .RepoDigests "\\n"}}'`
        )
        expect(
            mocks.exec.mock.calls
                .map(([command]) => command)
                .some((command) =>
                    command.startsWith(
                        "docker image inspect 'caprover/caprover:1.15.4'"
                    )
                )
        ).toBe(false)
        expect(mocks.close).toHaveBeenCalledTimes(1)
    })

    test('waits for the service task to start before resolving its digest', async () => {
        vi.useFakeTimers()
        let taskChecks = 0
        mocks.exec.mockImplementation(async (command: string) => {
            if (command.startsWith('docker ps') && taskChecks++ === 0)
                return result()
            return dockerResult(command)
        })
        const preparation = prepareServer(
            '192.0.2.10',
            'initial-password',
            config
        )
        await vi.advanceTimersByTimeAsync(5_000)
        await preparation
        expect(taskChecks).toBe(2)
    })

    test('rejects a running container that differs from the requested image', async () => {
        mocks.exec.mockImplementation(async (command: string) => {
            if (command.startsWith('docker inspect '))
                return result(`sha256:${'d'.repeat(64)}\n`)
            return dockerResult(command)
        })
        await expect(
            prepareServer('192.0.2.10', 'initial-password', config)
        ).rejects.toThrow('does not match requested image ID')
        expect(mocks.close).toHaveBeenCalledTimes(1)
    })

    test('times out and closes SSH if the running image has no matching digest', async () => {
        vi.useFakeTimers()
        mocks.exec.mockImplementation(async (command: string) => {
            if (command.includes('.RepoDigests')) return result()
            return dockerResult(command)
        })
        const assertion = expect(
            prepareServer('192.0.2.10', 'initial-password', config)
        ).rejects.toThrow(
            'Running CapRover image digest did not become ready within 180000ms'
        )
        await vi.advanceTimersByTimeAsync(180_000)
        await assertion
        expect(mocks.close).toHaveBeenCalledTimes(1)
    })

    test('ensures UFW and Swarm ports are available on the worker', async () => {
        await prepareWorker('192.0.2.20', config)

        const command = mocks.exec.mock.calls[0][0] as string
        expect(command).toContain('apt-get install -y -qq ufw')
        expect(command).toContain('ufw allow 996/tcp')
        expect(command).toContain('ufw allow 2377/tcp')
        expect(command).toContain('ufw allow 7946/tcp')
        expect(command).toContain('ufw allow 7946/udp')
        expect(command).toContain('ufw allow 4789/tcp')
        expect(command).toContain('ufw allow 4789/udp')
        expect(command).toContain('ufw allow 2377/udp')
    })
})

function result(stdout = '') {
    return { stdout, stderr: '', exitCode: 0 }
}

function dockerResult(command: string) {
    if (command.includes('docker service inspect captain-captain'))
        return result('caprover/caprover-edge\n')
    if (command.startsWith('docker ps')) return result('abcdef123456\n')
    if (
        command.startsWith('docker inspect ') ||
        command.includes("--format '{{.Id}}'")
    )
        return result(`sha256:${'c'.repeat(64)}\n`)
    if (command.includes('docker image inspect'))
        return result(`caprover/caprover-edge@sha256:${'a'.repeat(64)}\n`)
    return result()
}
