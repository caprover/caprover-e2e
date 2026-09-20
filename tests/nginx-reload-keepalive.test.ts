import { expect, test } from 'vitest'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const RELOAD_ITERATIONS = 30
const names = createTestNames()
const name = names.initialAppName

test('API keep-alive connection survives repeated NGINX reloads', async () => {
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover

        cleanUpApp(context, cleanup, name)
        await api.createApp(name)

        await eventually(
            async () => {
                expect(await api.appExists(name)).toBe(true)
                expect(await context.docker.serviceExists(name)).toBe(true)
            },
            {
                timeoutMs: 45_000,
                description: 'reload-race fixture app to be ready',
            }
        )

        // Let the create-app reload settle, then establish a reusable API
        // connection before deliberately racing subsequent reloads.
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        await api.getApp(name)

        for (let iteration = 0; iteration < RELOAD_ITERATIONS; iteration++) {
            const websocketSupport = iteration % 2 === 0

            console.log(
                `NGINX reload keep-alive reproduction: ${iteration + 1}/${RELOAD_ITERATIONS}`
            )

            // updateApp() regenerates/reloads NGINX. There is intentionally no
            // retry here; the shared API spacing mitigation may delay getApp().
            await api.updateApp(name, { websocketSupport })
            const app = await api.getApp(name)

            expect(app.websocketSupport).toBe(websocketSupport)
        }
    })
})
