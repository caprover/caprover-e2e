import type { ProvisioningConfig } from './config.js'
import { retryUntil } from './retry.js'

const API_BASE = 'https://api.digitalocean.com/v2'

interface DropletResponse {
    droplet: {
        id: number
        status: string
        networks: {
            v4: Array<{ ip_address: string; type: string }>
        }
    }
}

export class DigitalOceanClient {
    constructor(private readonly config: ProvisioningConfig) {}

    async createDroplet(name: string): Promise<number> {
        const response = await this.request<DropletResponse>('/droplets', {
            method: 'POST',
            body: JSON.stringify({
                name,
                region: this.config.digitalOceanRegion,
                size: this.config.digitalOceanSize,
                image: this.config.digitalOceanImage,
                ssh_keys: [this.config.digitalOceanSshKeyId],
                tags: ['caprover-e2e'],
            }),
        })

        return response.droplet.id
    }

    async waitForPublicIp(dropletId: number): Promise<string> {
        return retryUntil(
            'DigitalOcean droplet public IP',
            async () => {
                const response = await this.request<DropletResponse>(
                    `/droplets/${dropletId}`
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
            throw new Error(
                `DigitalOcean API ${response.status} ${response.statusText}: ${body}`
            )
        }

        if (options.allowEmptyResponse || response.status === 204) {
            return undefined as T
        }

        return (await response.json()) as T
    }
}
