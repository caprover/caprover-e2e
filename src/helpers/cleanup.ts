export class CleanupRegistry {
    private actions: Array<() => Promise<void>> = []

    add(action: () => Promise<void>): void {
        this.actions.push(action)
    }

    async run(): Promise<void> {
        const errors: unknown[] = []
        while (this.actions.length) {
            try {
                await this.actions.pop()!()
            } catch (error) {
                errors.push(error)
            }
        }
        if (errors.length)
            throw new AggregateError(errors, 'Resource cleanup failed')
    }
}

export async function withCleanup<T>(
    operation: (cleanup: CleanupRegistry) => Promise<T>,
    onFailure?: (error: unknown) => Promise<void>
): Promise<T> {
    const cleanup = new CleanupRegistry()
    let result: T

    try {
        result = await operation(cleanup)
    } catch (error) {
        await reportFailure(onFailure, error)
        try {
            await cleanup.run()
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                'Test failed and cleanup also failed',
                { cause: error }
            )
        }
        throw error
    }

    try {
        await cleanup.run()
    } catch (error) {
        await reportFailure(onFailure, error)
        throw error
    }

    return result
}

async function reportFailure(
    observer: ((error: unknown) => Promise<void>) | undefined,
    error: unknown
): Promise<void> {
    if (!observer) return

    try {
        await observer(error)
    } catch (observerError) {
        console.error(
            'Failure diagnostics also failed:',
            observerError instanceof Error
                ? observerError.message
                : String(observerError)
        )
    }
}
