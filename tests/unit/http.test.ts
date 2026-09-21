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
