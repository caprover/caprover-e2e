import { describe, expect, test } from 'vitest'
import { loadProvisioningConfig } from '../../provisioning/config.js'
import { generateCapRoverPassword } from '../../provisioning/provision-environment.js'
import { retryUntil } from '../../provisioning/retry.js'

const validEnvironment = {
    DIGITALOCEAN_TOKEN: 'digital-ocean-token',
    DIGITALOCEAN_SSH_KEY_ID: '12345',
    CLOUDFLARE_API_TOKEN: 'cloudflare-token',
    CLOUDFLARE_ZONE_ID: 'zone-id',
    E2E_BASE_DOMAIN: 'example.com',
    CAPROVER_E2E_SSH_PRIVATE_KEY: 'line-one\\nline-two',
}

describe('provisioning configuration', () => {
    test('normalizes a valid base domain', () => {
        expect(
            loadProvisioningConfig({
                ...validEnvironment,
                E2E_BASE_DOMAIN: '.example.com.',
            }).baseDomain
        ).toBe('example.com')
    })

    test('rejects a base domain containing only dots', () => {
        expect(() =>
            loadProvisioningConfig({
                ...validEnvironment,
                E2E_BASE_DOMAIN: '.',
            })
        ).toThrow('E2E_BASE_DOMAIN must contain a domain name')
    })
})

describe('provisioning helpers', () => {
    test('generates passwords accepted by CapRover', () => {
        expect(generateCapRoverPassword()).toHaveLength(28)
    })

    test('bounds a stalled retry operation by its deadline', async () => {
        const startedAt = Date.now()

        await expect(
            retryUntil(
                'stalled operation',
                () => new Promise(() => undefined),
                { timeoutMs: 25, intervalMs: 1 }
            )
        ).rejects.toThrow('did not become ready within 25ms')

        expect(Date.now() - startedAt).toBeLessThan(250)
    })
})
