import { loadProvisioningConfig } from './config.js'
import { destroyEnvironment } from './destroy-environment.js'
import { loadState } from './state.js'

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})

async function main(): Promise<void> {
    const state = await loadState()
    if (!state) {
        console.log('No ephemeral E2E environment state found; nothing to clean up.')
        return
    }

    await destroyEnvironment(state, loadProvisioningConfig())
}
