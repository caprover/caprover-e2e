import { appendFile } from 'node:fs/promises'
import { loadProvisioningConfig } from '../config.js'
import { provisionEnvironment } from '../environment/provision.js'

provisionEnvironment(loadProvisioningConfig()).then(
    async ({ testEnvironment }) => {
        const githubEnv = process.env.GITHUB_ENV
        if (!githubEnv) return

        const content = Object.entries(testEnvironment)
            .filter(
                (entry): entry is [string, string] => entry[1] !== undefined
            )
            .map(
                ([key, value]) =>
                    `${key}<<CAPROVER_E2E_EOF\n${value}\nCAPROVER_E2E_EOF`
            )
            .join('\n')

        await appendFile(githubEnv, `${content}\n`)
    }
)
