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
