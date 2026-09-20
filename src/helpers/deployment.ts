import { expect } from 'vitest'
import { AppDefinition } from '../clients/caprover'
import { TestContext } from '../context'
import { eventually } from './retry'

export function nextVersion(app: AppDefinition): number {
    return Math.max(
        app.versions.length,
        ...app.versions.map((version) => version.version + 1)
    )
}

export async function waitForDeployment(
    context: TestContext,
    name: string,
    version: number,
    gitHash?: string
): Promise<AppDefinition> {
    return eventually(
        async () => {
            const [app, build] = await Promise.all([
                context.caprover.getApp(name),
                context.caprover.getBuildLogs(name),
            ])
            expect(build.isAppBuilding).toBe(false)
            expect(build.isBuildFailed).toBe(false)
            expect(app.deployedVersion).toBe(version)
            const entry = app.versions.find((item) => item.version === version)
            expect(entry?.deployedImageName).toBeTruthy()
            if (gitHash !== undefined) expect(entry?.gitHash).toBe(gitHash)
            return app
        },
        {
            timeoutMs: 90_000,
            description: `${name} deployment version ${version}`,
        }
    )
}

export async function waitForImage(
    context: TestContext,
    name: string,
    image: string
): Promise<void> {
    await eventually(
        async () => {
            expect(await context.docker.getDesiredReplicas(name)).toBe(1)
            expect(await context.docker.getRunningReplicas(name)).toBe(1)
            expect(
                context.docker.imageMatches(
                    await context.docker.getServiceImage(name),
                    image
                )
            ).toBe(true)
            const images = await context.docker.getRunningTaskImages(name)
            expect(images).toHaveLength(1)
            expect(
                images.every((actual) =>
                    context.docker.imageMatches(actual, image)
                )
            ).toBe(true)
        },
        { timeoutMs: 45_000, description: `${name} running expected image` }
    )
}

export async function withDeploymentDiagnostics(
    context: TestContext,
    name: string,
    operation: () => Promise<void>
): Promise<void> {
    try {
        await operation()
    } catch (error) {
        // Only invoke for test-owned fixtures that never contain credentials.
        const build = await context.caprover
            .getBuildLogs(name)
            .catch(() => undefined)
        console.error(
            JSON.stringify({
                appName: name,
                build: build && {
                    isAppBuilding: build.isAppBuilding,
                    isBuildFailed: build.isBuildFailed,
                    lines: build.logs.lines.slice(-30).join('\n').slice(-6000),
                },
                docker: await context.docker.getDiagnostics(name),
            })
        )
        throw error
    }
}
