export async function step<T>(
    name: string,
    operation: () => Promise<T>
): Promise<T> {
    const startedAt = Date.now()
    console.info(`→ ${name}`)

    try {
        const result = await operation()
        console.info(`✓ ${name} (${Date.now() - startedAt}ms)`)
        return result
    } catch (error) {
        console.error(`✗ ${name} (${Date.now() - startedAt}ms)`)
        throw error
    }
}
