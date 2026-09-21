import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { promisify } from 'node:util'
import { SshClient, SshCommandResult } from './clients/ssh'
import { TestConfig } from './config'

const execFileAsync = promisify(execFile)
const IMMEDIATE_TIMEOUT_MS = 5_000
const FULL_TIMEOUT_MS = 7_000
const MAX_SECTION_OUTPUT = 50_000
const CAPTAIN_LOG_TAIL_LINES = 200
const NGINX_LOG_TAIL_LINES = 115
const DOCKER_EVENT_TAIL_LINES = 75

interface SshExecutor {
    exec(command: string, timeoutMs?: number): Promise<SshCommandResult>
}

interface DiagnosticSection {
    title: string
    command: string
    timeoutMs?: number
    preserveNewestOnClip?: boolean
}

interface ProbeResult {
    label: string
    passed: boolean
    details: string
}

export async function captureImmediateDiagnostics(
    ssh: SshExecutor,
    caproverUrl: string,
    failure?: unknown
): Promise<void> {
    console.log('\n===== IMMEDIATE FAILURE DIAGNOSTICS =====')
    if (failure) console.log(`Failure: ${formatError(failure)}`)

    for (const section of buildImmediateDiagnosticSections(caproverUrl)) {
        await runRemoteSection(ssh, section, IMMEDIATE_TIMEOUT_MS)
    }
}

export async function withImmediateFailureDiagnostics<T>(
    ssh: SshExecutor,
    config: TestConfig,
    operation: () => Promise<T>
): Promise<T> {
    try {
        return await operation()
    } catch (error) {
        try {
            await printRunnerConnectivity(config)
        } catch (diagnosticError) {
            console.error(
                `Runner connectivity diagnostics failed: ${formatError(diagnosticError)}`
            )
        }

        try {
            await captureImmediateDiagnostics(ssh, config.caproverUrl, error)
        } catch (diagnosticError) {
            console.error(
                `Infrastructure diagnostics also failed: ${formatError(diagnosticError)}`
            )
        }

        throw error
    }
}

export async function collectFailureDiagnostics(
    config: TestConfig
): Promise<void> {
    console.log('\n===== FAILURE DIAGNOSTICS =====')
    console.log(`Captured: ${new Date().toISOString()}`)

    await printRunnerConnectivity(config)

    const ssh = new SshClient({
        host: config.sshHost,
        port: config.sshPort,
        username: config.sshUser,
        privateKey: config.sshPrivateKey,
        connectTimeoutMs: 8_000,
        commandTimeoutMs: FULL_TIMEOUT_MS,
    })

    try {
        await ssh.connect()
        console.log('SSH: PASS')
    } catch (error) {
        console.log(`SSH: FAIL ${formatError(error)}`)
        ssh.close()
        return
    }

    try {
        for (const section of buildFullDiagnosticSections(config.caproverUrl)) {
            await runRemoteSection(ssh, section, FULL_TIMEOUT_MS)
        }
    } finally {
        ssh.close()
    }
}

export function buildImmediateDiagnosticSections(
    caproverUrl: string
): DiagnosticSection[] {
    const hostname = new URL(caproverUrl).hostname
    return [
        {
            title: 'Immediate connectivity',
            command: buildLocalConnectivityCommand(caproverUrl, hostname),
        },
        {
            title: 'Conntrack pressure',
            command: [
                "if [ -r /proc/sys/net/netfilter/nf_conntrack_count ]; then printf 'nf_conntrack_count='; cat /proc/sys/net/netfilter/nf_conntrack_count; else echo 'nf_conntrack_count unavailable'; fi",
                "if [ -r /proc/sys/net/netfilter/nf_conntrack_max ]; then printf 'nf_conntrack_max='; cat /proc/sys/net/netfilter/nf_conntrack_max; else echo 'nf_conntrack_max unavailable'; fi",
                "journalctl -k --since '3 minutes ago' --no-pager | grep -Ei 'conntrack|nf_conntrack|table full' | tail -n 100 || true",
            ].join('\n'),
        },
        {
            title: 'Core service state',
            command:
                "docker service ls --format 'table {{.Name}}\\t{{.Mode}}\\t{{.Replicas}}\\t{{.Image}}'",
        },
        {
            title: 'Captain task history',
            command: servicePsCommand('captain-captain'),
        },
        {
            title: 'Nginx task history',
            command: servicePsCommand('captain-nginx'),
        },
        {
            title: 'Captain recent logs',
            command: `docker service logs captain-captain --timestamps --tail ${CAPTAIN_LOG_TAIL_LINES} 2>&1`,
            preserveNewestOnClip: true,
        },
        {
            title: 'Nginx recent logs',
            command: `docker service logs captain-nginx --timestamps --tail ${NGINX_LOG_TAIL_LINES} 2>&1`,
            preserveNewestOnClip: true,
        },
        {
            title: 'Recent Docker events',
            command: dockerEventsCommand('3 minutes ago'),
            preserveNewestOnClip: true,
        },
    ]
}

