import { expect, test } from 'vitest'
import { RawApiClient } from '../src/clients/raw-api'
import { loadConfig } from '../src/config'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const names = createTestNames()
const name = names.initialAppName

test('full POST updates and PATCH preservation, clearing, and scale recovery', async () => {
    await withTestContext(async (context, cleanup, rootDomain) => {
        const api = context.caprover
        cleanUpApp(context, cleanup, name)
        await api.createApp(name)
        await api.deployImage(name, 'nginx:1.28.3-alpine')
        const envVars = [
            { key: 'E2E_FIRST', value: names.runId },
            { key: 'E2E_SECOND', value: 'second' },
        ]
        const tags = [{ tagName: 'e2e' }, { tagName: names.runId }]
        await api.updateApp(name, {
            description: `configuration-${names.runId}`,
            envVars,
            tags,
            containerHttpPort: 81,
            websocketSupport: true,
            notExposeAsWebApp: true,
            serviceUpdateOverride: JSON.stringify({
                UpdateConfig: { Parallelism: 1 },
            }),
            appDeployTokenConfig: { enabled: true },
        })
        const configured = await api.getApp(name)
        expect(configured).toMatchObject({
            description: `configuration-${names.runId}`,
            envVars,
            tags,
        })
        await eventually(async () => {
            expect(await context.docker.getServiceEnvironment(name)).toEqual(
                expect.arrayContaining(
                    envVars.map(({ key, value }) => `${key}=${value}`)
                )
            )
        })
        await api.patchApp(name, { instanceCount: 2 })
        const changed = await api.getApp(name)
        for (const field of [
            'envVars',
            'description',
            'tags',
            'containerHttpPort',
            'websocketSupport',
            'notExposeAsWebApp',
            'serviceUpdateOverride',
            'appDeployTokenConfig',
        ] as const) {
            // Compare token configuration without printing the secret token on mismatch.
            expect(
                JSON.stringify(changed[field]) ===
                    JSON.stringify(configured[field]),
                `${field} preserved`
            ).toBe(true)
        }
        for (const count of [2, 0, 1]) {
            if (count !== 2) await api.patchApp(name, { instanceCount: count })
            await eventually(
                async () => {
                    expect((await api.getApp(name)).instanceCount).toBe(count)
                    expect(await context.docker.getDesiredReplicas(name)).toBe(
                        count
                    )
                    expect(await context.docker.getRunningReplicas(name)).toBe(
                        count
                    )
                },
                { timeoutMs: 45_000, description: `scale to ${count}` }
            )
        }
        await api.patchApp(name, { envVars: [] })
        expect((await api.getApp(name)).envVars).toEqual([])
        await eventually(async () => {
            expect(
                (await context.docker.getServiceEnvironment(name)).some(
                    (entry) => entry.startsWith('E2E_')
                )
            ).toBe(false)
        })
        await api.patchApp(name, {
            containerHttpPort: 80,
            notExposeAsWebApp: false,
            description: 'patched together',
        })
        expect(await api.getApp(name)).toMatchObject({
            containerHttpPort: 80,
            notExposeAsWebApp: false,
            description: 'patched together',
        })
        await context.http.waitUntilReachable(
            `http://${name}.${rootDomain}`,
            'Welcome to nginx!'
        )
        await api.updateApp(name, { envVars })
        await api.updateApp(name, { envVars: [], tags: [] })
        expect(await api.getApp(name)).toMatchObject({ envVars: [], tags: [] })
        await eventually(async () => {
            expect(
                (await context.docker.getServiceEnvironment(name)).some(
                    (entry) => entry.startsWith('E2E_')
                )
            ).toBe(false)
        })
        await expect(
            api.patchApp(names.renamedAppName, { instanceCount: 1 })
        ).rejects.toMatchObject({ captainStatus: expect.any(Number) })
        const config = loadConfig()
        const raw = new RawApiClient(config.caproverUrl)
        await raw.login(config.caproverPassword)
        expect(
            (
                await raw.request('PATCH', '/user/apps/appDefinitions/update', {
                    instanceCount: 1,
                })
            ).status
        ).toBe(1110)
    })
})

test('app name, rename, and missing-app validation', async () => {
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        for (const app of [name, names.renamedAppName]) {
            cleanUpApp(context, cleanup, app)
            await api.createApp(app)
        }
        await expect(api.createApp(name)).rejects.toMatchObject({
            captainStatus: 1103,
        })
        for (const invalid of [
            `E${names.runId}`,
            `captain-${names.runId}`,
            `e2e--${names.runId}`,
        ]) {
            // If validation regresses, retain ownership-based cleanup for the unexpected app.
            cleanup.add(async () => {
                if (await api.appExists(invalid)) await api.deleteApp(invalid)
            })
            await expect(api.createApp(invalid)).rejects.toMatchObject({
                captainStatus: 1104,
            })
        }
        await expect(
            api.renameApp(name, names.renamedAppName)
        ).rejects.toMatchObject({ captainStatus: expect.any(Number) })
        const missing = `missing-${names.runId}`
        await expect(api.renameApp(missing, name)).rejects.toMatchObject({
            captainStatus: expect.any(Number),
        })
        await expect(api.deleteApp(missing)).rejects.toMatchObject({
            captainStatus: expect.any(Number),
        })
    })
})
