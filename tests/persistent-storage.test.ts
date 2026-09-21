import { expect, test } from 'vitest'
import { waitForImage, waitForServiceStable } from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import {
    cleanUpApp,
    cleanUpVolume,
    withTestContext,
} from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const FIRST_IMAGE =
    'nginx:1.28.3-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236'
const SECOND_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'
const CONTAINER_PATH = '/e2e-data'

test('persistent volume data survives app replacement and owned deletion is safe', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup, rootDomain) => {
        const { runId } = createTestNames()
        const firstApp = `e2e-${runId}-storage-a`
        const secondApp = `e2e-${runId}-storage-b`
        const nonPersistentApp = `e2e-${runId}-storage-np`
        const sharedApp = `e2e-${runId}-storage-shared`
        const volumeName = `e2e-${runId}-volume`
        const marker = `persistent-marker-${runId}`
        const volume = { containerPath: CONTAINER_PATH, volumeName }

        // Register exact-name cleanup before CapRover can create the volume.
        cleanUpVolume(context, cleanup, volumeName)
        cleanUpApp(context, cleanup, firstApp)
        await context.caprover.createPersistentApp(firstApp)
        await waitForServiceStable(context, firstApp)
        await context.caprover.updateApp(firstApp, { volumes: [volume] })
        await eventually(async () => {
            expect((await context.caprover.getApp(firstApp)).volumes).toEqual([
                volume,
            ])
            expect(
                await context.docker.getServiceVolumeSources(firstApp)
            ).toEqual([volumeName])
        })
        await waitForServiceStable(context, firstApp)
        expect(await context.docker.volumeExists(volumeName)).toBe(true)
        await context.docker.writeVolumeMarker(volumeName, marker)

        await context.caprover.updateApp(firstApp, { volumes: [] })
        await eventually(async () => {
            expect((await context.caprover.getApp(firstApp)).volumes).toEqual(
                []
            )
            expect(
                await context.docker.getServiceVolumeSources(firstApp)
            ).toEqual([])
        })
        await waitForServiceStable(context, firstApp)
        expect(await context.docker.volumeExists(volumeName)).toBe(true)

        await context.caprover.updateApp(firstApp, { volumes: [volume] })
        await eventually(async () => {
            expect(
                await context.docker.getServiceVolumeSources(firstApp)
            ).toEqual([volumeName])
        })
        await waitForServiceStable(context, firstApp)
        await context.caprover.deployImage(firstApp, FIRST_IMAGE)
        await waitForImage(context, firstApp, FIRST_IMAGE)
        const firstTaskIds = await context.docker.getRunningTaskIds(firstApp)
        expect(firstTaskIds).toHaveLength(1)
        await context.caprover.deployImage(firstApp, SECOND_IMAGE)
        await waitForImage(context, firstApp, SECOND_IMAGE)
        const secondTaskIds = await context.docker.getRunningTaskIds(firstApp)
        expect(secondTaskIds).toHaveLength(1)
        expect(secondTaskIds[0]).not.toBe(firstTaskIds[0])
        expect(await context.docker.readVolumeMarker(volumeName)).toBe(marker)
        await context.http.waitUntilReachable(
            `http://${firstApp}.${rootDomain}`,
            'Welcome to nginx!'
        )

        await context.caprover.deleteApp(firstApp)
        await eventually(async () => {
            expect(await context.caprover.appExists(firstApp)).toBe(false)
            expect(await context.docker.serviceExists(firstApp)).toBe(false)
        })
        expect(await context.docker.volumeExists(volumeName)).toBe(true)

        cleanUpApp(context, cleanup, secondApp)
        await context.caprover.createPersistentApp(secondApp)
        await context.caprover.updateApp(secondApp, { volumes: [volume] })
        await eventually(async () => {
            expect(
                await context.docker.getServiceVolumeSources(secondApp)
            ).toEqual([volumeName])
            expect(await context.docker.getRunningReplicas(secondApp)).toBe(1)
        })
        expect(await context.docker.readVolumeMarker(volumeName)).toBe(marker)

        await context.caprover.deleteApp(secondApp, [volumeName])
        await eventually(
            async () => {
                expect(await context.docker.serviceExists(secondApp)).toBe(
                    false
                )
                expect(await context.docker.volumeExists(volumeName)).toBe(
                    false
                )
            },
            {
                timeoutMs: 30_000,
                description: `owned volume ${volumeName} removal`,
            }
        )

        cleanUpApp(context, cleanup, firstApp)
        await context.caprover.createPersistentApp(firstApp)
        await context.caprover.updateApp(firstApp, { volumes: [volume] })
        await eventually(async () => {
            expect(
                await context.docker.getServiceVolumeSources(firstApp)
            ).toEqual([volumeName])
            expect(await context.docker.getRunningReplicas(firstApp)).toBe(1)
        })

        cleanUpApp(context, cleanup, sharedApp)
        await context.caprover.createPersistentApp(sharedApp)
        await context.caprover.updateApp(sharedApp, { volumes: [volume] })
        await eventually(async () => {
            expect(
                await context.docker.getServiceVolumeSources(sharedApp)
            ).toEqual([volumeName])
            expect(await context.docker.getRunningReplicas(sharedApp)).toBe(1)
        })
        const partialDelete = await context.caprover.deleteApp(firstApp, [
            volumeName,
        ])
        expect(partialDelete.volumesFailedToDelete).toEqual([volumeName])
        expect(await context.docker.volumeExists(volumeName)).toBe(true)

        await context.caprover.deleteApp(sharedApp, [volumeName])
        await eventually(
            async () => {
                expect(await context.docker.serviceExists(sharedApp)).toBe(
                    false
                )
                expect(await context.docker.volumeExists(volumeName)).toBe(
                    false
                )
            },
            {
                timeoutMs: 30_000,
                description: `owned volume ${volumeName} removal`,
            }
        )

        cleanUpApp(context, cleanup, nonPersistentApp)
        await context.caprover.createApp(nonPersistentApp)
        await expect(
            context.caprover.updateApp(nonPersistentApp, { volumes: [volume] })
        ).rejects.toMatchObject({ captainStatus: 1108 })

        cleanUpApp(context, cleanup, firstApp)
        await context.caprover.createPersistentApp(firstApp)
        for (const invalid of [
            { volumeName, containerPath: '' },
            {
                volumeName,
                hostPath: '/tmp/e2e-invalid',
                containerPath: CONTAINER_PATH,
            },
            { volumeName: '-invalid', containerPath: CONTAINER_PATH },
        ]) {
            await expect(
                context.caprover.updateApp(firstApp, { volumes: [invalid] })
            ).rejects.toMatchObject({ captainStatus: 1000 })
            expect((await context.caprover.getApp(firstApp)).volumes).toEqual(
                []
            )
        }
    })
})
