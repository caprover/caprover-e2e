import { loadConfig } from '../config'
import { createTestContext, TestContext } from '../context'
import { withImmediateFailureDiagnostics } from '../diagnostics'
import { CleanupRegistry, withCleanup } from './cleanup'
import { eventually } from './retry'

export async function withTestContext(
    operation: (
        context: TestContext,
        cleanup: CleanupRegistry,
        rootDomain: string
    ) => Promise<void>
): Promise<void> {
    const config = loadConfig()
    const context = createTestContext(config)
    try {
        await context.caprover.login()
        await context.ssh.connect()
        await context.docker.validateEnvironment()
        const { rootDomain } = await context.caprover.getApps()
        await withCleanup((cleanup) =>
            withImmediateFailureDiagnostics(context.ssh, config, () =>
                operation(context, cleanup, rootDomain)
            )
        )
    } finally {
        context.caprover.destroy()
        context.ssh.close()
    }
}

export function cleanUpApp(
    context: TestContext,
    cleanup: CleanupRegistry,
    name: string
): void {
    cleanup.add(async () => {
        if (await context.caprover.appExists(name))
            await context.caprover.deleteApp(name)
        await eventually(
            async () => {
                if (
                    (await context.caprover.appExists(name)) ||
                    (await context.docker.serviceExists(name))
                ) {
                    throw new Error(`Owned app ${name} remains after deletion`)
                }
            },
            { description: `deletion of ${name}` }
        )
    })
}

export function cleanUpVolume(
    context: TestContext,
    cleanup: CleanupRegistry,
    volumeName: string
): void {
    cleanup.add(async () => {
        await context.docker.removeVolume(volumeName)
        await eventually(
            async () => {
                if (await context.docker.volumeExists(volumeName)) {
                    throw new Error(
                        `Owned Docker volume ${volumeName} remains after deletion`
                    )
                }
            },
            { description: `deletion of owned volume ${volumeName}` }
        )
    })
}
