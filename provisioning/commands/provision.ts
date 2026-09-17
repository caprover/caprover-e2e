import { loadProvisioningConfig } from '../config.js'
import { provisionEnvironment } from '../environment/provision.js'
import { exportGitHubEnvironment } from './github-environment.js'

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})

async function main(): Promise<void> {
    const provisioned = await provisionEnvironment(loadProvisioningConfig())
    await exportGitHubEnvironment(provisioned.testEnvironment)
}