function buildFullDiagnosticSections(caproverUrl: string): DiagnosticSection[] {
    const hostname = new URL(caproverUrl).hostname
    return [
        {
            title: 'Server connectivity',
            command: buildLocalConnectivityCommand(caproverUrl, hostname),
        },
        {
            title: 'Host resources',
            command: [
                'date -u',
                'uptime',
                'free -h',
                'df -h',
                'df -ih',
                'ss -s',
                "if [ -r /proc/sys/net/netfilter/nf_conntrack_count ]; then printf 'nf_conntrack_count='; cat /proc/sys/net/netfilter/nf_conntrack_count; fi",
                "if [ -r /proc/sys/net/netfilter/nf_conntrack_max ]; then printf 'nf_conntrack_max='; cat /proc/sys/net/netfilter/nf_conntrack_max; fi",
                "ss -ltnp | grep -E ':(80|443|3000)\\b' || true",
                'ip -brief addr',
                'ip route',
                'if command -v ufw >/dev/null 2>&1; then ufw status verbose; fi',
            ].join('\n'),
        },
        {
            title: 'Docker daemon and Swarm',
            command: [
                'systemctl show docker --no-pager --property=ActiveState,SubState,NRestarts,ExecMainStartTimestamp,ActiveEnterTimestamp',
                'docker version',
                'docker info',
                'docker node ls',
                "docker service ls --format 'table {{.ID}}\\t{{.Name}}\\t{{.Mode}}\\t{{.Replicas}}\\t{{.Image}}'",
                "docker ps -a --no-trunc --format 'table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.RunningFor}}\\t{{.Ports}}'",
                'docker network ls',
                "docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.NetIO}}'",
            ].join('\n'),
        },
        {
            title: 'All service task history',
            command: `for service in $(docker service ls --format '{{.Name}}'); do
    echo "### $service"
    docker service ps "$service" --no-trunc --format 'table {{.ID}}\\t{{.Name}}\\t{{.Image}}\\t{{.Node}}\\t{{.DesiredState}}\\t{{.CurrentState}}\\t{{.Error}}'
done`,
        },
        {
            title: 'Core container state',
            command: `for service in captain-captain captain-nginx; do
    echo "### $service"
    containers=$(docker ps -aq --filter "label=com.docker.swarm.service.name=$service")
    if [ -n "$containers" ]; then
        for container in $containers; do
            docker inspect --format 'Name={{.Name}} Image={{.Config.Image}} RestartCount={{.RestartCount}} State={{json .State}}' "$container"
        done
    else
        echo "No container found"
    fi
done`,
        },
        {
            title: 'Captain logs',
            command: `docker service logs captain-captain --timestamps --tail ${CAPTAIN_LOG_TAIL_LINES} 2>&1`,
            preserveNewestOnClip: true,
        },
        {
            title: 'Nginx logs',
            command: `docker service logs captain-nginx --timestamps --tail ${NGINX_LOG_TAIL_LINES} 2>&1`,
            preserveNewestOnClip: true,
        },
        {
            title: 'Recent shared nginx access logs',
            command:
                "if [ -d /captain/data/shared-logs ]; then find /captain/data/shared-logs -maxdepth 1 -type f -mmin -20 -print -exec tail -n 100 {} \\;; else echo 'No shared nginx log directory'; fi",
        },
        {
            title: 'Docker events',
            command: dockerEventsCommand('15 minutes ago'),
            preserveNewestOnClip: true,
        },
        {
            title: 'Docker and containerd journal',
            command:
                "journalctl -u docker -u containerd --since '15 minutes ago' --no-pager -n 400",
        },
        {
            title: 'Kernel errors and OOM evidence',
            command:
                "journalctl -k --since '15 minutes ago' --no-pager | grep -Ei 'oom|out of memory|killed process|segfault|panic|overlay|vxlan|conntrack|nf_conntrack|table full' | tail -n 200 || true",
        },
        {
            title: 'Captain overlay network',
            command:
                'docker network inspect captain-overlay-network 2>&1 || true',
        },
        {
            title: 'Nginx configuration and Docker DNS',
            command: `container=$(docker ps -q --filter 'label=com.docker.swarm.service.name=captain-nginx' | head -n 1)
if [ -z "$container" ]; then
    echo "No running captain-nginx container"
else
    docker exec "$container" nginx -t 2>&1
    docker exec "$container" sh -c 'cat /etc/resolv.conf; if command -v getent >/dev/null 2>&1; then getent hosts captain-captain; else echo "getent unavailable"; fi' 2>&1
fi`,
        },
    ]
}

