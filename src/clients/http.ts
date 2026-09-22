import { eventually } from '../helpers/retry'

export interface HttpResult {
    status: number
    body: string
    finalUrl: string
    headers: Headers
}

export interface BinaryHttpResult {
    status: number
    body: Buffer
    finalUrl: string
    headers: Headers
}

export interface HttpRequestOptions {
    headers?: HeadersInit
    redirect?: RequestRedirect
}

export class HttpClient {
    constructor(private readonly requestTimeoutMs = 10_000) {}

    async get(
        url: string,
        options: HttpRequestOptions = {}
    ): Promise<HttpResult> {
        const response = await fetch(url, {
            headers: options.headers,
            redirect: options.redirect ?? 'follow',
            signal: AbortSignal.timeout(this.requestTimeoutMs),
        })

        return {
            status: response.status,
            body: await response.text(),
            finalUrl: response.url,
            headers: response.headers,
        }
    }

    async getBinary(
        url: string,
        options: HttpRequestOptions = {}
    ): Promise<BinaryHttpResult> {
        const response = await fetch(url, {
            headers: options.headers,
            redirect: options.redirect ?? 'follow',
            signal: AbortSignal.timeout(this.requestTimeoutMs),
        })

        return {
            status: response.status,
            body: Buffer.from(await response.arrayBuffer()),
            finalUrl: response.url,
            headers: response.headers,
        }
    }

    async getStatus(url: string): Promise<number> {
        return (await this.get(url)).status
    }

    waitUntilReachable(
        url: string,
        expectedBodyText: string,
        timeoutMs = 30_000
    ): Promise<HttpResult> {
        return eventually(
            async () => {
                const response = await this.get(url)
                if (response.status !== 200) {
                    throw new Error(
                        `Expected HTTP 200 from ${url}, received ${response.status}`
                    )
                }
                if (!response.body.includes(expectedBodyText)) {
                    throw new Error(
                        `Response from ${url} did not contain the expected application content`
                    )
                }
                return response
            },
            {
                timeoutMs,
                description: `${url} to serve expected application content`,
            }
        )
    }

    waitUntilNotMatching(
        url: string,
        unexpectedBodyText: string,
        timeoutMs = 30_000
    ): Promise<HttpResult | undefined> {
        return eventually(
            async () => {
                try {
                    const response = await this.get(url)
                    if (response.body.includes(unexpectedBodyText)) {
                        throw new Error(
                            `${url} still serves the deleted application's content`
                        )
                    }
                    return response
                } catch (error) {
                    if (isExpectedNetworkFailure(error)) return undefined
                    throw error
                }
            },
            {
                timeoutMs,
                description: `${url} to stop serving application content`,
            }
        )
    }
}

function isExpectedNetworkFailure(error: unknown): boolean {
    if (!(error instanceof TypeError)) return false
    return error.message === 'fetch failed'
}
