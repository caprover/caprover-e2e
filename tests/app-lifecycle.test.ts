import { afterAll, expect, test } from 'vitest'
import { AppDefinition } from '../src/clients/caprover'
import { loadConfig } from '../src/config'
import { createTestContext, TestContext } from '../src/context'
import { withImmediateFailureDiagnostics } from '../src/diagnostics'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { step } from '../src/helpers/step'

const FIRST_IMAGE = 'nginx:1.28.3-alpine'
const SECOND_IMAGE = 'nginx:1.29.8-alpine'
const NGINX_RESPONSE_MARKER = 'Welcome to nginx!'
const CONFIG_CONVERGENCE_TIMEOUT_MS = 30_000
const DOCKER_CONVERGENCE_TIMEOUT_MS = 45_000

const config = loadConfig()
const names = createTestNames()
const environmentValue = `caprover-e2e-${names.runId}`

let context: TestContext | undefined
let rootDomain = ''

test('full application lifecycle', async () => {
    context = createTestContext(config)

    await step('environment validation', async () => {
        await context!.caprover.login()
        const [serverInfo, apps] = await Promise.all([
            context!.caprover.getServerInfo(),
            context!.caprover.getApps(),
            context!.ssh
                .connect()
                .then(() => context!.docker.validateEnvironment()),
        ])

        rootDomain = apps.rootDomain.trim()
        expect(rootDomain).not.toBe('')
        expect(serverInfo.rootDomain).toBe(rootDomain)
    })

    await lifecycleStep('create app', [names.initialAppName], async () => {
        await context!.caprover.createApp(names.initialAppName)

        await eventually(
            async () => {
                expect(
                    await context!.caprover.appExists(names.initialAppName)
                ).toBe(true)
                expect(
                    await context!.docker.serviceExists(names.initialAppName)
                ).toBe(true)
                await expectStableReplicas(names.initialAppName, 1)
            },
            {
                timeoutMs: DOCKER_CONVERGENCE_TIMEOUT_MS,
                description: 'the created app to converge',
            }
        )
    })

    await lifecycleStep(
        'rename app',
        [names.initialAppName, names.renamedAppName],
        async () => {
            await context!.caprover.renameApp(
                names.initialAppName,
                names.renamedAppName
            )

            await eventually(
                async () => {
                    expect(
                        await context!.caprover.appExists(names.renamedAppName)
                    ).toBe(true)
                    expect(
                        await context!.caprover.appExists(names.initialAppName)
                    ).toBe(false)
                    expect(
                        await context!.docker.serviceExists(
                            names.renamedAppName
                        )
                    ).toBe(true)
                    expect(
                        await context!.docker.serviceExists(
                            names.initialAppName
                        )
                    ).toBe(false)
                    await expectStableReplicas(names.renamedAppName, 1)
                },
                {
                    timeoutMs: DOCKER_CONVERGENCE_TIMEOUT_MS,
                    description: 'the renamed app to converge',
                }
            )
        }
    )

    await lifecycleStep(
        'configure environment',
        [names.renamedAppName],
        async () => {
            const current = await context!.caprover.getApp(names.renamedAppName)
            const envVars = current.envVars
                .filter((entry) => entry.key !== 'E2E_TEST_VALUE')
                .concat({ key: 'E2E_TEST_VALUE', value: environmentValue })

            await context!.caprover.updateApp(names.renamedAppName, { envVars })

            await eventually(
                async () => {
                    const app = await context!.caprover.getApp(
                        names.renamedAppName
                    )
                    expect(app.envVars).toContainEqual({
                        key: 'E2E_TEST_VALUE',
                        value: environmentValue,
                    })
                    expect(
                        await context!.docker.getServiceEnvironment(
                            names.renamedAppName
                        )
                    ).toContain(`E2E_TEST_VALUE=${environmentValue}`)
                    await expectStableReplicas(names.renamedAppName, 1)
                },
                {
                    timeoutMs: DOCKER_CONVERGENCE_TIMEOUT_MS,
                    description: 'the environment update to converge',
                }
            )
        }
    )

    await lifecycleStep(
        'deploy first nginx image',
        [names.renamedAppName],
        async () => {
            await deployAndVerify(FIRST_IMAGE)
        }
    )

    await lifecycleStep('scale to 2', [names.renamedAppName], async () => {
        await context!.caprover.updateApp(names.renamedAppName, {
            instanceCount: 2,
        })
        await expectScale(2)
        await expectApplicationReachable()
    })

    await lifecycleStep('scale to 1', [names.renamedAppName], async () => {
        await context!.caprover.updateApp(names.renamedAppName, {
            instanceCount: 1,
        })
        await expectScale(1)
        await expectApplicationReachable()
    })

    await lifecycleStep(
        'deploy second nginx image',
        [names.renamedAppName],
        async () => {
            await deployAndVerify(SECOND_IMAGE)
        }
    )

    await lifecycleStep('delete app', [names.renamedAppName], async () => {
        await context!.caprover.deleteApp(names.renamedAppName)

        await eventually(
            async () => {
                expect(
                    await context!.caprover.appExists(names.renamedAppName)
                ).toBe(false)
                expect(
                    await context!.docker.serviceExists(names.renamedAppName)
                ).toBe(false)
            },
            {
                timeoutMs: CONFIG_CONVERGENCE_TIMEOUT_MS,
                description: 'the app to be deleted',
            }
        )

        await context!.http.waitUntilNotMatching(
            applicationUrl(),
            NGINX_RESPONSE_MARKER
        )
    })
})

