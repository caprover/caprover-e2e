import { describe, expect, test } from 'vitest'
import { generateCapRoverPassword } from '../../provisioning/caprover'
import { loadProvisioningConfig } from '../../provisioning/config'
import { retryUntil } from '../../provisioning/retry'

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

    test('defaults to the DigitalOcean Docker image', () => {
        expect(loadProvisioningConfig(validEnvironment).digitalOceanImage).toBe(
            'docker-20-04'
        )
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

    test('retries stalled operations when an attempt timeout is set', async () => {
        let attempts = 0

        await expect(
            retryUntil(
                'retrying stalled operation',
                () => {
                    attempts += 1
                    return new Promise(() => undefined)
                },
                {
                    timeoutMs: 45,
                    intervalMs: 1,
                    attemptTimeoutMs: 10,
                }
            )
        ).rejects.toThrow('did not become ready within 45ms')

        expect(attempts).toBeGreaterThan(1)
    })
})
