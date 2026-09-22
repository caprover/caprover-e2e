import { afterEach, describe, expect, test, vi } from 'vitest'
import { HttpClient } from '../../src/clients/http'

describe('HttpClient', () => {
    afterEach(() => vi.unstubAllGlobals())

    test('forwards headers and redirect mode and exposes response headers', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response('redirected', {
                status: 302,
                headers: { location: 'http://target.example/path' },
            })
        )
        vi.stubGlobal('fetch', fetchMock)

        const result = await new HttpClient().get('http://app.example/path', {
            headers: { authorization: 'Basic credential' },
            redirect: 'manual',
        })

        expect(fetchMock).toHaveBeenCalledWith(
            'http://app.example/path',
            expect.objectContaining({
                headers: { authorization: 'Basic credential' },
                redirect: 'manual',
                signal: expect.any(AbortSignal),
            })
        )
        expect(result.status).toBe(302)
        expect(result.headers.get('location')).toBe(
            'http://target.example/path'
        )
    })
})

test('getBinary preserves response bytes', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0, 255, 10]), {
            status: 200,
            headers: { 'content-type': 'application/x-tar' },
        })
    )
    try {
        const response = await new HttpClient().getBinary(
            'https://example.test'
        )
        expect(response.body).toEqual(Buffer.from([0, 255, 10]))
        expect(response.headers.get('content-type')).toBe('application/x-tar')
    } finally {
        globalThis.fetch = originalFetch
    }
})
