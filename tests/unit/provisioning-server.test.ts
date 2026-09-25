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
        mocks.exec.mockImplementation(async (command: string) => {
            if (command.includes('docker service inspect captain-captain')) {
                return result('caprover/caprover-edge\n')
            }
            if (command.includes('docker image inspect')) {
                return result(
                    `caprover/caprover-edge@sha256:${'a'.repeat(64)}\n`
                )
            }
            return result()
        })
    })

    afterEach(() => {
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
