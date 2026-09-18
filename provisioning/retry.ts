export async function retryUntil<T>(
    description: string,
    operation: (signal: AbortSignal) => Promise<T>,
    options: {
        timeoutMs: number
        intervalMs?: number
        attemptTimeoutMs?: number
    }
): Promise<T> {
    const deadline = Date.now() + options.timeoutMs
    const intervalMs = options.intervalMs ?? 5_000
    let lastError: unknown

    while (Date.now() < deadline) {
        const remainingMs = deadline - Date.now()
        const attemptTimeoutMs = Math.min(
            options.attemptTimeoutMs ?? remainingMs,
            remainingMs
        )
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), attemptTimeoutMs)

        try {
            return await withTimeout(
                operation(controller.signal),
                attemptTimeoutMs,
                description
            )
        } catch (error) {
            lastError = error
        } finally {
            clearTimeout(timer)
        }

        const delayMs = Math.min(intervalMs, deadline - Date.now())
        if (delayMs > 0) {
            await sleep(delayMs)
        }
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
            () =>
                reject(
                    new Error(`${description} timed out after ${timeoutMs}ms`)
                ),
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
