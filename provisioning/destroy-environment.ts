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

    if (state.dnsRecordId) {
        try {
            console.log('Deleting temporary DNS record...')
            await new CloudflareClient(config).deleteRecord(state.dnsRecordId)
            state.dnsRecordId = undefined
            await saveState(state)
        } catch (error) {
            failures.push(asError(error))
        }
    }

    if (state.dropletId) {
        try {
            console.log('Deleting temporary DigitalOcean droplet...')
            await new DigitalOceanClient(config).deleteDroplet(state.dropletId)
            state.dropletId = undefined
            await saveState(state)
        } catch (error) {
            failures.push(asError(error))
        }
    }

    if (failures.length === 0) {
        await removeState()
        return
    }

    throw new AggregateError(failures, 'Failed to fully clean up E2E environment')
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}
