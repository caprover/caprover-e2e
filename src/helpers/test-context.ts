import { loadConfig } from '../config'
import { createTestContext, TestContext } from '../context'
import { captureImmediateDiagnostics } from '../diagnostics'
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
        await withCleanup(
            (cleanup) => operation(context, cleanup, rootDomain),
            config.environment === 'ephemeral'
                ? (error) =>
                      captureImmediateDiagnostics(
                          context.ssh,
                          config.caproverUrl,
                          error
                      )
                : undefined
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
