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
    operation: (cleanup: CleanupRegistry) => Promise<T>
): Promise<T> {
    const cleanup = new CleanupRegistry()
    let result: T
    try {
        result = await operation(cleanup)
    } catch (error) {
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
    await cleanup.run()
    return result
}
