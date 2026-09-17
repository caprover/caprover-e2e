import type { ProvisioningConfig } from './config.js'

interface CloudflareResponse<T> {
    success: boolean
    errors: Array<{ code: number; message: string }>
    result: T
}

interface DnsRecord {
    id: string
    name: string
}

export class CloudflareClient {
    constructor(private readonly config: ProvisioningConfig) {}

    async createWildcardRecord(
        rootDomain: string,
        ipAddress: string
    ): Promise<string> {
        const response = await this.request<DnsRecord>('/dns_records', {
            method: 'POST',
            body: JSON.stringify({
                type: 'A',
                name: `*.${rootDomain}`,
                content: ipAddress,
                ttl: 60,
                proxied: false,
            }),
        })

        return response.id
    }

    async findRecordId(recordName: string): Promise<string | undefined> {
        const records = await this.request<DnsRecord[]>(
            `/dns_records?type=A&name=${encodeURIComponent(recordName)}`
        )
        return records.find((record) => record.name === recordName)?.id
    }

    async deleteRecord(recordId: string): Promise<void> {
        await this.request(
            `/dns_records/${recordId}`,
            { method: 'DELETE' },
            true
        )
    }

    private async request<T = unknown>(
        path: string,
        init: RequestInit = {},
        ignoreNotFound = false
    ): Promise<T> {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/zones/${this.config.cloudflareZoneId}${path}`,
            {
                ...init,
                signal: init.signal ?? AbortSignal.timeout(30_000),
                headers: {
                    Authorization: `Bearer ${this.config.cloudflareApiToken}`,
                    'Content-Type': 'application/json',
                    ...init.headers,
                },
            }
        )
        if (ignoreNotFound && response.status === 404) {
            return undefined as T
        }

        const body = (await response.json()) as CloudflareResponse<T>

        if (!response.ok || !body.success) {
            throw new Error(
                `Cloudflare API ${response.status}: ${JSON.stringify(body.errors)}`
            )
        }

        return body.result
    }
}
