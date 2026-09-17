export interface EventuallyOptions {
    timeoutMs?: number
    intervalMs?: number
    description?: string
}

export async function eventually<T>(
    operation: () => Promise<T> | T,
    options: EventuallyOptions = {}
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 30_000
    const intervalMs = options.intervalMs ?? 1_000
    const deadline = Date.now() + timeoutMs
    let lastError: unknown

    while (true) {
        try {
            return await operation()
        } catch (error) {
            lastError = error
        }

        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) {
            const description = options.description
                ? ` while waiting for ${options.description}`
                : ''
            throw new Error(
                `Timed out after ${timeoutMs}ms${description}. Last error: ${formatError(lastError)}`,
                { cause: lastError }
            )
        }

        await delay(Math.min(intervalMs, remainingMs))
    }
}

export function withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    description: string
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${description} timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        operation.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error) => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
