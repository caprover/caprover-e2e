export const smokeFiles = ['tests/app-lifecycle.test.ts']
export const nginxReloadRaceFiles = ['tests/nginx-reload-keepalive.test.ts']
export const coreFiles = [
    'tests/authentication.test.ts',
    'tests/app-configuration.test.ts',
    'tests/projects.test.ts',
    'tests/deployments.test.ts',
    'tests/source-upload-and-logs.test.ts',
    'tests/app-routing.test.ts',
    'tests/app-nginx.test.ts',
    'tests/advanced-app-settings.test.ts',
    'tests/system-info.test.ts',
    'tests/one-click.test.ts',
]
export const destructiveFiles = [
    'tests/system-defaults.test.ts',
    'tests/persistent-storage.test.ts',
    'tests/custom-ports.test.ts',
    'tests/themes.test.ts',
    'tests/backup.test.ts',
    'tests/disk-cleanup.test.ts',
    'tests/system-nginx.test.ts',
    'tests/one-click-repositories.test.ts',
    'tests/registries.test.ts',
    'tests/goaccess.test.ts',
    'tests/netdata.test.ts',
]

export function requireEphemeral(environment = process.env): void {
    if (environment.CAPROVER_E2E_ENVIRONMENT !== 'ephemeral') {
        throw new Error(
            'Destructive tests require CAPROVER_E2E_ENVIRONMENT=ephemeral'
        )
    }
}

export function selectTests(mode: string, environment = process.env): string[] {
    switch (mode) {
        case 'unit':
            return ['tests/unit/**/*.test.ts']
        case 'smoke':
            return smokeFiles
        case 'core':
            return coreFiles
        case 'nginx-reload-race':
            return nginxReloadRaceFiles
        case 'destructive':
            requireEphemeral(environment)
            return destructiveFiles
        case 'test':
        case 'all':
            return [
                'tests/unit/**/*.test.ts',
                ...smokeFiles,
                ...coreFiles,
                ...(environment.CAPROVER_E2E_ENVIRONMENT === 'ephemeral'
                    ? destructiveFiles
                    : []),
            ]
        default:
            throw new Error(`Unknown test mode: ${mode}`)
    }
}
