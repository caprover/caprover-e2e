import { loadProvisioningConfig } from './config.js'
import { provisionEnvironment } from './provision-environment.js'

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})

async function main(): Promise<void> {
    await provisionEnvironment(loadProvisioningConfig())
}
