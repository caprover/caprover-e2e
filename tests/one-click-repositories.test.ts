import { CapRoverModels } from 'caprover-api'
import { expect, test } from 'vitest'
import { CleanupRegistry } from '../src/helpers/cleanup'
import {
    nextVersion,
    waitForDeployment,
    waitForServiceStable,
} from '../src/helpers/deployment'
import { waitForOneClickDeployment } from '../src/helpers/one-click'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import {
    oneClickRepositorySourceArchive,
    OneClickRepositoryFixtureData,
} from '../src/helpers/source-fixture'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const NGINX_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'

test('custom one-click repositories list, fetch, deploy, reject duplicates, and clean up', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { runId } = createTestNames()
        const repositoryAppName = `e2e-${runId}-oneclick-repo`
        const deployedAppName = `e2e-${runId}-oneclick-template`
        const templateName = `e2e-template-${runId}`
        const marker = `repository-template-${runId}`
        const repositoryBaseUrl = `http://${repositoryAppName}.${rootDomain}`
        const api = context.caprover
        const repositoryData = fixtureData(templateName)

        cleanUpApp(context, cleanup, repositoryAppName)
        cleanUpRepository(api, cleanup, repositoryBaseUrl)

        await api.createApp(repositoryAppName)
        await api.updateApp(repositoryAppName, { containerHttpPort: 8080 })
        const repositoryVersion = nextVersion(
            await api.getApp(repositoryAppName)
        )
        await api.uploadSource(
            repositoryAppName,
            await oneClickRepositorySourceArchive(repositoryData),
            false
        )
        await waitForDeployment(context, repositoryAppName, repositoryVersion)
        await waitForServiceStable(context, repositoryAppName)
        await eventually(
            async () => {
                const response = await context.http.get(
                    `${repositoryBaseUrl}/v4/list`
                )
                expect(response.status).toBe(200)
                expect(JSON.parse(response.body)).toEqual(repositoryData.list)
            },
            {
                description:
                    'test-owned one-click repository to become reachable',
            }
        )

        await api.addCustomOneClickRepo(`${repositoryBaseUrl}/`)
        await eventually(
            async () => {
                const repositories = await api.getAllOneClickAppRepos()
                expect(
                    repositories.urls.filter((url) => url === repositoryBaseUrl)
                ).toHaveLength(1)
                expect(repositories.urls).not.toContain(`${repositoryBaseUrl}/`)
            },
            {
                description:
                    'custom one-click repository to persist canonically',
            }
        )

        const listed = await api.getAllOneClickApps()
        const identifier = listed.oneClickApps.find(
            (item) =>
                item.baseUrl === repositoryBaseUrl && item.name === templateName
        )
        expect(identifier).toMatchObject({
            baseUrl: repositoryBaseUrl,
            name: templateName,
            displayName: 'CapRover E2E repository fixture',
            description: 'A deterministic one-click repository fixture',
            isOfficial: false,
            logoUrl: `${repositoryBaseUrl}/v4/logos/fixture.svg`,
        })

        const fetched = await api.getOneClickAppByName(
            templateName,
            repositoryBaseUrl
        )
        const fetchedTemplate =
            fetched.appTemplate as unknown as CapRoverModels.IOneClickTemplate
        expect(fetchedTemplate).toEqual(repositoryData.templates[templateName])
        await expect(
            api.addCustomOneClickRepo(repositoryBaseUrl)
        ).rejects.toMatchObject({ captainStatus: 1110 })

        cleanUpApp(context, cleanup, deployedAppName)
        const deploymentTemplate = augmentBuiltInVariables(fetchedTemplate)
        const job = await api.startOneClickAppDeploy(
            deploymentTemplate,
            [
                { key: '$$cap_appname', value: deployedAppName },
                { key: '$$cap_root_domain', value: rootDomain },
                { key: '$$cap_marker', value: marker },
            ],
            templateName
        )
        drainJob(api, cleanup, job.jobId)
        const deployed = await waitForOneClickDeployment(() =>
            api.getOneClickAppDeployProgress(job.jobId)
        )
        expect(deployed.outcome).toBe('success')
        expect(deployed.state.successMessage).toContain(marker)

        expect((await api.getApp(deployedAppName)).envVars).toEqual(
            expect.arrayContaining([{ key: 'E2E_MARKER', value: marker }])
        )
        await eventually(
            async () => {
                expect(
                    context.docker.imageMatches(
                        await context.docker.getServiceImage(deployedAppName),
                        NGINX_IMAGE
                    )
                ).toBe(true)
                expect(
                    await context.docker.getRunningReplicas(deployedAppName)
                ).toBe(1)
                expect(
                    await context.docker.getServiceEnvironment(deployedAppName)
                ).toEqual(expect.arrayContaining([`E2E_MARKER=${marker}`]))
            },
            {
                description:
                    'deployed custom one-click application Docker state',
            }
        )
        await context.http.waitUntilReachable(
            `http://${deployedAppName}.${rootDomain}`,
            marker,
            60_000
        )

        await api.deleteCustomOneClickRepo(repositoryBaseUrl)
        expect((await api.getAllOneClickAppRepos()).urls).not.toContain(
            repositoryBaseUrl
        )
        await expect(
            api.deleteCustomOneClickRepo(repositoryBaseUrl)
        ).rejects.toMatchObject({ captainStatus: 1110 })
        await expect(
            api.getOneClickAppByName(templateName, repositoryBaseUrl)
        ).rejects.toMatchObject({ captainStatus: 1110 })
    })
})

function fixtureData(templateName: string): OneClickRepositoryFixtureData {
    const template: CapRoverModels.IOneClickTemplate = {
        captainVersion: 4,
        services: {
            $$cap_appname: {
                image: NGINX_IMAGE,
                environment: { E2E_MARKER: '$$cap_marker' },
                command: [
                    '/bin/sh',
                    '-c',
                    "printf '%s' '$$cap_marker' > /usr/share/nginx/html/index.html && exec nginx -g 'daemon off;'",
                ],
            },
        },
        caproverOneClickApp: {
            variables: [{ id: '$$cap_marker', label: 'Fixture marker' }],
            instructions: {
                start: 'Deploying a custom repository fixture',
                end: 'Custom repository fixture complete: $$cap_marker',
            },
            displayName: 'CapRover E2E repository fixture',
        },
    }
    return {
        list: {
            oneClickApps: [
                {
                    name: templateName,
                    displayName: 'CapRover E2E repository fixture',
                    description: 'A deterministic one-click repository fixture',
                    logoUrl: 'fixture.svg',
                    isOfficial: false,
                },
            ],
        },
        templates: { [templateName]: template },
    }
}

function augmentBuiltInVariables(
    template: CapRoverModels.IOneClickTemplate
): CapRoverModels.IOneClickTemplate {
    const cloned = JSON.parse(
        JSON.stringify(template)
    ) as CapRoverModels.IOneClickTemplate
    cloned.caproverOneClickApp.variables.unshift({
        id: '$$cap_appname',
        label: 'App Name',
    })
    cloned.caproverOneClickApp.variables.push({
        id: '$$cap_root_domain',
        label: 'CapRover root domain',
    })
    return cloned
}

function cleanUpRepository(
    api: import('../src/clients/caprover').CapRoverClient,
    cleanup: CleanupRegistry,
    repositoryUrl: string
): void {
    cleanup.add(async () => {
        if ((await api.getAllOneClickAppRepos()).urls.includes(repositoryUrl))
            await api.deleteCustomOneClickRepo(repositoryUrl)
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
