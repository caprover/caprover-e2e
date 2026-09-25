import { SshClient } from '../../src/clients/ssh'
import type { ProvisioningConfig } from '../config'
import { retryUntil } from '../retry'

export async function prepareServer(
    ipAddress: string,
    initialPassword: string,
    config: ProvisioningConfig
): Promise<void> {
    console.log('Waiting for SSH...')
    const ssh = await connectWithRetry(ipAddress, config)

    try {
        await prepareDockerHost(ssh)

        console.log('Starting fresh CapRover...')
        const image = shellQuote(config.caproverImage)
        const password = shellQuote(initialPassword)
        const mainNodeIp = shellQuote(ipAddress)
        await runChecked(
            ssh,
            `set -eu
docker pull ${image}
docker run --rm \\
    -p 80:80 -p 443:443 -p 3000:3000 \\
    -e ACCEPTED_TERMS=true \\
    -e DEFAULT_PASSWORD=${password} \\
    -e MAIN_NODE_IP_ADDRESS=${mainNodeIp} \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -v /captain:/captain \\
    ${image}`,
            180_000
        )
        console.log(`Requested CapRover image: ${config.caproverImage}`)
        const imageResult = await ssh.exec(
            "docker service inspect captain-captain --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'"
        )
        if (imageResult.exitCode !== 0)
            throw new Error('Unable to resolve running CapRover image')
        const runningImage = imageResult.stdout.trim()
        console.log(`Running CapRover image: ${runningImage}`)
        const digestResult = await ssh.exec(
            `docker image inspect ${shellQuote(runningImage)} --format '{{join .RepoDigests "\\n"}}'`
        )
        const repository = runningImage
            .replace(/@sha256:[a-f0-9]{64}$/i, '')
            .replace(/:[^/:]+$/, '')
        const resolvedImage = digestResult.stdout
            .split(/\r?\n/)
            .map((value) => value.trim())
            .find(
                (value) =>
                    value.startsWith(`${repository}@sha256:`) &&
                    /^.+@sha256:[a-f0-9]{64}$/i.test(value)
            )
        if (digestResult.exitCode !== 0 || !resolvedImage) {
            throw new Error('Unable to resolve running CapRover image digest')
        }
        console.log(`Resolved running CapRover image digest: ${resolvedImage}`)
    } finally {
        ssh.close()
    }
}

export async function prepareWorker(
    ipAddress: string,
    config: ProvisioningConfig
): Promise<void> {
    console.log('Waiting for worker SSH...')
    const ssh = await connectWithRetry(ipAddress, config)

    try {
        await prepareDockerHost(ssh)
        console.log('Worker Docker host is ready.')
    } finally {
        ssh.close()
    }
}

async function prepareDockerHost(ssh: SshClient): Promise<void> {
    console.log('Installing Docker if needed...')
    await runChecked(
        ssh,
        `set -eu
if ! command -v docker >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
fi
if ! command -v ufw >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ufw
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker version >/dev/null

if command -v ufw >/dev/null 2>&1; then
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 3000/tcp
    ufw allow 996/tcp
    ufw allow 2377/tcp
    ufw allow 7946/tcp
    ufw allow 7946/udp
    ufw allow 4789/tcp
    ufw allow 4789/udp
    ufw allow 2377/udp
    ufw allow 40000:40999/tcp
    ufw allow 40000:40999/udp
fi`,
        180_000
    )
}

async function connectWithRetry(
    ipAddress: string,
    config: ProvisioningConfig
): Promise<SshClient> {
    return retryUntil(
        'SSH',
        async () => {
            const client = new SshClient({
                host: ipAddress,
                port: 22,
                username: 'root',
                privateKey: config.sshPrivateKey,
                connectTimeoutMs: 10_000,
                commandTimeoutMs: 30_000,
            })

            try {
                await client.connect()
                return client
            } catch (error) {
                client.close()
                throw error
            }
        },
        { timeoutMs: 180_000, intervalMs: 5_000 }
    )
}

async function runChecked(
    ssh: SshClient,
    command: string,
    timeoutMs: number
): Promise<void> {
    const result = await ssh.exec(command, timeoutMs)
    if (result.exitCode !== 0) {
        throw new Error(
            `Remote command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`
        )
    }
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`
}
