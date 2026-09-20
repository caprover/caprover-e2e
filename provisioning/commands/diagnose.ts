import { loadConfig } from '../../src/config'
import { collectFailureDiagnostics } from '../../src/diagnostics'

async function main(): Promise<void> {
    try {
        await collectFailureDiagnostics(loadConfig())
    } catch (error) {
        console.error(
            'Failure diagnostics encountered an unexpected error:',
            error instanceof Error ? error.message : String(error)
        )
    }
}

void main()
