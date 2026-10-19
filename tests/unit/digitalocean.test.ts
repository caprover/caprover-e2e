import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadProvisioningConfig } from '../../provisioning/config'
import { DigitalOceanClient } from '../../provisioning/infrastructure/digitalocean'

const config = loadProvisioningConfig({
    DIGITALOCEAN_TOKEN: 'do-token',
    DIGITALOCEAN_SSH_KEY_ID: '12345',
    CLOUDFLARE_API_TOKEN: 'cf-token',
    CLOUDFLARE_ZONE_ID: 'zone-id',
    E2E_BASE_DOMAIN: 'example.test',
    CAPROVER_E2E_SSH_PRIVATE_KEY: 'private-key',
})

const unavailable = () =>
    Response.json(
        {
            id: 'unprocessable_entity',
            message: 'Size is not available in this region.',
        },
        { status: 422 }
    )
const created = (id: number) =>
    Response.json({ droplet: { id } }, { status: 202 })

describe('DigitalOcean region fallback', () => {
    const fetchMock = vi.fn<typeof fetch>()

    beforeEach(() => {
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    function requests() {
        return fetchMock.mock.calls.map(([, init]) =>
            JSON.parse(init!.body as string)
        )
    }

    test('uses only the preferred region when it succeeds', async () => {
        fetchMock.mockResolvedValueOnce(created(101))
        await expect(
            new DigitalOceanClient(config).createDroplet('manager')
        ).resolves.toBe(101)
        expect(requests().map((request) => request.region)).toEqual(['nyc3'])
    })

    test('falls back in order, preserves the request, and starts the worker in the successful region', async () => {
        fetchMock
            .mockResolvedValueOnce(unavailable())
            .mockResolvedValueOnce(unavailable())
            .mockResolvedValueOnce(created(101))
            .mockResolvedValueOnce(created(202))
        const client = new DigitalOceanClient(config)
        await expect(client.createDroplet('manager')).resolves.toBe(101)
        await expect(client.createDroplet('worker')).resolves.toBe(202)
        expect(requests().map((request) => request.region)).toEqual([
            'nyc3',
            'nyc1',
            'sfo3',
            'sfo3',
        ])
        expect(requests().slice(0, 3)).toEqual(
            ['nyc3', 'nyc1', 'sfo3'].map((region) => ({
                name: 'manager',
                region,
                size: config.digitalOceanSize,
                image: config.digitalOceanImage,
                ssh_keys: [config.digitalOceanSshKeyId],
                tags: ['caprover-e2e', 'manager'],
            }))
        )
    })

    test('tries each configured region once and reports exhaustion', async () => {
        fetchMock.mockImplementation(async () => unavailable())
        const client = new DigitalOceanClient({
            ...config,
            digitalOceanFallbackRegions: ['nyc3', 'sfo3', 'sfo3'],
        })
        await expect(client.createDroplet('manager')).rejects.toThrow(
            'unavailable in all attempted regions: nyc3, sfo3'
        )
        expect(requests().map((request) => request.region)).toEqual([
            'nyc3',
            'sfo3',
        ])
    })

    test('allows fallback to be disabled', async () => {
        fetchMock.mockResolvedValueOnce(unavailable())
        const client = new DigitalOceanClient({
            ...config,
            digitalOceanFallbackRegions: [],
        })
        await expect(client.createDroplet('manager')).rejects.toThrow(
            'unavailable in all attempted regions: nyc3'
        )
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test.each([
        [401, 'Unauthorized'],
        [403, 'Forbidden'],
        [429, 'Too many requests'],
        [500, 'Internal server error'],
        [422, 'Invalid size slug'],
        [422, 'Image is not available in this region.'],
        [400, 'Size is not available in this region.'],
    ])('does not retry unrelated API error %i: %s', async (status, message) => {
        fetchMock.mockResolvedValueOnce(Response.json({ message }, { status }))
        await expect(
            new DigitalOceanClient(config).createDroplet('manager')
        ).rejects.toThrow(`DigitalOcean API ${status}`)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('does not retry ambiguous network failures that may have created a droplet', async () => {
        const error = new Error('Connection lost after sending request')
        fetchMock.mockRejectedValueOnce(error)
        await expect(
            new DigitalOceanClient(config).createDroplet('manager')
        ).rejects.toBe(error)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
