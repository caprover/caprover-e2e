import { expect, test } from 'vitest'
import { NetDataInfo } from '../src/clients/caprover'
import { loadConfig } from '../src/config'
import { eventually } from '../src/helpers/retry'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const CONTAINER = 'captain-netdata-container'

test('NetData proxy uses cookie authentication and follows container state', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const original = await api.getNetDataInfo()
        cleanup.add(async () => {
            await api.updateNetDataInfo(original)
            await eventually(
                async () => {
                    const restored = await api.getNetDataInfo()
                    expect(restored).toEqual(original)
                    expect(
                        await context.docker.getContainerState(CONTAINER)
                    ).toBe(original.isEnabled ? 'running' : 'absent')
                },
                {
                    timeoutMs: 60_000,
                    description: 'NetData settings and container restoration',
                }
            )
        })

        const settings: NetDataInfo = {
            isEnabled: true,
            netDataUrl: '',
            data: {
                smtp: {
                    to: '',
                    hostname: '',
                    server: '',
                    port: '',
                    allowNonTls: '',
                    username: '',
                    password: '',
                },
                slack: { hook: '', channel: '' },
                telegram: { chatId: '', botToken: '' },
                pushBullet: { apiToken: '', fallbackEmail: '' },
            },
        }
        const url = `${loadConfig().caproverUrl}/net-data-monitor/`
        const cookie = await loginCookie(
            loadConfig().caproverUrl,
            loadConfig().caproverPassword
        )

        await api.updateNetDataInfo(settings)
        await eventually(
            async () => {
                expect((await api.getNetDataInfo()).isEnabled).toBe(true)
                expect(await context.docker.getContainerState(CONTAINER)).toBe(
                    'running'
                )
            },
            { timeoutMs: 60_000, description: 'NetData container to start' }
        )
        await eventually(
            async () => {
                const response = await context.http.get(url, {
                    headers: { cookie },
                })
                expect(response.status).toBe(200)
                expect(response.body.length).toBeGreaterThan(100)
                expect(response.body.toLowerCase()).toMatch(/netdata|net data/)
            },
            {
                timeoutMs: 60_000,
                description: 'cookie-authenticated NetData proxy',
            }
        )

        await api.updateNetDataInfo({ ...settings, isEnabled: false })
        await eventually(
            async () => {
                expect((await api.getNetDataInfo()).isEnabled).toBe(false)
                expect(await context.docker.getContainerState(CONTAINER)).toBe(
                    'absent'
                )
            },
            { timeoutMs: 60_000, description: 'NetData container removal' }
        )
        await eventually(
            async () => {
                const response = await context.http.get(url, {
                    headers: { cookie },
                })
                expect(response.status).toBe(500)
                expect(response.body).toContain('NetData is not running!')
            },
            {
                timeoutMs: 60_000,
                description: 'disabled NetData proxy response',
            }
        )
    })
})

async function loginCookie(baseUrl: string, password: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/v2/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(10_000),
    })
    if (response.status !== 200)
        throw new Error(`Cookie login HTTP ${response.status}`)
    const envelope = (await response.json()) as { status?: number }
    if (envelope.status !== 100)
        throw new Error(`Cookie login status ${envelope.status}`)
    const match = response.headers
        .get('set-cookie')
        ?.match(/(?:^|,\s*)captainCookieAuth=([^;,]+)/)
    if (!match) throw new Error('Login did not set captainCookieAuth')
    return `captainCookieAuth=${match[1]}`
}
