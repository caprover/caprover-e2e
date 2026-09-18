import { existsSync } from 'node:fs'

export interface ProvisioningConfig {
    digitalOceanToken: string
    digitalOceanSshKeyId: string
    cloudflareApiToken: string
    cloudflareZoneId: string
    baseDomain: string
    sshPrivateKey: string
    digitalOceanRegion: string
    digitalOceanSize: string
    digitalOceanImage: string
    caproverImage: string
}

const REQUIRED_VARIABLES = [
    'DIGITALOCEAN_TOKEN',
    'DIGITALOCEAN_SSH_KEY_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ZONE_ID',
    'E2E_BASE_DOMAIN',
    'CAPROVER_E2E_SSH_PRIVATE_KEY',
] as const

export function loadProvisioningConfig(
    environment: NodeJS.ProcessEnv = process.env
): ProvisioningConfig {
    loadLocalEnvironment(environment)

    for (const variableName of REQUIRED_VARIABLES) {
        if (!environment[variableName]?.trim()) {
            throw new Error(
                `Missing required environment variable: ${variableName}`
            )
        }
    }

    const baseDomain = environment
        .E2E_BASE_DOMAIN!.trim()
        .replace(/^\.+|\.+$/g, '')
    if (!baseDomain) {
        throw new Error('E2E_BASE_DOMAIN must contain a domain name')
    }

    return {
        digitalOceanToken: environment.DIGITALOCEAN_TOKEN!.trim(),
        digitalOceanSshKeyId: environment.DIGITALOCEAN_SSH_KEY_ID!.trim(),
        cloudflareApiToken: environment.CLOUDFLARE_API_TOKEN!.trim(),
        cloudflareZoneId: environment.CLOUDFLARE_ZONE_ID!.trim(),
        baseDomain,
        sshPrivateKey: environment.CAPROVER_E2E_SSH_PRIVATE_KEY!.replace(
            /\\n/g,
            '\n'
        ),
        digitalOceanRegion: environment.DIGITALOCEAN_REGION?.trim() || 'nyc3',
        digitalOceanSize:
            environment.DIGITALOCEAN_SIZE?.trim() || 's-1vcpu-2gb',
        digitalOceanImage:
            environment.DIGITALOCEAN_IMAGE?.trim() || 'docker-20-04',
        caproverImage:
            environment.CAPROVER_IMAGE?.trim() || 'caprover/caprover-edge',
    }
}

function loadLocalEnvironment(environment: NodeJS.ProcessEnv): void {
    if (environment !== process.env || process.env.CI || !existsSync('.env')) {
        return
    }

    process.loadEnvFile('.env')
}
