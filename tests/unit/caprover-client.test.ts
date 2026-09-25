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
    const enableBaseSsl = vi
        .spyOn(CapRoverAPI.prototype, 'enableSslForBaseDomain')
        .mockResolvedValue(undefined)
    const enableCustomSsl = vi
        .spyOn(CapRoverAPI.prototype, 'enableSslForCustomDomain')
        .mockResolvedValue(undefined)
    const remove = vi
        .spyOn(CapRoverAPI.prototype, 'removeCustomDomain')
        .mockResolvedValue(undefined)
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.attachCustomDomain('test-app', 'custom.example.test')
        await client.enableSslForBaseDomain('test-app')
        await client.enableSslForCustomDomain('test-app', 'custom.example.test')
        await client.removeCustomDomain('test-app', 'custom.example.test')

        expect(attach).toHaveBeenCalledExactlyOnceWith(
            'test-app',
            'custom.example.test'
        )
        expect(enableBaseSsl).toHaveBeenCalledExactlyOnceWith('test-app')
        expect(enableCustomSsl).toHaveBeenCalledExactlyOnceWith(
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

test('self-hosted registry operations use the SDK contracts', async () => {
    const enable = vi
        .spyOn(CapRoverAPI.prototype, 'enableSelfHostedDockerRegistry')
        .mockResolvedValue(undefined)
    const setDefault = vi
        .spyOn(CapRoverAPI.prototype, 'setDefaultPushDockerRegistry')
        .mockResolvedValue(undefined)
    const remove = vi
        .spyOn(CapRoverAPI.prototype, 'deleteDockerRegistry')
        .mockResolvedValue(undefined)
    const disable = vi
        .spyOn(CapRoverAPI.prototype, 'disableSelfHostedDockerRegistry')
        .mockResolvedValue(undefined)
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.enableSelfHostedDockerRegistry()
        await client.setDefaultPushDockerRegistry('registry-id')
        await client.deleteDockerRegistry('registry-id')
        await client.disableSelfHostedDockerRegistry()

        expect(enable).toHaveBeenCalledExactlyOnceWith()
        expect(setDefault).toHaveBeenCalledExactlyOnceWith('registry-id')
        expect(remove).toHaveBeenCalledExactlyOnceWith('registry-id')
        expect(disable).toHaveBeenCalledExactlyOnceWith()
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

test('worker addition uses the SDK node contract', async () => {
    const addNode = vi
        .spyOn(CapRoverAPI.prototype, 'addDockerNode')
        .mockResolvedValue(undefined)
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.addDockerNode(
            'worker',
            'private-key',
            '192.0.2.20',
            '22',
            'root',
            '192.0.2.10'
        )
        expect(addNode).toHaveBeenCalledExactlyOnceWith(
            'worker',
            'private-key',
            '192.0.2.20',
            '22',
            'root',
            '192.0.2.10'
        )
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})

test('captain upgrade passes the pinned target tag to the SDK', async () => {
    const update = vi
        .spyOn(CapRoverAPI.prototype, 'performUpdate')
        .mockResolvedValue(undefined)
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await client.performUpdate('a'.repeat(40))
        expect(update).toHaveBeenCalledExactlyOnceWith('a'.repeat(40))
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})

test('Pro and OTP operations use the SDK contract', async () => {
    const claim = vi
        .spyOn(CapRoverAPI.prototype, 'setProApiKey')
        .mockResolvedValue(undefined)
    const setConfig = vi
        .spyOn(CapRoverAPI.prototype, 'setProConfigs')
        .mockResolvedValue(undefined)
    const getOtp = vi
        .spyOn(CapRoverAPI.prototype, 'getOtpStatus')
        .mockResolvedValue({ isEnabled: false })
    const setOtp = vi
        .spyOn(CapRoverAPI.prototype, 'setOtpStatus')
        .mockResolvedValue({ isEnabled: false, otpPath: 'otpauth://totp/test' })
    const client = new CapRoverClient('https://example.test', 'password')
    const config = { alerts: [] }
    try {
        await client.setProApiKey('dedicated-key')
        await client.setProConfigs(config)
        expect(await client.getOtpStatus()).toEqual({ isEnabled: false })
        expect(await client.setOtpStatus({ enabled: true })).toEqual({
            isEnabled: false,
            otpPath: 'otpauth://totp/test',
        })

        expect(claim).toHaveBeenCalledExactlyOnceWith('dedicated-key')
        expect(setConfig).toHaveBeenCalledExactlyOnceWith(config)
        expect(getOtp).toHaveBeenCalledExactlyOnceWith()
        expect(setOtp).toHaveBeenCalledExactlyOnceWith({ enabled: true })
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

test('one-click operations use the SDK parameters and always receive a values array', async () => {
    const template = {
        captainVersion: 4,
        services: {},
        caproverOneClickApp: {
            variables: [],
            instructions: { start: '', end: '' },
            displayName: 'fixture',
        },
    }
    const values = [{ key: '$$cap_appname', value: 'fixture-app' }]
    const apps = vi
        .spyOn(CapRoverAPI.prototype, 'getAllOneClickApps')
        .mockResolvedValue({ oneClickApps: [] })
    const definition = vi
        .spyOn(CapRoverAPI.prototype, 'getOneClickAppByName')
        .mockResolvedValue({ appTemplate: template } as never)
    const repositories = vi
        .spyOn(CapRoverAPI.prototype, 'getAllOneClickAppRepos')
        .mockResolvedValue({ urls: [] })
    const insert = vi
        .spyOn(CapRoverAPI.prototype, 'addNewCustomOneClickRepo')
        .mockResolvedValue(undefined)
    const remove = vi
        .spyOn(CapRoverAPI.prototype, 'deleteCustomOneClickRepo')
        .mockResolvedValue(undefined)
    const start = vi
        .spyOn(CapRoverAPI.prototype, 'startOneClickAppDeploy')
        .mockResolvedValue({ jobId: 'deploy-test' })
    const progress = vi
        .spyOn(CapRoverAPI.prototype, 'getOneClickAppDeployProgress')
        .mockResolvedValue({
            steps: ['done'],
            currentStep: 1,
            error: '',
            successMessage: 'done',
        })
    const client = new CapRoverClient('https://example.test', 'password')
    try {
        await expect(client.getAllOneClickApps()).resolves.toEqual({
            oneClickApps: [],
        })
        await expect(
            client.getOneClickAppByName('fixture', 'https://repo.example')
        ).resolves.toEqual({ appTemplate: template })
        await expect(client.getAllOneClickAppRepos()).resolves.toEqual({
            urls: [],
        })
        await client.addCustomOneClickRepo('https://repo.example')
        await client.deleteCustomOneClickRepo('https://repo.example')
        await expect(
            client.startOneClickAppDeploy(
                template,
                values,
                'TEMPLATE_ONE_CLICK'
            )
        ).resolves.toEqual({ jobId: 'deploy-test' })
        await expect(
            client.getOneClickAppDeployProgress('deploy-test')
        ).resolves.toMatchObject({ currentStep: 1 })

        expect(apps).toHaveBeenCalledExactlyOnceWith()
        expect(definition).toHaveBeenCalledExactlyOnceWith(
            'fixture',
            'https://repo.example'
        )
        expect(repositories).toHaveBeenCalledExactlyOnceWith()
        expect(insert).toHaveBeenCalledExactlyOnceWith('https://repo.example')
        expect(remove).toHaveBeenCalledExactlyOnceWith('https://repo.example')
        expect(start).toHaveBeenCalledExactlyOnceWith(
            template,
            values,
            'TEMPLATE_ONE_CLICK'
        )
        expect(progress).toHaveBeenCalledExactlyOnceWith('deploy-test')
    } finally {
        client.destroy()
        vi.restoreAllMocks()
    }
})
