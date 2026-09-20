export interface ApiEnvelope<T = unknown> {
    status: number
    description: string
    data?: T
}

// Used only for wire-level contracts that the SDK unwraps or automatically retries.
export class RawApiClient {
    private token = ''
    constructor(private readonly baseUrl: string) {}

    async login(password: string): Promise<void> {
        const result = await this.request<{ token: string }>('POST', '/login', {
            password,
        })
        if (result.status !== 100 || !result.data?.token) {
            throw new Error(`Raw API login failed with status ${result.status}`)
        }
        this.token = result.data.token
    }

    async request<T = unknown>(
        method: 'GET' | 'POST' | 'PATCH',
        path: string,
        body?: unknown
    ): Promise<ApiEnvelope<T>> {
        const multipart = body instanceof FormData
        const response = await fetch(`${this.baseUrl}/api/v2${path}`, {
            method,
            headers: {
                'x-namespace': 'captain',
                ...(multipart ? {} : { 'Content-Type': 'application/json' }),
                ...(this.token ? { 'x-captain-auth': this.token } : {}),
            },
            body:
                body === undefined
                    ? undefined
                    : multipart
                      ? body
                      : JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
            redirect: 'error',
        })
        if (!response.ok)
            throw new Error(`Raw API request failed: HTTP ${response.status}`)
        return response.json() as Promise<ApiEnvelope<T>>
    }
}
