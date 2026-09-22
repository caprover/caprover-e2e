import { randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import { RawApiClient } from '../src/clients/raw-api'
import { loadConfig } from '../src/config'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
    waitForServiceStable,
} from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const DEPLOY_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'
const UPDATE_OVERRIDE = JSON.stringify({
    UpdateConfig: { Parallelism: 1, Delay: 2_000_000_000 },
})

test('node placement, update override, pre-deploy function, and deploy token', async () => {
    await withTestContext(async (context, cleanup) => {
        const { initialAppName: name, runId } = createTestNames()
        const api = context.caprover
        const marker = `predeploy-${runId}`
        const preDeployFunction = createPreDeployFunction(marker)

        cleanUpApp(context, cleanup, name)
        await api.createApp(name)
        await waitForServiceStable(context, name)

        const managerNodeId = await context.docker.getLocalManagerNodeId()
        await api.updateApp(name, { nodeId: managerNodeId })
        expect((await api.getApp(name)).nodeId).toBe(managerNodeId)
        await eventually(
            async () => {
                expect(
                    await context.docker.getServicePlacementConstraints(name)
                ).toContain(`node.id==${managerNodeId}`)
                expect(
                    await context.docker.getRunningTaskNodeIds(name)
                ).toEqual([managerNodeId])
                await waitForServiceStable(context, name)
            },
            {
                timeoutMs: 45_000,
                description: `${name} placement on the local manager`,
            }
        )

        await api.updateApp(name, {
            serviceUpdateOverride: UPDATE_OVERRIDE,
        })
        expect((await api.getApp(name)).serviceUpdateOverride).toBe(
            UPDATE_OVERRIDE
        )
        await eventually(
            async () => {
                expect(
                    await context.docker.getServiceUpdateConfig(name)
                ).toMatchObject({
                    parallelism: 1,
                    delay: 2_000_000_000,
                })
                await waitForServiceStable(context, name)
            },
            {
                timeoutMs: 45_000,
                description: `${name} service update override`,
            }
        )

        await api.updateApp(name, { preDeployFunction })
        expect((await api.getApp(name)).preDeployFunction).toBe(
            preDeployFunction
        )
        await api.updateApp(name, { description: `predeploy-${runId}` })
        await eventually(
            async () => {
                expect(
                    (await context.docker.getServiceContainerLabels(name))[
                        'com.caprover.e2e.predeploy'
                    ]
                ).toBe(marker)
                await waitForServiceStable(context, name)
            },
            {
                timeoutMs: 45_000,
                description: `${name} pre-deploy function label`,
            }
        )

        await api.updateApp(name, { appDeployTokenConfig: { enabled: true } })
        const deployToken = (await api.getApp(name)).appDeployTokenConfig
            ?.appDeployToken
        expect(
            typeof deployToken === 'string' && deployToken.length > 0,
            'a deploy token was generated'
        ).toBe(true)
        if (!deployToken)
            throw new Error('CapRover did not generate a deploy token')

        const unauthenticatedRaw = new RawApiClient(loadConfig().caproverUrl)
        const beforeDeployment = await api.getApp(name)
        const gitHash = randomBytes(20).toString('hex')
        expect(
            (
                await deployWithToken(
                    unauthenticatedRaw,
                    name,
                    deployToken,
                    gitHash
                )
            ).status
        ).toBe(101)
        await waitForDeployment(
            context,
            name,
            nextVersion(beforeDeployment),
            gitHash
        )
        await waitForImage(context, name, DEPLOY_IMAGE)

        const deployedVersion = (await api.getApp(name)).deployedVersion
        expect(
            (
                await deployWithToken(
                    unauthenticatedRaw,
                    name,
                    `invalid-${runId}`,
                    randomBytes(20).toString('hex')
                )
            ).status
        ).toBe(1102)
        expect((await api.getApp(name)).deployedVersion).toBe(deployedVersion)

        await api.updateApp(name, { appDeployTokenConfig: { enabled: false } })
        const disabledTokenConfig = (await api.getApp(name))
            .appDeployTokenConfig
        expect(disabledTokenConfig?.enabled).toBe(false)
        expect(disabledTokenConfig?.appDeployToken).toBeUndefined()
        expect(
            (
                await deployWithToken(
                    unauthenticatedRaw,
                    name,
                    deployToken,
                    randomBytes(20).toString('hex')
                )
            ).status
        ).toBe(1102)
        expect((await api.getApp(name)).deployedVersion).toBe(deployedVersion)
    })
})

test('bulk application deletion', async () => {
    await withTestContext(async (context, cleanup) => {
        const names = createTestNames()
        const appNames = [names.initialAppName, names.renamedAppName]
        const api = context.caprover

        for (const appName of appNames) cleanUpApp(context, cleanup, appName)
        for (const appName of appNames) {
            await api.createApp(appName)
            await waitForServiceStable(context, appName)
        }

        const config = loadConfig()
        const authenticatedRaw = new RawApiClient(config.caproverUrl)
        await authenticatedRaw.login(config.caproverPassword)
        expect(
            (
                await authenticatedRaw.request(
                    'POST',
                    '/user/apps/appDefinitions/delete',
                    {
                        appName: appNames[0],
                        appNames: [appNames[1]],
                        volumes: [],
                    }
                )
            ).status
        ).toBe(1108)
        for (const appName of appNames) {
            expect(await api.appExists(appName)).toBe(true)
            expect(await context.docker.serviceExists(appName)).toBe(true)
        }

        await api.deleteApps(appNames)
        await eventually(
            async () => {
                for (const appName of appNames) {
                    expect(await api.appExists(appName)).toBe(false)
                    expect(await context.docker.serviceExists(appName)).toBe(
                        false
                    )
                }
            },
            {
                timeoutMs: 45_000,
                description: 'bulk application deletion',
            }
        )
    })
})

function createPreDeployFunction(marker: string): string {
    return [
        'var preDeployFunction = function (captainAppObj, dockerUpdateObject) {',
        '    dockerUpdateObject.TaskTemplate.ContainerSpec.Labels =',
        '        dockerUpdateObject.TaskTemplate.ContainerSpec.Labels || {}',
        `    dockerUpdateObject.TaskTemplate.ContainerSpec.Labels['com.caprover.e2e.predeploy'] = '${marker}'`,
        '    return Promise.resolve(dockerUpdateObject)',
        '}',
    ].join('\n')
}

function deployWithToken(
    raw: RawApiClient,
    appName: string,
    appToken: string,
    gitHash: string
) {
    return raw.request(
        'POST',
        `/user/apps/appData/${appName}?detached=1`,
        {
            captainDefinitionContent: JSON.stringify({
                schemaVersion: 2,
                imageName: DEPLOY_IMAGE,
            }),
            gitHash,
        },
        { 'x-captain-app-token': appToken }
    )
}
