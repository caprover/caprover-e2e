import { SshClient, SshCommandResult } from '../clients/ssh'

interface DockerService {
    ID?: string
    Spec?: {
        Name?: string
        Mode?: {
            Replicated?: {
                Replicas?: number
            }
        }
        TaskTemplate?: {
            ContainerSpec?: {
                Image?: string
                Env?: string[]
            }
        }
    }
    UpdateStatus?: {
        State?: string
        Message?: string
    }
}

interface DockerTask {
    ID?: string
    DesiredState?: string
    Spec?: {
        ContainerSpec?: {
            Image?: string
        }
    }
    Status?: {
        State?: string
        Message?: string
        Err?: string
    }
}

interface DockerSwarmInfo {
    LocalNodeState?: string
    ControlAvailable?: boolean
}

export interface DockerDiagnostics {
    serviceName?: string
    service?: {
        id?: string
        image?: string
        desiredReplicas?: number
        environmentKeys: string[]
        updateState?: string
        updateMessage?: string
    }
    tasks?: Array<{
        id?: string
        desiredState?: string
        state?: string
        message?: string
        error?: string
        image?: string
    }>
    logs?: string
    error?: string
}

const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/

export class DockerInspector {
    constructor(private readonly ssh: SshClient) {}

    async validateEnvironment(): Promise<void> {
        const result = await this.exec("docker info --format '{{json .Swarm}}'")
        const swarm = parseJson<DockerSwarmInfo>(result.stdout, 'Docker info')

        if (swarm.LocalNodeState !== 'active') {
            throw new Error(
                `Docker Swarm is not active. State: ${swarm.LocalNodeState ?? 'unknown'}`
            )
        }

        if (!swarm.ControlAvailable) {
            throw new Error(
                'SSH_HOST is not a Docker Swarm manager. ControlAvailable is false.'
            )
        }

        const captain = await this.inspectServiceByName('captain-captain')
        if (!captain) {
            throw new Error(
                'The captain-captain service was not found on SSH_HOST'
            )
        }
        console.log(
            `Running CapRover image: ${captain.Spec?.TaskTemplate?.ContainerSpec?.Image ?? 'unknown'}`
        )
    }

    async serviceExists(appName: string): Promise<boolean> {
        return (await this.resolveServiceName(appName)) !== undefined
    }

    async getService(appName: string): Promise<DockerService> {
        const serviceName = await this.requireServiceName(appName)
        const service = await this.inspectServiceByName(serviceName)

        if (!service) {
            throw new Error(`Docker service disappeared: ${serviceName}`)
        }

        return service
    }

    async getServiceImage(appName: string): Promise<string> {
        const service = await this.getService(appName)
        const image = service.Spec?.TaskTemplate?.ContainerSpec?.Image
        if (!image) {
            throw new Error(`Docker service ${appName} has no configured image`)
        }
        return image
    }

    async getServiceUpdateState(appName: string): Promise<string | undefined> {
        return (await this.getService(appName)).UpdateStatus?.State
    }

    async getDesiredReplicas(appName: string): Promise<number> {
        const service = await this.getService(appName)
        const replicated = service.Spec?.Mode?.Replicated
        if (!replicated) {
            throw new Error(
                `Docker service ${appName} is not in replicated mode`
            )
        }
        return replicated.Replicas ?? 1
    }

    async getRunningReplicas(appName: string): Promise<number> {
        const tasks = await this.getDesiredTasks(appName)
        return tasks.filter(
            (task) =>
                task.DesiredState === 'running' &&
                task.Status?.State === 'running'
        ).length
    }

    async getRunningTaskImages(appName: string): Promise<string[]> {
        const tasks = await this.getDesiredTasks(appName)
        return tasks
            .filter(
                (task) =>
                    task.DesiredState === 'running' &&
                    task.Status?.State === 'running'
            )
            .map((task) => task.Spec?.ContainerSpec?.Image)
            .filter((image): image is string => !!image)
    }

    async getServiceEnvironment(appName: string): Promise<string[]> {
        const service = await this.getService(appName)
        return service.Spec?.TaskTemplate?.ContainerSpec?.Env ?? []
    }

    imageMatches(actualImage: string, expectedImage: string): boolean {
        return (
            actualImage === expectedImage ||
            actualImage.startsWith(`${expectedImage}@sha256:`)
        )
    }

