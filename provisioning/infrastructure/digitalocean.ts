import type { ProvisioningConfig } from '../config'
import { retryUntil } from '../retry'

const API_BASE = 'https://api.digitalocean.com/v2'

interface DropletResponse {
    droplet: {
        id: number
        name: string
        status: string
        networks: {
            v4: Array<{ ip_address: string; type: string }>
        }
    }
}

interface DropletsResponse {
    droplets: DropletResponse['droplet'][]
}

class DigitalOceanApiError extends Error {
    constructor(
        readonly status: number,
        readonly apiMessage: string,
        detail: string
    ) {
        super(detail)
    }
}

export class DigitalOceanClient {
    private selectedRegion: string

    constructor(private readonly config: ProvisioningConfig) {
        this.selectedRegion = config.digitalOceanRegion
    }

    async createDroplet(name: string): Promise<number> {
        const regions = [
            ...new Set([
                this.selectedRegion,
                this.config.digitalOceanRegion,
                ...this.config.digitalOceanFallbackRegions,
            ]),
        ]

        for (const [index, region] of regions.entries()) {
            console.log(
                `Creating DigitalOcean droplet in ${region} (${this.config.digitalOceanSize})...`
            )
            try {
                const response = await this.request<DropletResponse>(
                    '/droplets',
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            name,
                            region,
                            size: this.config.digitalOceanSize,
                            image: this.config.digitalOceanImage,
                            ssh_keys: [this.config.digitalOceanSshKeyId],
                            tags: ['caprover-e2e', name],
                        }),
                    }
                )
                this.selectedRegion = region
                return response.droplet.id
            } catch (error) {
                // Only retry an explicit rejection that created no droplet.
                // A lost POST response may have created one; let cleanup reconcile it.
                if (
                    !(error instanceof DigitalOceanApiError) ||
                    error.status !== 422 ||
                    !/^Size is not available in this region\.?$/i.test(
                        error.apiMessage
                    )
                ) {
                    throw error
                }
                if (index === regions.length - 1) {
                    throw new Error(
                        `DigitalOcean size ${this.config.digitalOceanSize} is unavailable in all attempted regions: ${regions.join(', ')}`,
                        { cause: error }
                    )
                }
                console.warn(
                    `DigitalOcean size ${this.config.digitalOceanSize} is unavailable in ${region}; trying ${regions[index + 1]}.`
                )
            }
        }
        throw new Error('No DigitalOcean regions configured')
    }

    async findDropletIdByName(name: string): Promise<number | undefined> {
        const response = await this.request<DropletsResponse>(
            `/droplets?tag_name=${encodeURIComponent(name)}`
        )
        return response.droplets.find((droplet) => droplet.name === name)?.id
    }

    async waitForPublicIp(dropletId: number): Promise<string> {
        return retryUntil(
            'DigitalOcean droplet public IP',
            async (signal) => {
                const response = await this.request<DropletResponse>(
                    `/droplets/${dropletId}`,
                    { signal }
                )
                const publicIp = response.droplet.networks.v4.find(
                    (network) => network.type === 'public'
                )?.ip_address

                if (response.droplet.status !== 'active' || !publicIp) {
                    throw new Error('Droplet is not active yet')
                }

                return publicIp
            },
            { timeoutMs: 180_000, intervalMs: 5_000 }
        )
    }

    async deleteDroplet(dropletId: number): Promise<void> {
        await this.request(
            `/droplets/${dropletId}`,
            { method: 'DELETE' },
            { allowEmptyResponse: true, ignoreNotFound: true }
        )
    }

    private async request<T = unknown>(
        path: string,
        init: RequestInit = {},
        options: { allowEmptyResponse?: boolean; ignoreNotFound?: boolean } = {}
    ): Promise<T> {
        const response = await fetch(`${API_BASE}${path}`, {
            ...init,
            signal: init.signal ?? AbortSignal.timeout(30_000),
            headers: {
                Authorization: `Bearer ${this.config.digitalOceanToken}`,
                'Content-Type': 'application/json',
                ...init.headers,
            },
        })

        if (options.ignoreNotFound && response.status === 404) {
            return undefined as T
        }

        if (!response.ok) {
            const body = await response.text()
            let apiMessage = ''
            try {
                const parsed = JSON.parse(body)
                if (typeof parsed.message === 'string')
                    apiMessage = parsed.message
            } catch {
                // Non-JSON errors still retain their original status and body.
            }
            throw new DigitalOceanApiError(
                response.status,
                apiMessage,
                `DigitalOcean API ${response.status} ${response.statusText}: ${body}`
            )
        }

        if (options.allowEmptyResponse || response.status === 204) {
            return undefined as T
        }

        return (await response.json()) as T
    }
}
