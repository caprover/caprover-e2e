import { spawn } from 'node:child_process'
import { loadProvisioningConfig } from '../config.js'
import { destroyEnvironment } from '../environment/destroy.js'
import { provisionEnvironment } from '../environment/provision.js'

runEphemeralTests()

async function runEphemeralTests(): Promise<void> {
    const config = loadProvisioningConfig()
    const provisioned = await provisionEnvironment(config)
    let exitCode = 1

    try {
        exitCode = await runTests(provisioned.testEnvironment)
    } finally {
        await destroyEnvironment(provisioned.state, config)
    }

    process.exitCode = exitCode
}

function runTests(environment: NodeJS.ProcessEnv): Promise<number> {
    return new Promise((resolve, reject) => {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
        const child = spawn(npm, ['test'], {
            stdio: 'inherit',
            env: { ...process.env, ...environment },
        })

        child.once('error', reject)
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`E2E test process terminated by ${signal}`))
                return
            }
            resolve(code ?? 1)
        })
    })
}
