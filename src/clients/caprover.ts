import CapRoverAPI, {
    CapRoverModels,
    SimpleAuthenticationProvider,
} from 'caprover-api'
import { withTimeout } from '../helpers/retry'
import { CAPROVER_API_MIN_INTERVAL_MS } from '../test-settings'

type AppDefinition = CapRoverModels.IAppDef & {
    isLegacyAppName?: boolean
}

type AppChanges = Partial<Omit<AppDefinition, 'appName'>>

interface ServerInfo {
    hasRootSsl: boolean
    forceSsl: boolean
    rootDomain: string
    captainSubDomain: string
}

const API_TIMEOUT_MS = 30_000
const DEPLOYMENT_TIMEOUT_MS = 90_000

export class CapRoverClient {
    private readonly api: CapRoverAPI
    private requestQueue: Promise<void> = Promise.resolve()
    private lastRequestCompletedAt = 0

    constructor(
        baseUrl: string,
        private readonly password: string
    ) {
        const authenticationProvider = new SimpleAuthenticationProvider(() =>
            Promise.resolve({ password: this.password })
        )
        this.api = new CapRoverAPI(baseUrl, authenticationProvider)
    }

    login(): Promise<void> {
        return this.request(
            () => this.api.login(this.password),
            'CapRover authentication'
        )
    }

    getServerInfo(): Promise<ServerInfo> {
        return this.request(
            () => this.api.getCaptainInfo(),
            'retrieving CapRover server information'
        )
    }

    async getApps(): Promise<{
        appDefinitions: AppDefinition[]
        rootDomain: string
    }> {
        return this.request(
            () => this.api.getAllApps(),
            'retrieving CapRover applications'
        )
    }

    async getApp(name: string): Promise<AppDefinition> {
        const response = await this.getApps()
        const app = response.appDefinitions.find(
            (candidate) => candidate.appName === name
        )

        if (!app) {
            throw new Error(`CapRover application not found: ${name}`)
        }

        return app
    }

    async appExists(name: string): Promise<boolean> {
        const response = await this.getApps()
        return response.appDefinitions.some((app) => app.appName === name)
    }

    createApp(name: string, projectId = ''): Promise<void> {
        return this.request(
            () => this.api.registerNewApp(name, projectId, false, false),
            `creating CapRover application ${name}`,
            DEPLOYMENT_TIMEOUT_MS
        )
    }

    renameApp(oldName: string, newName: string): Promise<void> {
        return this.request(
            () => this.api.renameApp(oldName, newName),
            `renaming CapRover application ${oldName} to ${newName}`
        )
    }

    async updateApp(name: string, changes: AppChanges): Promise<void> {
        const current = await this.getApp(name)
        const updated: AppDefinition = {
            ...current,
            ...changes,
            appName: name,
        }

        await this.request(
            () => this.api.updateConfigAndSave(name, updated),
            `updating CapRover application ${name}`
        )
    }

    getProjects() {
        return this.request(() => this.api.getAllProjects(), 'listing projects')
    }

    createProject(name: string, description: string, parentProjectId = '') {
        return this.request(
            () =>
                this.api.registerProject({
                    id: '',
                    name,
                    description,
                    parentProjectId,
                }),
            'creating project'
        )
    }

    updateProject(project: CapRoverModels.ProjectDefinition): Promise<void> {
        return this.request(
            () => this.api.updateProject(project),
            'updating project'
        )
    }

    deleteProject(id: string): Promise<void> {
        return this.request(
            () => this.api.deleteProjects([id]),
            'deleting project'
        )
    }

    patchApp(
        name: string,
        changes: CapRoverModels.IAppDefinitionPatch
    ): Promise<void> {
        return this.request(
            () => this.api.patchAppDefinition(name, changes),
            `patching CapRover application ${name}`
        )
    }

    uploadSource(name: string, file: File, detached: boolean): Promise<void> {
        return this.request(
            () => this.api.uploadAppData(name, file, detached),
            `uploading source for ${name}`,
            DEPLOYMENT_TIMEOUT_MS
        )
    }

    getRuntimeLogs(name: string, encoding: 'ascii' | 'utf8' | 'hex') {
        return this.request(
            () => this.api.fetchAppLogs(name, encoding),
            `reading runtime logs for ${name}`
        )
    }

    getBuildLogs(name: string) {
        return this.request(
            () => this.api.fetchBuildLogs(name),
            `reading build state for ${name}`
        )
    }

    deployDefinition(
        name: string,
        definition: CapRoverModels.ICaptainDefinition,
        gitHash: string,
        detached = false
    ): Promise<void> {
        return this.request(
            () =>
                this.api.uploadCaptainDefinitionContent(
                    name,
                    definition,
                    gitHash,
                    detached
                ),
            `deploying ${name}`,
            DEPLOYMENT_TIMEOUT_MS
        )
    }

    deployImage(name: string, image: string): Promise<void> {
        return this.request(
            () =>
                this.api.uploadCaptainDefinitionContent(
                    name,
                    {
                        schemaVersion: 2,
                        imageName: image,
                    },
                    '',
                    false
                ),
            `deploying ${image} to ${name}`,
            DEPLOYMENT_TIMEOUT_MS
        )
    }

    async deleteApp(name: string): Promise<void> {
        await this.request(
            () => this.api.deleteApp(name, [], undefined),
            `deleting CapRover application ${name}`
        )
    }

    destroy(): void {
        this.api.destroy()
    }

    private async request<T>(
        operation: () => Promise<T>,
        description: string,
        timeoutMs = API_TIMEOUT_MS
    ): Promise<T> {
        let releaseQueue!: () => void
        const previousRequest = this.requestQueue

        this.requestQueue = new Promise<void>((resolve) => {
            releaseQueue = resolve
        })

        await previousRequest

        try {
            const waitMs =
                CAPROVER_API_MIN_INTERVAL_MS -
                (Date.now() - this.lastRequestCompletedAt)

            if (waitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitMs))
            }

            return await withTimeout(operation(), timeoutMs, description)
        } finally {
            this.lastRequestCompletedAt = Date.now()
            releaseQueue()
        }
    }
}

export type { AppDefinition }