afterAll(async () => {
    if (!context) return

    for (const appName of [names.renamedAppName, names.initialAppName]) {
        try {
            if (await context.caprover.appExists(appName)) {
                await context.caprover.deleteApp(appName)
            }
        } catch (error) {
            console.warn(
                `Cleanup warning for ${appName}: ${formatError(error)}`
            )
        }
    }

    context.caprover.destroy()
    context.ssh.close()
})

async function lifecycleStep(
    name: string,
    diagnosticAppNames: string[],
    operation: () => Promise<void>
): Promise<void> {
    try {
        await withImmediateFailureDiagnostics(context!.ssh, config, () =>
            step(name, operation)
        )
    } catch (error) {
        await printDiagnostics(diagnosticAppNames)
        throw error
    }
}

async function deployAndVerify(image: string): Promise<void> {
    const before = await context!.caprover.getApp(names.renamedAppName)
    await context!.caprover.deployImage(names.renamedAppName, image)

    await eventually(
        async () => {
            const app = await context!.caprover.getApp(names.renamedAppName)
            expect(app.isAppBuilding).toBe(false)
            expect(app.deployedVersion).toBeGreaterThan(before.deployedVersion)
            expect(currentVersion(app)?.deployedImageName).toBe(image)
        },
        {
            timeoutMs: CONFIG_CONVERGENCE_TIMEOUT_MS,
            description: `CapRover to report ${image} as deployed`,
        }
    )

    await eventually(
        async () => {
            await expectStableReplicas(names.renamedAppName, 1)

            const serviceImage = await context!.docker.getServiceImage(
                names.renamedAppName
            )
            expect(context!.docker.imageMatches(serviceImage, image)).toBe(true)

            const taskImages = await context!.docker.getRunningTaskImages(
                names.renamedAppName
            )
            expect(taskImages).toHaveLength(1)
            expect(
                taskImages.every((taskImage) =>
                    context!.docker.imageMatches(taskImage, image)
                )
            ).toBe(true)
        },
        {
            timeoutMs: DOCKER_CONVERGENCE_TIMEOUT_MS,
            description: `Docker to run ${image}`,
        }
    )

    await expectApplicationReachable()
}

async function expectScale(expectedCount: number): Promise<void> {
    await eventually(
        async () => {
            expect(
                (await context!.caprover.getApp(names.renamedAppName))
                    .instanceCount
            ).toBe(expectedCount)
        },
        {
            timeoutMs: CONFIG_CONVERGENCE_TIMEOUT_MS,
            description: `CapRover to report ${expectedCount} instances`,
        }
    )

    await eventually(
        async () => {
            await expectStableReplicas(names.renamedAppName, expectedCount)
        },
        {
            timeoutMs: DOCKER_CONVERGENCE_TIMEOUT_MS,
            description: `Docker to run ${expectedCount} replicas`,
        }
    )
}

async function expectStableReplicas(
    appName: string,
    expectedCount: number
): Promise<void> {
    expect(await context!.docker.getDesiredReplicas(appName)).toBe(
        expectedCount
    )
    expect(await context!.docker.getRunningReplicas(appName)).toBe(
        expectedCount
    )
}

async function expectApplicationReachable(): Promise<void> {
    await context!.http.waitUntilReachable(
        applicationUrl(),
        NGINX_RESPONSE_MARKER
    )
}

function applicationUrl(): string {
    return `http://${names.renamedAppName}.${rootDomain}`
}

function currentVersion(app: AppDefinition) {
    return app.versions.find(
        (version) => version.version === app.deployedVersion
    )
}

async function printDiagnostics(appNames: string[]): Promise<void> {
    if (!context) return

    const diagnostics = []
    for (const appName of appNames) {
        diagnostics.push({
            appName,
            caprover: await getCapRoverDiagnostics(appName),
            docker: await context.docker.getDiagnostics(appName),
        })
    }

    console.error(
        `Failure diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`
    )
}

async function getCapRoverDiagnostics(appName: string) {
    try {
        const app = await context!.caprover.getApp(appName)
        return {
            appName: app.appName,
            instanceCount: app.instanceCount,
            deployedVersion: app.deployedVersion,
            isAppBuilding: app.isAppBuilding,
            environmentKeys: app.envVars.map((entry) => entry.key),
            versions: app.versions.map((version) => ({
                version: version.version,
                deployedImageName: version.deployedImageName,
                timeStamp: version.timeStamp,
            })),
        }
    } catch (error) {
        return { error: formatError(error) }
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
