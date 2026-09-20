import { loadConfig } from '../../src/config'
import { collectFailureDiagnostics } from '../../src/diagnostics'

async function main(): Promise<void> {
    try {
        const config = loadConfig()

        if (config.environment !== 'ephemeral') {
            console.log(
                'Skipping automatic diagnostics because this is not an ephemeral E2E environment.'
            )
            return
        }

        await collectFailureDiagnostics(config)
    } catch (error) {
        console.error(
            'Failure diagnostics encountered an unexpected error:',
            error instanceof Error ? error.message : String(error)
        )
    }
}

void main()
