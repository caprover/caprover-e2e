import { randomBytes } from 'node:crypto'
import {
    configureCapRover,
    generateCapRoverPassword,
    waitForWildcardDns,
} from '../caprover.js'
import type { ProvisioningConfig } from '../config.js'
import { CloudflareClient } from '../infrastructure/cloudflare.js'
import { DigitalOceanClient } from '../infrastructure/digitalocean.js'
import { prepareServer } from '../infrastructure/server.js'
import type { ProvisionedEnvironment, ProvisioningState } from '../types.js'
import { destroyEnvironment } from './destroy.js'
import { saveState } from './state.js'

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

function maskSecret(value: string): void {
    if (process.env.GITHUB_ACTIONS === 'true') {
        console.log(`::add-mask::${value}`)
    }
}
