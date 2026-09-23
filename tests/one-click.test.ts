import { CapRoverModels } from 'caprover-api'
import { expect, test } from 'vitest'
import { RawApiClient } from '../src/clients/raw-api'
import { CleanupRegistry } from '../src/helpers/cleanup'
import { waitForOneClickDeployment } from '../src/helpers/one-click'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { loadConfig } from '../src/config'

const NGINX_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'

test('one-click deployment configures dependent services, a project, and public routing', async () => {
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { runId } = createTestNames()
        const appName = `e2e-${runId}-oneclick`
        const dependencyName = `${appName}-dependency`
        const marker = `oneclick-${runId}`
        const api = context.caprover

        cleanUpProject(api, cleanup, appName)
        cleanUpApp(context, cleanup, dependencyName)
        cleanUpApp(context, cleanup, appName)

        const job = await api.startOneClickAppDeploy(
            dependentTemplate(),
            [
                { key: '$$cap_appname', value: appName },
                { key: '$$cap_root_domain', value: rootDomain },
                { key: '$$cap_http_marker', value: marker },
                { key: '$$cap_environment_marker', value: marker },
            ],
            'TEMPLATE_ONE_CLICK'
        )
        expect(job.jobId).toMatch(/^deploy_/)
        drainJob(api, cleanup, job.jobId)

        const result = await waitForOneClickDeployment(() =>
            api.getOneClickAppDeployProgress(job.jobId)
        )
        expect(result.outcome).toBe('success')
        expect(result.state.error ?? '').toBe('')
        expect(result.state.currentStep).toBe(result.state.steps.length)
        expect(result.state.successMessage).toContain(marker)
        expect(result.history.map((state) => state.currentStep)).toEqual(
            [...result.history]
                .map((state) => state.currentStep)
                .sort((left, right) => left - right)
        )
        expectStepOrder(
            result.state.steps,
            `Registering ${dependencyName}`,
            `Registering ${appName}`
        )
        expectStepOrder(
            result.state.steps,
            `Deploying ${dependencyName} (might take up to a minute)`,
            `Deploying ${appName} (might take up to a minute)`
        )

        const [webApp, dependencyApp, projects] = await Promise.all([
            api.getApp(appName),
            api.getApp(dependencyName),
            api.getProjects(),
        ])
        const project = projects.projects.find((item) => item.name === appName)
        expect(project, 'the one-click project exists').toBeDefined()
        if (!project) throw new Error(`One-click project ${appName} was absent`)
        expect(webApp.projectId).toBe(project.id)
        expect(dependencyApp.projectId).toBe(project.id)
        expect(webApp.tags).toEqual(
            expect.arrayContaining([{ tagName: appName }])
        )
        expect(dependencyApp.tags).toEqual(
            expect.arrayContaining([{ tagName: appName }])
        )
        expect(webApp.envVars).toEqual(
            expect.arrayContaining([
                { key: 'E2E_MARKER', value: marker },
                { key: 'ROOT_DOMAIN', value: rootDomain },
                {
                    key: 'DEPENDENCY_HOST',
                    value: `srv-captain--${dependencyName}`,
                },
            ])
        )
        expect(dependencyApp.envVars).toEqual(
            expect.arrayContaining([{ key: 'E2E_MARKER', value: marker }])
        )
        expect(dependencyApp.notExposeAsWebApp).toBe(true)

        await eventually(
            async () => {
                for (const name of [dependencyName, appName]) {
                    expect(await context.docker.getDesiredReplicas(name)).toBe(
                        1
                    )
                    expect(await context.docker.getRunningReplicas(name)).toBe(
                        1
                    )
                    expect(
                        context.docker.imageMatches(
                            await context.docker.getServiceImage(name),
                            NGINX_IMAGE
                        )
                    ).toBe(true)
                }
                expect(
                    await context.docker.getServiceEnvironment(appName)
                ).toEqual(
                    expect.arrayContaining([
                        `E2E_MARKER=${marker}`,
                        `ROOT_DOMAIN=${rootDomain}`,
                        `DEPENDENCY_HOST=srv-captain--${dependencyName}`,
                    ])
                )
                expect(
                    await context.docker.getServiceEnvironment(dependencyName)
                ).toEqual(expect.arrayContaining([`E2E_MARKER=${marker}`]))
            },
            { timeoutMs: 60_000, description: 'one-click Docker service state' }
        )

        const webUrl = `http://${appName}.${rootDomain}`
        await context.http.waitUntilReachable(webUrl, marker, 60_000)
    })
})

