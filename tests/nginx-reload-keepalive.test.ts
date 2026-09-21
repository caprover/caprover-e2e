import { expect, test } from 'vitest'
import { createTestNames } from '../src/helpers/names'
import { waitForServiceStable } from '../src/helpers/deployment'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const RELOAD_ITERATIONS = 30
const names = createTestNames()
const name = names.initialAppName

test('API keep-alive connection survives delayed reuse after NGINX reloads', async () => {
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover

        cleanUpApp(context, cleanup, name)
        await api.createApp(name)

        expect(await api.appExists(name)).toBe(true)
        await waitForServiceStable(context, name)

        // Let the create-app reload settle, then establish a reusable API
        // connection before deliberately racing subsequent reloads.
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        await api.getApp(name)

        for (let iteration = 0; iteration < RELOAD_ITERATIONS; iteration++) {
            const websocketSupport = iteration % 2 === 0

            console.log(
                `NGINX reload keep-alive reproduction: ${iteration + 1}/${RELOAD_ITERATIONS}`
            )

            // updateApp() regenerates/reloads NGINX. Reuse the pooled socket at
            // the former one-second shutdown boundary, without a retry.
            await api.updateApp(name, { websocketSupport })
            await new Promise((resolve) => setTimeout(resolve, 1_000))
            const app = await api.getApp(name)

            expect(app.websocketSupport).toBe(websocketSupport)
        }
    })
})
