import CapRoverAPI, {
    CapRoverModels,
    SimpleAuthenticationProvider,
} from 'caprover-api'
import { expect, test } from 'vitest'
import { RawApiClient } from '../../src/clients/raw-api'
import { loadConfig } from '../../src/config'
import { totpFromUri } from '../../src/helpers/totp'
import { withTestContext } from '../../src/helpers/test-context'
import { requireEphemeral } from '../../src/test-selection'

test('a dedicated Pro key enables 2FA and requires TOTP at login', async () => {
    requireEphemeral()
    const apiKey = process.env.E2E_PRO_API_KEY?.trim()
    if (!apiKey) throw new Error('E2E_PRO_API_KEY is required for Pro tests')

    const config = loadConfig()
    if (new URL(config.caproverUrl).protocol !== 'https:') {
        throw new Error('Pro and 2FA tests require E2E_ENABLE_HTTPS=true')
    }

    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        expect((await api.getProFeaturesState()).isSubscribed).toBe(false)
        expect((await api.getOtpStatus()).isEnabled).toBe(false)

        await api.setProApiKey(apiKey)
        expect(await api.getProFeaturesState()).toMatchObject({
            isSubscribed: true,
            isFeatureFlagEnabled: true,
        })

        const initialConfigs = await api.getProConfigs()
        cleanup.add(async () => {
            await api.setProConfigs(initialConfigs)
            expect(await api.getProConfigs()).toEqual(initialConfigs)
        })
        const proConfigs = {
            alerts: [
                {
                    event: CapRoverModels.ProAlertEvent.AppBuildFailed,
                    action: {
                        actionType: CapRoverModels.ProAlertActionType.email,
                    },
                },
            ],
        }
        await api.setProConfigs(proConfigs)
        expect(await api.getProConfigs()).toEqual(proConfigs)

        // The backend stores the 2FA flag on this disposable CapRover server.
        // Register cleanup before the first attempt to enable it.
        cleanup.add(async () => {
            if ((await api.getOtpStatus()).isEnabled) {
                await api.setOtpStatus({ enabled: false })
            }
            expect((await api.getOtpStatus()).isEnabled).toBe(false)
        })

        const setup = await api.setOtpStatus({ enabled: true })
        expect(setup.isEnabled).toBe(false)
        const otpPath = setup.otpPath
        if (!otpPath) throw new Error('Pro did not return a TOTP URI')

        const otp = totpFromUri(otpPath)
        expect(await api.setOtpStatus({ enabled: true, token: otp })).toEqual({
            isEnabled: true,
        })
        expect((await api.getOtpStatus()).isEnabled).toBe(true)

        const raw = new RawApiClient(config.caproverUrl)
        expect(
            await raw.request('POST', '/login', {
                password: config.caproverPassword,
            })
        ).toMatchObject({ status: 1114 })

        const provider = new SimpleAuthenticationProvider(async () => ({
            password: config.caproverPassword,
            otpToken: totpFromUri(otpPath),
        }))
        const otpClient = new CapRoverAPI(config.caproverUrl, provider)
        try {
            await otpClient.login(config.caproverPassword, totpFromUri(otpPath))
            expect((await otpClient.getOtpStatus()).isEnabled).toBe(true)
        } finally {
            otpClient.destroy()
        }
    })
})
