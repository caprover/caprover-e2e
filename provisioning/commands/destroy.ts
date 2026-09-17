import { loadProvisioningConfig } from '../config.js'
import { destroyEnvironment } from '../environment/destroy.js'
import { loadState } from '../environment/state.js'

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})

async function main(): Promise<void> {
    const state = await loadState()
    if (!state) {
        console.log(
            'No ephemeral E2E environment state found; nothing to clean up.'
        )
        return
    }

    await destroyEnvironment(state, loadProvisioningConfig())
}
