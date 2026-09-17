export async function retryUntil<T>(
    description: string,
    operation: () => Promise<T>,
    options: { timeoutMs: number; intervalMs?: number }
): Promise<T> {
    const startedAt = Date.now()
    const intervalMs = options.intervalMs ?? 5_000
    let lastError: unknown

    while (Date.now() - startedAt < options.timeoutMs) {
        try {
            return await operation()
        } catch (error) {
            lastError = error
        }

        await sleep(intervalMs)
    }

    throw new Error(
        `${description} did not become ready within ${options.timeoutMs}ms`,
        { cause: lastError }
    )
}

export function withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    description: string
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${description} timed out after ${timeoutMs}ms`)),
            timeoutMs
        )

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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