    async getDiagnostics(appName: string): Promise<DockerDiagnostics> {
        try {
            const serviceName = await this.resolveServiceName(appName)
            if (!serviceName) {
                return { error: `No Docker service found for ${appName}` }
            }

            const service = await this.inspectServiceByName(serviceName)
            const tasks = await this.getTasksByServiceName(serviceName)
            const logsResult = await this.ssh.exec(
                `docker service logs --raw --tail 100 ${shellQuote(serviceName)}`,
                10_000
            )

            return {
                serviceName,
                service: service
                    ? {
                          id: service.ID,
                          image: service.Spec?.TaskTemplate?.ContainerSpec
                              ?.Image,
                          desiredReplicas:
                              service.Spec?.Mode?.Replicated?.Replicas ?? 1,
                          environmentKeys: (
                              service.Spec?.TaskTemplate?.ContainerSpec?.Env ??
                              []
                          ).map(environmentKey),
                          updateState: service.UpdateStatus?.State,
                          updateMessage: service.UpdateStatus?.Message,
                      }
                    : undefined,
                tasks: tasks.map((task) => ({
                    id: task.ID?.slice(0, 12),
                    desiredState: task.DesiredState,
                    state: task.Status?.State,
                    message: task.Status?.Message,
                    error: task.Status?.Err,
                    image: task.Spec?.ContainerSpec?.Image,
                })),
                logs:
                    logsResult.exitCode === 0
                        ? logsResult.stdout.slice(-10_000)
                        : `Unable to retrieve logs: ${logsResult.stderr.trim()}`,
            }
        } catch (error) {
            return {
                error: error instanceof Error ? error.message : String(error),
            }
        }
    }

    private async getDesiredTasks(appName: string): Promise<DockerTask[]> {
        const serviceName = await this.requireServiceName(appName)
        return this.getTasksByServiceName(serviceName)
    }

    private async getTasksByServiceName(
        serviceName: string
    ): Promise<DockerTask[]> {
        const listResult = await this.exec(
            `docker service ps --no-trunc --quiet --filter desired-state=running ${shellQuote(serviceName)}`
        )
        const taskIds = listResult.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)

        if (taskIds.length === 0) return []

        const inspectResult = await this.exec(
            `docker inspect ${taskIds.map(shellQuote).join(' ')}`
        )
        return parseJson<DockerTask[]>(
            inspectResult.stdout,
            `tasks for ${serviceName}`
        )
    }

    private async requireServiceName(appName: string): Promise<string> {
        const serviceName = await this.resolveServiceName(appName)
        if (!serviceName) {
            throw new Error(
                `Docker service not found for application: ${appName}`
            )
        }
        return serviceName
    }

    private async resolveServiceName(
        appName: string
    ): Promise<string | undefined> {
        validateAppName(appName)
        const candidates = [appName, `srv-captain--${appName}`]

        for (const candidate of candidates) {
            if (await this.serviceExistsByName(candidate)) return candidate
        }

        return undefined
    }

    private async serviceExistsByName(serviceName: string): Promise<boolean> {
        return (await this.inspectServiceByName(serviceName)) !== undefined
    }

    private async inspectServiceByName(
        serviceName: string
    ): Promise<DockerService | undefined> {
        const result = await this.ssh.exec(
            `docker service inspect ${shellQuote(serviceName)}`
        )
        if (result.exitCode !== 0) {
            if (isMissingService(result)) return undefined
            throw new Error(
                `docker service inspect failed for ${serviceName}: ${result.stderr.trim()}`
            )
        }

        const services = parseJson<DockerService[]>(
            result.stdout,
            `service ${serviceName}`
        )
        return services[0]
    }

    private async exec(command: string): Promise<SshCommandResult> {
        const result = await this.ssh.exec(command)
        if (result.exitCode !== 0) {
            throw new Error(
                `Command failed with exit code ${result.exitCode}: ${result.stderr.trim()}`
            )
        }
        return result
    }
}

function validateAppName(appName: string): void {
    if (!APP_NAME_PATTERN.test(appName)) {
        throw new Error(`Unsafe or invalid CapRover app name: ${appName}`)
    }
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`
}

function isMissingService(result: SshCommandResult): boolean {
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
    return (
        output.includes('no such service') ||
        output.includes('service not found')
    )
}

function parseJson<T>(value: string, description: string): T {
    try {
        return JSON.parse(value) as T
    } catch (error) {
        throw new Error(`Unable to parse JSON for ${description}`, {
            cause: error,
        })
    }
}

function environmentKey(entry: string): string {
    const separatorIndex = entry.indexOf('=')
    return separatorIndex < 0 ? entry : entry.slice(0, separatorIndex)
}
