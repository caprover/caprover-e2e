import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProvisioningConfig } from '../../provisioning/config'
import { destroyEnvironment } from '../../provisioning/environment/destroy'
import type { ProvisioningState } from '../../provisioning/types'

const mocks = vi.hoisted(() => ({
    deleteRecord: vi.fn(),
    findRecordId: vi.fn(),
    deleteDroplet: vi.fn(),
    findDropletIdByName: vi.fn(),
    saveState: vi.fn(),
    removeState: vi.fn(),
}))

vi.mock('../../provisioning/infrastructure/cloudflare', () => ({
    CloudflareClient: class {
        deleteRecord = mocks.deleteRecord
        findRecordId = mocks.findRecordId
    },
}))

vi.mock('../../provisioning/infrastructure/digitalocean', () => ({
    DigitalOceanClient: class {
        deleteDroplet = mocks.deleteDroplet
        findDropletIdByName = mocks.findDropletIdByName
    },
}))

vi.mock('../../provisioning/environment/state', () => ({
    saveState: mocks.saveState,
    removeState: mocks.removeState,
}))

const config = {} as ProvisioningConfig

describe('provisioning teardown', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.deleteRecord.mockResolvedValue(undefined)
        mocks.deleteDroplet.mockResolvedValue(undefined)
        mocks.saveState.mockResolvedValue(undefined)
        mocks.removeState.mockResolvedValue(undefined)
    })

    test('deletes DNS, worker, and manager independently', async () => {
        const state: ProvisioningState = {
            dnsRecordId: 'dns-id',
            dnsRecordName: '*.e2e.example.test',
            workerDropletId: 202,
            workerDropletName: 'worker-name',
            workerIpAddress: '192.0.2.20',
            dropletId: 101,
            dropletName: 'manager-name',
            ipAddress: '192.0.2.10',
        }

        await destroyEnvironment(state, config)

        expect(mocks.deleteRecord).toHaveBeenCalledExactlyOnceWith('dns-id')
        expect(mocks.deleteDroplet.mock.calls).toEqual([[202], [101]])
        expect(mocks.removeState).toHaveBeenCalledExactlyOnceWith()
        expect(state).toMatchObject({
            dnsRecordId: undefined,
            workerDropletId: undefined,
            workerIpAddress: undefined,
            dropletId: undefined,
        })
    })

    test('recovers both droplet IDs from persisted names', async () => {
        mocks.findDropletIdByName.mockImplementation(async (name: string) =>
            name === 'worker-name' ? 202 : 101
        )
        const state: ProvisioningState = {
            workerDropletName: 'worker-name',
            dropletName: 'manager-name',
        }

        await destroyEnvironment(state, config)

        expect(mocks.findDropletIdByName.mock.calls).toEqual([
            ['worker-name'],
            ['manager-name'],
        ])
        expect(mocks.deleteDroplet.mock.calls).toEqual([[202], [101]])
        expect(mocks.removeState).toHaveBeenCalledExactlyOnceWith()
    })

    test('still deletes the manager when worker deletion fails', async () => {
        mocks.deleteDroplet.mockImplementation(async (id: number) => {
            if (id === 202) throw new Error('worker deletion failed')
        })
        const state: ProvisioningState = {
            workerDropletId: 202,
            workerDropletName: 'worker-name',
            dropletId: 101,
            dropletName: 'manager-name',
        }

        await expect(destroyEnvironment(state, config)).rejects.toThrow(
            'Failed to fully clean up E2E environment'
        )
        expect(mocks.deleteDroplet.mock.calls).toEqual([[202], [101]])
        expect(mocks.removeState).not.toHaveBeenCalled()
        expect(state.workerDropletId).toBe(202)
        expect(state.dropletId).toBeUndefined()
    })
})
