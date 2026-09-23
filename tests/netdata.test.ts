import { expect, test } from 'vitest'
import { NetDataInfo } from '../src/clients/caprover'
import { loadConfig } from '../src/config'
import { eventually } from '../src/helpers/retry'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const CONTAINER = 'captain-netdata-container'

test('NetData runs behind the cookie-authenticated proxy and stops when disabled', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const original = await api.getNetDataInfo()
        cleanup.add(async () => {
            await api.updateNetDataInfo(original)
            await eventually(
                async () => {
                    expect(await api.getNetDataInfo()).toEqual(original)
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

        const enabled: NetDataInfo = {
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
        await api.updateNetDataInfo(enabled)
        await eventually(
            async () => {
                expect(await api.getNetDataInfo()).toMatchObject({
                    isEnabled: true,
                    data: enabled.data,
                })
                expect(await context.docker.getContainerState(CONTAINER)).toBe(
                    'running'
                )
            },
            { timeoutMs: 60_000, description: 'NetData container startup' }
        )

        const { caproverUrl, caproverPassword } = loadConfig()
        const cookie = await loginCookie(caproverUrl, caproverPassword)
        const proxyUrl = `${caproverUrl}/net-data-monitor/`
        await eventually(
            async () => {
                const response = await context.http.get(proxyUrl, {
                    headers: { Cookie: cookie },
                })
                expect(response.status).toBe(200)
                expect(response.body.length).toBeGreaterThan(100)
                expect(response.body.toLowerCase()).toContain('netdata')
            },
            {
                timeoutMs: 60_000,
                description: 'cookie-authenticated NetData proxy',
            }
        )

        await api.updateNetDataInfo({ ...enabled, isEnabled: false })
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
                const response = await context.http.get(proxyUrl, {
                    headers: { Cookie: cookie },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(10_000),
    })
    const result = (await response.json()) as { status?: number }
    if (response.status !== 200 || result.status !== 100) {
        throw new Error(
            `Cookie login failed with HTTP ${response.status}, status ${result.status ?? 'missing'}`
        )
    }
    const match = response.headers
        .get('set-cookie')
        ?.match(/(?:^|,\s*)captainCookieAuth=([^;,\s]+)/)
    if (!match) throw new Error('Cookie login did not return captainCookieAuth')
    return `captainCookieAuth=${match[1]}`
}
