import { loadProvisioningConfig } from '../config'
import { destroyEnvironment } from '../environment/destroy'
import { loadState } from '../environment/state'

loadState().then((state) => {
    if (state) {
        return destroyEnvironment(state, loadProvisioningConfig())
    }

    console.log(
        'No ephemeral E2E environment state found; nothing to clean up.'
    )
})