test('one-click deployment progress reports asynchronous template errors', async () => {
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const job = await api.startOneClickAppDeploy(
            cyclicTemplate(),
            [],
            'TEMPLATE_ONE_CLICK'
        )
        drainJob(api, cleanup, job.jobId)
        const result = await waitForOneClickDeployment(() =>
            api.getOneClickAppDeployProgress(job.jobId)
        )
        expect(result.outcome).toBe('error')
        expect(result.state.error).toContain(
            'Dependency tree cannot be resolved'
        )
    })
})

test('one-click deployment and job validation use the documented parameter status', async () => {
    const config = loadConfig()
    const raw = new RawApiClient(config.caproverUrl)
    await raw.login(config.caproverPassword)

    expect(
        (
            await raw.request('POST', '/user/oneclick/deploy', {
                values: [],
                templateName: 'TEMPLATE_ONE_CLICK',
            })
        ).status
    ).toBe(1110)

    await withTestContext(async (context) => {
        await expect(
            context.caprover.getOneClickAppDeployProgress('')
        ).rejects.toMatchObject({ captainStatus: 1110 })
        await expect(
            context.caprover.getOneClickAppDeployProgress(
                `deploy-e2e-${createTestNames().runId}`
            )
        ).rejects.toMatchObject({ captainStatus: 1110 })
    })
})

function dependentTemplate(): CapRoverModels.IOneClickTemplate {
    return {
        captainVersion: 4,
        services: {
            '$$cap_appname-dependency': {
                image: NGINX_IMAGE,
                environment: { E2E_MARKER: '$$cap_environment_marker' },
                caproverExtra: {
                    containerHttpPort: 80,
                    notExposeAsWebApp: true,
                    websocketSupport: false,
                },
            },
            $$cap_appname: {
                image: NGINX_IMAGE,
                depends_on: ['$$cap_appname-dependency'],
                environment: {
                    E2E_MARKER: '$$cap_environment_marker',
                    ROOT_DOMAIN: '$$cap_root_domain',
                    DEPENDENCY_HOST: 'srv-captain--$$cap_appname-dependency',
                },
                command: [
                    '/bin/sh',
                    '-c',
                    "printf '%s' '$$cap_http_marker' > /usr/share/nginx/html/index.html && exec nginx -g 'daemon off;'",
                ],
            },
        },
        caproverOneClickApp: {
            variables: [
                { id: '$$cap_appname', label: 'App Name' },
                { id: '$$cap_root_domain', label: 'Root Domain' },
                { id: '$$cap_http_marker', label: 'HTTP marker' },
                { id: '$$cap_environment_marker', label: 'Environment marker' },
            ],
            instructions: {
                start: 'Deploying a deterministic E2E fixture',
                end: 'One-click fixture complete: $$cap_http_marker',
            },
            displayName: 'CapRover E2E one-click fixture',
        },
    }
}

function cyclicTemplate(): CapRoverModels.IOneClickTemplate {
    return {
        captainVersion: 4,
        services: {
            first: { image: NGINX_IMAGE, depends_on: ['second'] },
            second: { image: NGINX_IMAGE, depends_on: ['first'] },
        },
        caproverOneClickApp: {
            variables: [],
            instructions: { start: '', end: '' },
            displayName: 'Cyclic E2E fixture',
        },
    }
}

function cleanUpProject(
    api: import('../src/clients/caprover').CapRoverClient,
    cleanup: CleanupRegistry,
    name: string
): void {
    cleanup.add(async () => {
        const { projects } = await api.getProjects()
        for (const project of projects.filter((item) => item.name === name))
            await api.deleteProject(project.id)
    })
}

function drainJob(
    api: import('../src/clients/caprover').CapRoverClient,
    cleanup: CleanupRegistry,
    jobId: string
): void {
    cleanup.add(async () => {
        await waitForOneClickDeployment(
            () => api.getOneClickAppDeployProgress(jobId),
            { timeoutMs: 120_000 }
        )
    })
}

function expectStepOrder(steps: string[], before: string, after: string): void {
    const beforeIndex = steps.indexOf(before)
    const afterIndex = steps.indexOf(after)
    expect(beforeIndex, `progress contains ${before}`).toBeGreaterThanOrEqual(0)
    expect(afterIndex, `progress contains ${after}`).toBeGreaterThanOrEqual(0)
    expect(beforeIndex).toBeLessThan(afterIndex)
}
