import { loadProvisioningConfig } from '../config.js'
import { destroyEnvironment } from '../environment/destroy.js'
import { loadState } from '../environment/state.js'

loadState().then((state) => {
    if (state) {
        return destroyEnvironment(state, loadProvisioningConfig())
    }

    console.log(
        'No ephemeral E2E environment state found; nothing to clean up.'
    )
})
