import { afterEach, expect, test, vi } from 'vitest'

const api = vi.hoisted(() => ({
    urls: [] as string[],
    enableRootSsl: vi.fn(async () => undefined),
    forceSsl: vi.fn(async () => undefined),
    changePass: vi.fn(async () => undefined),
}))

vi.mock('caprover-api', () => ({
    default: class {
        constructor(url: string) {
            api.urls.push(url)
        }
        login = async () => undefined
        updateRootDomain = async () => undefined
        enableRootSsl = api.enableRootSsl
        forceSsl = api.forceSsl
        changePass = api.changePass
        getCaptainInfo = async () => ({})
        destroy = () => undefined
    },
    SimpleAuthenticationProvider: class {},
}))

import { configureCapRover } from '../../provisioning/caprover'

afterEach(() => {
    vi.restoreAllMocks()
    api.urls.length = 0
    api.enableRootSsl.mockClear()
    api.forceSsl.mockClear()
    api.changePass.mockClear()
})

test.each([
    [false, 'http://captain.e2e.example.com'],
    [true, 'https://captain.e2e.example.com'],
])(
    'provisioning with HTTPS=%s returns %s',
    async (enableHttps, expectedUrl) => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ready'))

        expect(
            await configureCapRover(
                '192.0.2.1',
                'e2e.example.com',
                'initial',
                'generated',
                'admin@example.com',
                enableHttps
            )
        ).toBe(expectedUrl)
        expect(api.enableRootSsl).toHaveBeenCalledTimes(enableHttps ? 1 : 0)
        expect(api.forceSsl).toHaveBeenCalledTimes(enableHttps ? 1 : 0)
        expect(api.changePass).toHaveBeenCalledWith('initial', 'generated')
        expect(api.urls.at(-1)).toBe(expectedUrl)
    }
)
