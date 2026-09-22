import CapRoverAPI, {
    CapRoverModels,
    SimpleAuthenticationProvider,
} from 'caprover-api'
import { withTimeout } from '../helpers/retry'

type AppDeleteResponse = Awaited<ReturnType<CapRoverAPI['deleteApp']>>

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

type Theme = NonNullable<
    Awaited<ReturnType<CapRoverAPI['getAllThemes']>>['themes']
>[number]
type VersionInfo = Awaited<ReturnType<CapRoverAPI['getVersionInfo']>>
type LoadBalancerInfo = Awaited<ReturnType<CapRoverAPI['getLoadBalancerInfo']>>
type NodeInfo = Awaited<ReturnType<CapRoverAPI['getAllNodes']>>['nodes'][number]
type ProFeaturesState = Awaited<
    ReturnType<CapRoverAPI['getProFeaturesState']>
>['proFeaturesState']
type ProConfigs = Awaited<
    ReturnType<CapRoverAPI['getProConfigs']>
>['proConfigs']
type DiskCleanupSettings = Awaited<
    ReturnType<CapRoverAPI['getDiskCleanUpSettings']>
>
type NginxConfig = Awaited<ReturnType<CapRoverAPI['getNginxConfig']>>
type UnusedImage = Awaited<
    ReturnType<CapRoverAPI['getUnusedImages']>
>['unusedImages'][number]

const API_TIMEOUT_MS = 30_000
const DEPLOYMENT_TIMEOUT_MS = 90_000

export class CapRoverClient {
    private readonly api: CapRoverAPI

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

    getVersionInfo(): Promise<VersionInfo> {
        return this.request(
            () => this.api.getVersionInfo(),
            'retrieving CapRover version information'
        )
    }

    getLoadBalancerInfo(): Promise<LoadBalancerInfo> {
        return this.request(
            () => this.api.getLoadBalancerInfo(),
            'retrieving load-balancer information'
        )
    }

    getAllNodes(): Promise<{ nodes: NodeInfo[] }> {
        return this.request(() => this.api.getAllNodes(), 'listing Swarm nodes')
    }

    getProFeaturesState(): Promise<ProFeaturesState> {
        return this.request(
            () => this.api.getProFeaturesState(),
            'retrieving Pro feature state'
        ).then((response) => response.proFeaturesState)
    }

    getProConfigs(): Promise<ProConfigs> {
        return this.request(
            () => this.api.getProConfigs(),
            'retrieving Pro configuration'
        ).then((response) => response.proConfigs)
    }

    createBackup(): Promise<{ downloadToken: string }> {
        return this.request(() => this.api.createBackup(), 'creating backup')
    }

    getDiskCleanupSettings(): Promise<DiskCleanupSettings> {
        return this.request(
            () => this.api.getDiskCleanUpSettings(),
            'retrieving disk-cleanup settings'
        )
    }

    setDiskCleanupSettings(settings: DiskCleanupSettings): Promise<void> {
        return this.request(
            () =>
                this.api.setDiskCleanUpSettings(
                    settings.mostRecentLimit,
                    settings.cronSchedule,
                    settings.timezone
                ),
            'updating disk-cleanup settings'
        )
    }

    getUnusedImages(
        mostRecentLimit: number
    ): Promise<{ unusedImages: UnusedImage[] }> {
        return this.request(
            () => this.api.getUnusedImages(mostRecentLimit),
            'retrieving unused Docker images'
        )
    }

    deleteImages(imageIds: string[]): Promise<void> {
        return this.request(
            () => this.api.deleteImages(imageIds),
            'deleting Docker images'
        )
    }

    getNginxConfig(): Promise<NginxConfig> {
        return this.request(
            () => this.api.getNginxConfig(),
            'retrieving global Nginx configuration'
        )
    }

    setNginxConfig(baseConfig: string, captainConfig: string): Promise<void> {
        return this.request(
            () => this.api.setNginxConfig(baseConfig, captainConfig),
            'updating global Nginx configuration'
        )
    }

    getAllThemes(): Promise<{ themes: Theme[] | undefined }> {
        return this.request(() => this.api.getAllThemes(), 'listing themes')
    }

    getCurrentTheme(): Promise<{ theme: Theme | undefined }> {
        return this.request(
            () =>
                this.api.getCurrentTheme() as Promise<{
                    theme: Theme | undefined
                }>,
            'retrieving the current theme'
        )
    }

    async saveTheme(oldName: string, theme: Theme): Promise<void> {
        await this.request(
            () => this.api.saveTheme(oldName, theme),
            `saving theme ${theme.name}`
        )
    }

    async setCurrentTheme(themeName: string): Promise<void> {
        await this.request(
            () => this.api.setCurrentTheme(themeName),
            `selecting theme ${themeName}`
        )
    }

    async deleteTheme(themeName: string): Promise<void> {
        await this.request(
            () => this.api.deleteTheme(themeName),
            `deleting theme ${themeName}`
        )
    }

    async getApps(): Promise<{
        appDefinitions: AppDefinition[]
        rootDomain: string
        defaultNginxConfig: string
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

    createPersistentApp(name: string): Promise<void> {
        return this.request(
            () => this.api.registerNewApp(name, '', true, false),
            `creating persistent CapRover application ${name}`,
            DEPLOYMENT_TIMEOUT_MS
        )
    }

    renameApp(oldName: string, newName: string): Promise<void> {
        return this.request(
            () => this.api.renameApp(oldName, newName),
            `renaming CapRover application ${oldName} to ${newName}`
        )
    }

    attachCustomDomain(name: string, domain: string): Promise<void> {
        return this.request(
            () => this.api.attachNewCustomDomainToApp(name, domain),
            `attaching custom domain ${domain} to ${name}`
        )
    }

    removeCustomDomain(name: string, domain: string): Promise<void> {
        return this.request(
            () => this.api.removeCustomDomain(name, domain),
            `removing custom domain ${domain} from ${name}`
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

    deleteApp(
        name: string,
        volumes: string[] = []
    ): Promise<AppDeleteResponse> {
        return this.request(
            () => this.api.deleteApp(name, volumes, undefined),
            `deleting CapRover application ${name}`
        )
    }

    deleteApps(appNames: string[]): Promise<AppDeleteResponse> {
        return this.request(
            () => this.api.deleteApp(undefined, [], appNames),
            `deleting CapRover applications ${appNames.join(', ')}`
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
        return withTimeout(operation(), timeoutMs, description)
    }
}

export type {
    AppDefinition,
    DiskCleanupSettings,
    LoadBalancerInfo,
    NginxConfig,
    NodeInfo,
    ProConfigs,
    ProFeaturesState,
    Theme,
    UnusedImage,
    VersionInfo,
}