async function printRunnerConnectivity(config: TestConfig): Promise<void> {
    const hostname = new URL(config.caproverUrl).hostname
    const probes: ProbeResult[] = []

    try {
        const addresses = await lookup(hostname, { all: true })
        probes.push({
            label: 'DNS lookup',
            passed: true,
            details: addresses
                .map((address) => `${address.address}/IPv${address.family}`)
                .join(', '),
        })
    } catch (error) {
        probes.push({
            label: 'DNS lookup',
            passed: false,
            details: formatError(error),
        })
    }

    const connectivityProbes = await Promise.all([
        curlProbe('Public HTTPS', [`${config.caproverUrl}/`]),
        curlProbe('HTTPS bypassing DNS', [
            '--resolve',
            `${hostname}:443:${config.sshHost}`,
            `${config.caproverUrl}/`,
        ]),
        curlProbe('Captain port 3000', [
            `http://${urlHost(config.sshHost)}:3000/`,
        ]),
    ])
    probes.push(...connectivityProbes)

    startGroup('Runner connectivity')
    for (const probe of probes) {
        console.log(
            `${probe.label}: ${probe.passed ? 'PASS' : 'FAIL'} ${probe.details}`
        )
    }
    endGroup()
}

async function curlProbe(
    label: string,
    extraArguments: string[]
): Promise<ProbeResult> {
    const format =
        'http=%{http_code} remote=%{remote_ip} dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s first_byte=%{time_starttransfer}s total=%{time_total}s'

    try {
        const { stdout, stderr } = await execFileAsync(
            'curl',
            [
                '-sS',
                '-o',
                '/dev/null',
                '--max-time',
                '8',
                '-w',
                format,
                ...extraArguments,
            ],
            { timeout: 10_000, maxBuffer: 1024 * 1024 }
        )
        return {
            label,
            passed: true,
            details: [stdout.trim(), stderr.trim()].filter(Boolean).join(' '),
        }
    } catch (error) {
        return {
            label,
            passed: false,
            details: formatExecError(error),
        }
    }
}

async function runRemoteSection(
    ssh: SshExecutor,
    section: DiagnosticSection,
    defaultTimeoutMs: number
): Promise<void> {
    startGroup(section.title)
    try {
        const result = await ssh.exec(
            section.command,
            section.timeoutMs ?? defaultTimeoutMs
        )
        const output = [result.stdout.trim(), result.stderr.trim()]
            .filter(Boolean)
            .join('\n')
        console.log(clip(output || '(no output)', section.preserveNewestOnClip))
        if (result.exitCode !== 0)
            console.log(`[exit code: ${result.exitCode}]`)
    } catch (error) {
        console.log(`[diagnostic command failed] ${formatError(error)}`)
    } finally {
        endGroup()
    }
}

function buildLocalConnectivityCommand(
    caproverUrl: string,
    hostname: string
): string {
    const writeFormat =
        'status=%{http_code} remote=%{remote_ip} connect=%{time_connect}s first_byte=%{time_starttransfer}s total=%{time_total}s\\n'

    return `date -u
echo "DNS:"
getent ahosts ${shellQuote(hostname)} || true
echo "Captain direct:"
curl -sS -o /dev/null --max-time 5 -w ${shellQuote(writeFormat)} http://127.0.0.1:3000/ || true
echo "Nginx to Captain:"
curl -sS -o /dev/null --max-time 5 --resolve ${shellQuote(`${hostname}:443:127.0.0.1`)} -w ${shellQuote(writeFormat)} ${shellQuote(`${caproverUrl}/`)} || true`
}

function servicePsCommand(serviceName: string): string {
    return `docker service ps ${shellQuote(serviceName)} --no-trunc --format 'table {{.ID}}\\t{{.Name}}\\t{{.Image}}\\t{{.Node}}\\t{{.DesiredState}}\\t{{.CurrentState}}\\t{{.Error}}'`
}

function dockerEventsCommand(since: string): string {
    return `since=$(date -u -d ${shellQuote(since)} +%Y-%m-%dT%H:%M:%SZ)
until=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker events --since "$since" --until "$until" --filter type=container --filter type=service --filter type=node --filter type=network --filter type=daemon | tail -n ${DOCKER_EVENT_TAIL_LINES}`
}

function startGroup(title: string): void {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::group::${title}`)
    else console.log(`\n--- ${title} ---`)
}

function endGroup(): void {
    if (process.env.GITHUB_ACTIONS === 'true') console.log('::endgroup::')
}

function formatExecError(error: unknown): string {
    if (!isExecError(error)) return formatError(error)
    return clip(
        [error.message, error.stdout?.trim(), error.stderr?.trim()]
            .filter(Boolean)
            .join(' ')
    )
}

function isExecError(
    error: unknown
): error is Error & { stdout?: string; stderr?: string } {
    return (
        error instanceof Error &&
        (('stdout' in error && typeof error.stdout === 'string') ||
            ('stderr' in error && typeof error.stderr === 'string'))
    )
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function clip(value: string, preserveNewest = false): string {
    if (value.length <= MAX_SECTION_OUTPUT) return value
    const clipped = preserveNewest
        ? value.slice(-MAX_SECTION_OUTPUT)
        : value.slice(0, MAX_SECTION_OUTPUT)
    return `${preserveNewest ? '[output truncated]\n' : ''}${clipped}${preserveNewest ? '' : '\n[output truncated]'}`
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`
}

function urlHost(host: string): string {
    return host.includes(':') ? `[${host}]` : host
}
