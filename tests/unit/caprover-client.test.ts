import { expect, test, vi } from 'vitest'
import CapRoverAPI from 'caprover-api'
import { CapRoverClient } from '../../src/clients/caprover'

test('full updates retain existing fields via POST; PATCH sends only supplied changes', async () => {
    const current = {
        appName: 'test-app',
        description: 'keep',
        envVars: [{ key: 'KEEP', value: 'value' }],
    }
    const get = vi
        .spyOn(CapRoverAPI.prototype, 'getAllApps')
        .mockResolvedValue({
            appDefinitions: [current],
            rootDomain: 'example.test',
        } as never)
    const post = vi
        .spyOn(CapRoverAPI.prototype, 'updateConfigAndSave')
        .mockResolvedValue(undefined)
    const patch = vi
        .spyOn(CapRoverAPI.prototype, 'patchAppDefinition')
        .mockResolvedValue(undefined)
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.updateApp('test-app', { instanceCount: 2 })
        expect(post).toHaveBeenCalledExactlyOnceWith('test-app', {
            ...current,
            instanceCount: 2,
        })
        await client.patchApp('test-app', { instanceCount: 0 })
        expect(patch).toHaveBeenCalledExactlyOnceWith('test-app', {
            instanceCount: 0,
        })
        expect(get).toHaveBeenCalledTimes(1)
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})
