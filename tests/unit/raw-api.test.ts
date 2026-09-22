import { expect, test, vi } from 'vitest'
import { RawApiClient } from '../../src/clients/raw-api'

test('HTTP failures retain their status without trying to parse a JSON envelope', async () => {
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockResolvedValue(
                new Response('Internal Server Error', { status: 500 })
            )
    )
    try {
        await expect(
            new RawApiClient('https://example.test').request(
                'POST',
                '/test',
                {}
            )
        ).rejects.toMatchObject({ httpStatus: 500 })
    } finally {
        vi.unstubAllGlobals()
    }
})

test('JSON API errors retain the server envelope', async () => {
    const envelope = { status: 1108, description: 'Invalid input' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(envelope)))
    try {
        expect(
            await new RawApiClient('https://example.test').request(
                'POST',
                '/test',
                {}
            )
        ).toEqual(envelope)
    } finally {
        vi.unstubAllGlobals()
    }
})

test('additional headers are sent without replacing authenticated API headers', async () => {
    const fetch = vi
        .fn()
        .mockResolvedValueOnce(
            Response.json({
                status: 100,
                description: 'OK',
                data: { token: 'authenticated-token' },
            })
        )
        .mockResolvedValueOnce(
            Response.json({ status: 100, description: 'OK' })
        )
    vi.stubGlobal('fetch', fetch)
    const client = new RawApiClient('https://example.test')
    try {
        await client.login('password')
        await client.request(
            'POST',
            '/test',
            {},
            {
                'x-captain-app-token': 'app-token',
                'x-captain-auth': 'untrusted-token',
                'x-namespace': 'untrusted-namespace',
            }
        )

        expect(fetch).toHaveBeenLastCalledWith(
            'https://example.test/api/v2/test',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'x-captain-app-token': 'app-token',
                    'x-captain-auth': expect.any(String),
                    'x-namespace': 'captain',
                    'Content-Type': 'application/json',
                }),
            })
        )
        expect(
            (fetch.mock.calls[1][1] as RequestInit).headers
        ).not.toMatchObject({ 'x-captain-auth': 'untrusted-token' })
    } finally {
        vi.unstubAllGlobals()
    }
})
