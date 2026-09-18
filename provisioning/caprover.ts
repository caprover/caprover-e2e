import { randomBytes } from 'node:crypto'
import { resolve4 } from 'node:dns/promises'
import CapRoverAPI, { SimpleAuthenticationProvider } from 'caprover-api'
import { retryUntil, withTimeout } from './retry'

export function generateCapRoverPassword(): string {
    // CapRover's login endpoint rejects passwords longer than 29 characters.
    return randomBytes(21).toString('base64url')
}

export async function waitForWildcardDns(
    rootDomain: string,
    expectedIp: string
): Promise<void> {
    const hostname = `captain.${rootDomain}`

    await retryUntil(
        'public wildcard DNS',
        async () => {
            const addresses = await resolve4(hostname)
            if (!addresses.includes(expectedIp)) {
                throw new Error('DNS does not point to the new server yet')
            }
        },
        { timeoutMs: 120_000, intervalMs: 5_000 }
    )
}

export async function configureCapRover(
    ipAddress: string,
    rootDomain: string,
    initialPassword: string,
    password: string,
    certificateEmail: string
): Promise<string> {
    const setupUrl = `http://${ipAddress}:3000`
    console.log('Waiting for the CapRover bootstrap HTTP endpoint...')
    await waitForHttpResponse(
        setupUrl,
        'CapRover bootstrap HTTP endpoint',
        120_000
    )

    console.log('Waiting for the CapRover setup API...')
    const setupApi = createApi(setupUrl, initialPassword)

    try {
        await retryUntil(
            'CapRover setup API',
            () => setupApi.login(initialPassword),
            {
                timeoutMs: 120_000,
                intervalMs: 5_000,
                attemptTimeoutMs: 10_000,
            }
        )

        console.log('Configuring CapRover root domain...')
        await withTimeout(
            setupApi.updateRootDomain(rootDomain, false),
            60_000,
            'CapRover root domain setup'
        )
    } finally {
        setupApi.destroy()
    }

    const httpUrl = `http://captain.${rootDomain}`
    console.log('Waiting for the CapRover HTTP domain...')
    await waitForHttpResponse(httpUrl, 'CapRover HTTP domain', 60_000)

    const domainApi = createApi(httpUrl, initialPassword)
    try {
        await retryUntil(
            'CapRover domain API',
            () => domainApi.login(initialPassword),
            {
                timeoutMs: 60_000,
                intervalMs: 3_000,
                attemptTimeoutMs: 10_000,
            }
        )

        console.log('Enabling HTTPS...')
        await withTimeout(
            domainApi.enableRootSsl(certificateEmail),
            120_000,
            'CapRover root SSL setup'
        )
    } finally {
        domainApi.destroy()
    }

    const httpsUrl = `https://captain.${rootDomain}`
    const secureApi = createApi(httpsUrl, initialPassword)
    try {
        await retryUntil(
            'CapRover HTTPS API',
            () => secureApi.login(initialPassword),
            {
                timeoutMs: 90_000,
                intervalMs: 3_000,
                attemptTimeoutMs: 10_000,
            }
        )

        await withTimeout(
            secureApi.forceSsl(true),
            30_000,
            'forcing CapRover HTTPS'
        )
        await withTimeout(
            secureApi.changePass(initialPassword, password),
            30_000,
            'changing CapRover password'
        )
    } finally {
        secureApi.destroy()
    }

    const verificationApi = createApi(httpsUrl, password)
    try {
        await retryUntil(
            'CapRover login with generated credentials',
            async () => {
                await verificationApi.login(password)
                await verificationApi.getCaptainInfo()
            },
            {
                timeoutMs: 60_000,
                intervalMs: 3_000,
                attemptTimeoutMs: 10_000,
            }
        )
    } finally {
        verificationApi.destroy()
    }

    return httpsUrl
}

async function waitForHttpResponse(
    url: string,
    description: string,
    timeoutMs: number
): Promise<void> {
    await retryUntil(
        description,
        async (signal) => {
            await fetch(url, {
                redirect: 'manual',
                signal,
            })
        },
        {
            timeoutMs,
            intervalMs: 3_000,
            attemptTimeoutMs: 5_000,
        }
    )
}

function createApi(baseUrl: string, password: string): CapRoverAPI {
    return new CapRoverAPI(
        baseUrl,
        new SimpleAuthenticationProvider(() => Promise.resolve({ password }))
    )
}
