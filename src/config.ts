export interface TestConfig {
    caproverUrl: string
    caproverPassword: string
    sshHost: string
    sshPort: number
    sshUser: string
    sshPrivateKey: string
}

const REQUIRED_VARIABLES = [
    'CAPROVER_URL',
    'CAPROVER_PASSWORD',
    'SSH_HOST',
    'SSH_USER',
    'SSH_PRIVATE_KEY',
] as const

export function loadConfig(
    environment: NodeJS.ProcessEnv = process.env
): TestConfig {
    for (const variableName of REQUIRED_VARIABLES) {
        if (!environment[variableName]?.trim()) {
            throw new Error(
                `Missing required environment variable: ${variableName}`
            )
        }
    }

    const caproverUrl = normalizeCapRoverUrl(environment.CAPROVER_URL!)
    const sshPort = parseSshPort(environment.SSH_PORT)

    return {
        caproverUrl,
        caproverPassword: environment.CAPROVER_PASSWORD!,
        sshHost: environment.SSH_HOST!.trim(),
        sshPort,
        sshUser: environment.SSH_USER!.trim(),
        sshPrivateKey: environment.SSH_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }
}

function normalizeCapRoverUrl(value: string): string {
    let url: URL

    try {
        url = new URL(value.trim())
    } catch {
        throw new Error('CAPROVER_URL must be a valid absolute URL')
    }

    if (url.protocol !== 'https:') {
        throw new Error('CAPROVER_URL must use https')
    }

    if (url.pathname !== '/' || url.search || url.hash) {
        throw new Error(
            'CAPROVER_URL must be an origin without a path, query, or fragment'
        )
    }

    return url.origin
}

function parseSshPort(value: string | undefined): number {
    const port = value?.trim() ? Number(value) : 22

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('SSH_PORT must be an integer between 1 and 65535')
    }

    return port
}
