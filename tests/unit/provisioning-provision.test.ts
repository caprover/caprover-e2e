import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProvisioningConfig } from '../../provisioning/config'
import { provisionEnvironment } from '../../provisioning/environment/provision'

const mocks = vi.hoisted(() => ({
    configureCapRover: vi.fn(),
    generateCapRoverPassword: vi.fn(),
    waitForWildcardDns: vi.fn(),
    createWildcardRecord: vi.fn(),
    createDroplet: vi.fn(),
    waitForPublicIp: vi.fn(),
    prepareServer: vi.fn(),
    prepareWorker: vi.fn(),
    destroyEnvironment: vi.fn(),
    saveState: vi.fn(),
}))

vi.mock('../../provisioning/caprover', () => ({
    configureCapRover: mocks.configureCapRover,
    generateCapRoverPassword: mocks.generateCapRoverPassword,
    waitForWildcardDns: mocks.waitForWildcardDns,
}))

vi.mock('../../provisioning/infrastructure/cloudflare', () => ({
    CloudflareClient: class {
        createWildcardRecord = mocks.createWildcardRecord
    },
}))

vi.mock('../../provisioning/infrastructure/digitalocean', () => ({
    DigitalOceanClient: class {
        createDroplet = mocks.createDroplet
        waitForPublicIp = mocks.waitForPublicIp
    },
}))

vi.mock('../../provisioning/infrastructure/server', () => ({
    prepareServer: mocks.prepareServer,
    prepareWorker: mocks.prepareWorker,
}))

vi.mock('../../provisioning/environment/destroy', () => ({
    destroyEnvironment: mocks.destroyEnvironment,
}))

vi.mock('../../provisioning/environment/state', () => ({
    saveState: mocks.saveState,
}))

const baseConfig: ProvisioningConfig = {
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

describe('environment provisioning', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        mocks.generateCapRoverPassword
            .mockReturnValueOnce('initial-password')
            .mockReturnValueOnce('test-password')
        mocks.createDroplet
            .mockResolvedValueOnce(101)
            .mockResolvedValueOnce(202)
        mocks.waitForPublicIp.mockImplementation(async (id: number) =>
            id === 101 ? '192.0.2.10' : '192.0.2.20'
        )
        mocks.createWildcardRecord.mockResolvedValue('dns-id')
        mocks.configureCapRover.mockResolvedValue(
            'https://captain.e2e.example.test'
        )
        mocks.waitForWildcardDns.mockResolvedValue(undefined)
        mocks.prepareServer.mockResolvedValue(undefined)
        mocks.prepareWorker.mockResolvedValue(undefined)
        mocks.destroyEnvironment.mockResolvedValue(undefined)
        mocks.saveState.mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('keeps ordinary provisioning on one manager', async () => {
        const result = await provisionEnvironment(baseConfig)

        expect(mocks.createDroplet).toHaveBeenCalledTimes(1)
        expect(mocks.prepareWorker).not.toHaveBeenCalled()
        expect(result.state).not.toHaveProperty('workerDropletId')
        expect(result.testEnvironment).not.toHaveProperty('E2E_WORKER_IP')
    })

    test('creates, prepares, and exports an opted-in worker', async () => {
        const config = { ...baseConfig, provisionWorker: true }
        const result = await provisionEnvironment(config)

        expect(mocks.createDroplet).toHaveBeenCalledTimes(2)
        expect(mocks.createDroplet.mock.calls[0][0]).toMatch(/^caprover-e2e-/)
        expect(mocks.createDroplet.mock.calls[1][0]).toMatch(
            /^caprover-e2e-worker-/
        )
        expect(mocks.prepareServer).toHaveBeenCalledExactlyOnceWith(
            '192.0.2.10',
            'initial-password',
            config
        )
        expect(mocks.prepareWorker).toHaveBeenCalledExactlyOnceWith(
            '192.0.2.20',
            config
        )
        expect(result.state).toMatchObject({
            dropletId: 101,
            ipAddress: '192.0.2.10',
            dnsRecordId: 'dns-id',
            workerDropletId: 202,
            workerIpAddress: '192.0.2.20',
        })
        expect(result.testEnvironment).toMatchObject({
            CAPROVER_E2E_ENVIRONMENT: 'ephemeral',
            CAPROVER_URL: 'https://captain.e2e.example.test',
            CAPROVER_PASSWORD: 'test-password',
            SSH_HOST: '192.0.2.10',
            E2E_WORKER_IP: '192.0.2.20',
        })
    })

    test('tears down complete partial state when worker preparation fails', async () => {
        const config = { ...baseConfig, provisionWorker: true }
        mocks.prepareWorker.mockRejectedValue(new Error('worker setup failed'))

        await expect(provisionEnvironment(config)).rejects.toThrow(
            'worker setup failed'
        )
        expect(mocks.destroyEnvironment).toHaveBeenCalledTimes(1)
        expect(mocks.destroyEnvironment.mock.calls[0][0]).toMatchObject({
            dropletId: 101,
            ipAddress: '192.0.2.10',
            dnsRecordId: 'dns-id',
            workerDropletId: 202,
            workerIpAddress: '192.0.2.20',
        })
        expect(mocks.destroyEnvironment.mock.calls[0][1]).toBe(config)
    })
})
