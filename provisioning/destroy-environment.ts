import type { ProvisioningConfig } from './config.js'
import { CloudflareClient } from './cloudflare.js'
import { DigitalOceanClient } from './digitalocean.js'
import { removeState, saveState } from './state.js'
import type { ProvisioningState } from './types.js'

export async function destroyEnvironment(
    state: ProvisioningState,
    config: ProvisioningConfig
): Promise<void> {
    const failures: Error[] = []
    const cloudflare = new CloudflareClient(config)
    const digitalOcean = new DigitalOceanClient(config)

    if (!state.dnsRecordId && state.dnsRecordName) {
        try {
            state.dnsRecordId = await cloudflare.findRecordId(
                state.dnsRecordName
            )
            await saveState(state)
        } catch (error) {
            failures.push(asError(error))
        }
    }

    if (state.dnsRecordId) {
        try {
            console.log('Deleting temporary DNS record...')
            await cloudflare.deleteRecord(state.dnsRecordId)
            state.dnsRecordId = undefined
            state.dnsRecordName = undefined
            await saveState(state)
        } catch (error) {
            failures.push(asError(error))
        }
    }

    if (!state.dropletId && state.dropletName) {
        try {
            state.dropletId = await digitalOcean.findDropletIdByName(
                state.dropletName
            )
            await saveState(state)
        } catch (error) {
            failures.push(asError(error))
        }
    }

    if (state.dropletId) {
        try {
            console.log('Deleting temporary DigitalOcean droplet...')
            await digitalOcean.deleteDroplet(state.dropletId)
            state.dropletId = undefined
            state.dropletName = undefined
            await saveState(state)
        } catch (error) {
            failures.push(asError(error))
        }
    }

    if (failures.length === 0) {
        await removeState()
        return
    }

    throw new AggregateError(
        failures,
        'Failed to fully clean up E2E environment'
    )
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}
