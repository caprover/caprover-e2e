import { afterEach, expect, test, vi } from 'vitest'
import { HttpClient } from '../../src/clients/http'

afterEach(() => vi.restoreAllMocks())

test('exposes response headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('body', {
            status: 200,
            headers: { 'x-caprover-e2e': 'marker' },
        })
    )

    const result = await new HttpClient().get('https://example.test')

    expect(result.headers.get('x-caprover-e2e')).toBe('marker')
})
