import { expect, test } from 'vitest'
import { CapRoverClient } from '../src/clients/caprover'
import { RawApiClient } from '../src/clients/raw-api'
import { loadConfig } from '../src/config'

const config = loadConfig()

test('login validation, authorization, and SDK server-error propagation', async () => {
    const client = new CapRoverClient(
        config.caproverUrl,
        config.caproverPassword
    )
    const wrong = new CapRoverClient(config.caproverUrl, 'e2e-invalid-password')
    const raw = new RawApiClient(config.caproverUrl)
    try {
        await client.login()
        // These validations return before the server increments its failed-login counter.
        for (const password of ['', 'x'.repeat(30)]) {
            const response = await raw.request('POST', '/login', { password })
            expect(response.status).toBe(1000)
            expect(response.description).not.toBe('')
        }
        const unauthenticated = await raw.request(
            'GET',
            '/user/apps/appDefinitions'
        )
        expect(unauthenticated.status).toBe(1106)
        // One wrong-password attempt per run; no retries or brute-force/backoff test.
        await expect(wrong.login()).rejects.toMatchObject({
            captainStatus: 1105,
            captainMessage: 'Invalid credentials',
        })
    } finally {
        client.destroy()
        wrong.destroy()
    }
})
