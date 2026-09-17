import { resolve4 } from 'node:dns/promises'
import CapRoverAPI, { SimpleAuthenticationProvider } from 'caprover-api'
import { retryUntil, withTimeout } from './retry.js'

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
    console.log('Waiting for the CapRover setup API...')
    const setupApi = createApi(`http://${ipAddress}:3000`, initialPassword)

    try {
        await retryUntil(
            'CapRover setup API',
            () => setupApi.login(initialPassword),
            { timeoutMs: 120_000, intervalMs: 5_000 }
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
    const domainApi = createApi(httpUrl, initialPassword)
    try {
        await retryUntil(
            'CapRover domain API',
            () => domainApi.login(initialPassword),
            { timeoutMs: 60_000, intervalMs: 3_000 }
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
            { timeoutMs: 90_000, intervalMs: 3_000 }
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
            { timeoutMs: 60_000, intervalMs: 3_000 }
        )
    } finally {
        verificationApi.destroy()
    }

    return httpsUrl
}

function createApi(baseUrl: string, password: string): CapRoverAPI {
    return new CapRoverAPI(
        baseUrl,
        new SimpleAuthenticationProvider(() => Promise.resolve({ password }))
    )
}
