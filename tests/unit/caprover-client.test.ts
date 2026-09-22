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

test('persistent creation and owned-volume deletion use the SDK parameters', async () => {
    const register = vi
        .spyOn(CapRoverAPI.prototype, 'registerNewApp')
        .mockResolvedValue(undefined)
    const deleteApp = vi
        .spyOn(CapRoverAPI.prototype, 'deleteApp')
        .mockResolvedValue({ volumesFailedToDelete: ['owned-volume'] })
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.createPersistentApp('owned-app')
        expect(register).toHaveBeenCalledExactlyOnceWith(
            'owned-app',
            '',
            true,
            false
        )

        await expect(
            client.deleteApp('owned-app', ['owned-volume'])
        ).resolves.toEqual({ volumesFailedToDelete: ['owned-volume'] })
        expect(deleteApp).toHaveBeenCalledExactlyOnceWith(
            'owned-app',
            ['owned-volume'],
            undefined
        )
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})

test('bulk deletion uses the SDK appNames parameter', async () => {
    const deleteApp = vi
        .spyOn(CapRoverAPI.prototype, 'deleteApp')
        .mockResolvedValue({ volumesFailedToDelete: [] })
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await expect(
            client.deleteApps(['first-app', 'second-app'])
        ).resolves.toEqual({
            volumesFailedToDelete: [],
        })
        expect(deleteApp).toHaveBeenCalledExactlyOnceWith(
            undefined,
            [],
            ['first-app', 'second-app']
        )
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})

test('custom-domain operations use the SDK parameters', async () => {
    const attach = vi
        .spyOn(CapRoverAPI.prototype, 'attachNewCustomDomainToApp')
        .mockResolvedValue(undefined)
    const remove = vi
        .spyOn(CapRoverAPI.prototype, 'removeCustomDomain')
        .mockResolvedValue(undefined)
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.attachCustomDomain('test-app', 'custom.example.test')
        await client.removeCustomDomain('test-app', 'custom.example.test')

        expect(attach).toHaveBeenCalledExactlyOnceWith(
            'test-app',
            'custom.example.test'
        )
        expect(remove).toHaveBeenCalledExactlyOnceWith(
            'test-app',
            'custom.example.test'
        )
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})

test('theme operations use the SDK parameters', async () => {
    const themes = vi
        .spyOn(CapRoverAPI.prototype, 'getAllThemes')
        .mockResolvedValue({ themes: [] })
    const current = vi
        .spyOn(CapRoverAPI.prototype, 'getCurrentTheme')
        .mockResolvedValue({ theme: undefined } as never)
    const save = vi
        .spyOn(CapRoverAPI.prototype, 'saveTheme')
        .mockResolvedValue({})
    const setCurrent = vi
        .spyOn(CapRoverAPI.prototype, 'setCurrentTheme')
        .mockResolvedValue({})
    const remove = vi
        .spyOn(CapRoverAPI.prototype, 'deleteTheme')
        .mockResolvedValue({})
    const client = new CapRoverClient('https://example.test', 'password')
    const theme = { name: 'custom', content: 'content', extra: 'extra' }
    try {
        await expect(client.getAllThemes()).resolves.toEqual({ themes: [] })
        await expect(client.getCurrentTheme()).resolves.toEqual({
            theme: undefined,
        })
        await client.saveTheme('', theme)
        await client.setCurrentTheme(theme.name)
        await client.deleteTheme(theme.name)

        expect(themes).toHaveBeenCalledExactlyOnceWith()
        expect(current).toHaveBeenCalledExactlyOnceWith()
        expect(save).toHaveBeenCalledExactlyOnceWith('', theme)
        expect(setCurrent).toHaveBeenCalledExactlyOnceWith(theme.name)
        expect(remove).toHaveBeenCalledExactlyOnceWith(theme.name)
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})

test('system read and backup operations use the SDK parameters', async () => {
    const version = vi
        .spyOn(CapRoverAPI.prototype, 'getVersionInfo')
        .mockResolvedValue({} as never)
    const loadBalancer = vi
        .spyOn(CapRoverAPI.prototype, 'getLoadBalancerInfo')
        .mockResolvedValue({} as never)
    const nodes = vi
        .spyOn(CapRoverAPI.prototype, 'getAllNodes')
        .mockResolvedValue({ nodes: [] } as never)
    const features = vi
        .spyOn(CapRoverAPI.prototype, 'getProFeaturesState')
        .mockResolvedValue({ proFeaturesState: {} } as never)
    const configs = vi
        .spyOn(CapRoverAPI.prototype, 'getProConfigs')
        .mockResolvedValue({ proConfigs: { alerts: [] } } as never)
    const backup = vi
        .spyOn(CapRoverAPI.prototype, 'createBackup')
        .mockResolvedValue({ downloadToken: 'token' })
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.getVersionInfo()
        await client.getLoadBalancerInfo()
        await client.getAllNodes()
        await client.getProFeaturesState()
        await client.getProConfigs()
        await expect(client.createBackup()).resolves.toEqual({
            downloadToken: 'token',
        })

        for (const spy of [
            version,
            loadBalancer,
            nodes,
            features,
            configs,
            backup,
        ])
            expect(spy).toHaveBeenCalledExactlyOnceWith()
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})

test('disk-cleanup and global Nginx operations use the SDK parameters', async () => {
    const cleanupSettings = {
        mostRecentLimit: 2,
        cronSchedule: '0 3 * * *',
        timezone: 'UTC',
    }
    const nginxConfig = {
        baseConfig: { byDefault: 'base-default', customValue: 'base-custom' },
        captainConfig: {
            byDefault: 'captain-default',
            customValue: 'captain-custom',
        },
    }
    const getCleanup = vi
        .spyOn(CapRoverAPI.prototype, 'getDiskCleanUpSettings')
        .mockResolvedValue(cleanupSettings)
    const setCleanup = vi
        .spyOn(CapRoverAPI.prototype, 'setDiskCleanUpSettings')
        .mockResolvedValue(undefined)
    const getUnused = vi
        .spyOn(CapRoverAPI.prototype, 'getUnusedImages')
        .mockResolvedValue({ unusedImages: [] })
    const deleteImages = vi
        .spyOn(CapRoverAPI.prototype, 'deleteImages')
        .mockResolvedValue(undefined)
    const getNginx = vi
        .spyOn(CapRoverAPI.prototype, 'getNginxConfig')
        .mockResolvedValue(nginxConfig)
    const setNginx = vi
        .spyOn(CapRoverAPI.prototype, 'setNginxConfig')
        .mockResolvedValue(undefined)
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await expect(client.getDiskCleanupSettings()).resolves.toEqual(
            cleanupSettings
        )
        await client.setDiskCleanupSettings(cleanupSettings)
        await expect(client.getUnusedImages(0)).resolves.toEqual({
            unusedImages: [],
        })
        await client.deleteImages(['sha256:owned'])
        await expect(client.getNginxConfig()).resolves.toEqual(nginxConfig)
        await client.setNginxConfig('base-custom', 'captain-custom')

        expect(getCleanup).toHaveBeenCalledExactlyOnceWith()
        expect(setCleanup).toHaveBeenCalledExactlyOnceWith(
            2,
            '0 3 * * *',
            'UTC'
        )
        expect(getUnused).toHaveBeenCalledExactlyOnceWith(0)
        expect(deleteImages).toHaveBeenCalledExactlyOnceWith(['sha256:owned'])
        expect(getNginx).toHaveBeenCalledExactlyOnceWith()
        expect(setNginx).toHaveBeenCalledExactlyOnceWith(
            'base-custom',
            'captain-custom'
        )
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})
