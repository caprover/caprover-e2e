import { randomBytes } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import type { ProvisioningConfig } from './config.js'
import { CloudflareClient } from './cloudflare.js'
import { configureCapRover, waitForWildcardDns } from './caprover.js'
import { destroyEnvironment } from './destroy-environment.js'
import { DigitalOceanClient } from './digitalocean.js'
import { prepareServer } from './server.js'
import { saveState } from './state.js'
import type { ProvisionedEnvironment, ProvisioningState } from './types.js'

export async function provisionEnvironment(
    config: ProvisioningConfig
): Promise<ProvisionedEnvironment> {
    const state: ProvisioningState = {}
    const digitalOcean = new DigitalOceanClient(config)
    const cloudflare = new CloudflareClient(config)
    const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    const rootDomain = `e2e-${suffix}.${config.baseDomain}`
    const initialPassword = generateCapRoverPassword()
    const password = generateCapRoverPassword()

    maskSecret(initialPassword)
    maskSecret(password)
    maskSecret(rootDomain)

    try {
        console.log('Creating temporary DigitalOcean droplet...')
        state.dropletName = `caprover-e2e-${suffix}`
        await saveState(state)
        state.dropletId = await digitalOcean.createDroplet(state.dropletName)
        await saveState(state)

        state.ipAddress = await digitalOcean.waitForPublicIp(state.dropletId)
        await saveState(state)

        console.log('Creating temporary wildcard DNS record...')
        state.rootDomain = rootDomain
        state.dnsRecordName = `*.${rootDomain}`
        await saveState(state)
        state.dnsRecordId = await cloudflare.createWildcardRecord(
            rootDomain,
            state.ipAddress
        )
        await saveState(state)

        await prepareServer(state.ipAddress, initialPassword, config)

        console.log('Waiting for public DNS propagation...')
        await waitForWildcardDns(rootDomain, state.ipAddress)

        state.caproverUrl = await configureCapRover(
            state.ipAddress,
            rootDomain,
            initialPassword,
            password,
            `admin@${config.baseDomain}`
        )
        await saveState(state)

        const testEnvironment: NodeJS.ProcessEnv = {
            CAPROVER_URL: state.caproverUrl,
            CAPROVER_PASSWORD: password,
            SSH_HOST: state.ipAddress,
            SSH_PORT: '22',
            SSH_USER: 'root',
            SSH_PRIVATE_KEY: config.sshPrivateKey,
        }

        await exportGitHubEnvironment(testEnvironment)
        console.log('Fresh CapRover environment is ready for E2E tests.')
        return { state, testEnvironment }
    } catch (error) {
        console.error('Provisioning failed; cleaning up partial resources...')
        try {
            await destroyEnvironment(state, config)
        } catch (cleanupError) {
            console.error(
                'Cleanup after provisioning failure also failed:',
                cleanupError
            )
        }
        throw error
    }
}

async function exportGitHubEnvironment(
    environment: NodeJS.ProcessEnv
): Promise<void> {
    const githubEnv = process.env.GITHUB_ENV
    if (!githubEnv) return

    const content = Object.entries(environment)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(
            ([key, value]) =>
                `${key}<<CAPROVER_E2E_EOF\n${value}\nCAPROVER_E2E_EOF`
        )
        .join('\n')

    await appendFile(githubEnv, `${content}\n`)
}

function maskSecret(value: string): void {
    if (process.env.GITHUB_ACTIONS === 'true') {
        console.log(`::add-mask::${value}`)
    }
}

export function generateCapRoverPassword(): string {
    // CapRover's login endpoint rejects passwords longer than 29 characters.
    return randomBytes(21).toString('base64url')
}
