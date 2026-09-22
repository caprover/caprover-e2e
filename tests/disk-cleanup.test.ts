import { expect, test } from 'vitest'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
} from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const DEPLOYED_IMAGE = 'nginx:1.29.8-alpine'

test('disk cleanup validates settings and removes only an owned unused image', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const originalSettings = await api.getDiskCleanupSettings()
        cleanup.add(() => api.setDiskCleanupSettings(originalSettings))

        await api.setDiskCleanupSettings({
            mostRecentLimit: 7,
            cronSchedule: ' 0 3 * * * ',
            timezone: ' UTC ',
        })
        expect(await api.getDiskCleanupSettings()).toEqual({
            mostRecentLimit: 7,
            cronSchedule: '0 3 * * *',
            timezone: 'UTC',
        })

        await api.setDiskCleanupSettings({
            mostRecentLimit: 99,
            cronSchedule: '   ',
            timezone: 'America/Los_Angeles',
        })
        const disabledSettings = {
            mostRecentLimit: 1,
            cronSchedule: '',
            timezone: '',
        }
        expect(await api.getDiskCleanupSettings()).toEqual(disabledSettings)

        await expect(
            api.setDiskCleanupSettings({
                mostRecentLimit: 3,
                cronSchedule: 'not a cron expression',
                timezone: 'UTC',
            })
        ).rejects.toMatchObject({
            captainStatus: 1000,
            captainMessage: expect.stringContaining('Invalid cron schedule'),
        })
        expect(await api.getDiskCleanupSettings()).toEqual(disabledSettings)

        await expect(api.getUnusedImages(-1)).rejects.toMatchObject({
            captainStatus: 1000,
            captainMessage: expect.stringContaining(
                'Most Recent Limit cannot be negative'
            ),
        })

        const { initialAppName: appName, runId } = createTestNames()
        const imageTag = `caprover-e2e-unused:${runId.replaceAll('-', '')}`
        cleanUpApp(context, cleanup, appName)
        cleanup.add(() => removeOwnedImage(context, imageTag))

        await api.createApp(appName)
        const expectedVersion = nextVersion(await api.getApp(appName))
        await api.deployImage(appName, DEPLOYED_IMAGE)
        const deployed = await waitForDeployment(
            context,
            appName,
            expectedVersion
        )
        const deployedImage = deployed.versions.find(
            (version) => version.version === expectedVersion
        )?.deployedImageName
        expect(deployedImage).toBe(DEPLOYED_IMAGE)
        await waitForImage(context, appName, DEPLOYED_IMAGE)

        const dockerfile = [
            `FROM ${DEPLOYED_IMAGE}`,
            `LABEL caprover.e2e.run=${runId}`,
            '',
        ].join('\n')
        const encodedDockerfile = Buffer.from(dockerfile).toString('base64')
        await execOk(
            context,
            `printf '%s' '${encodedDockerfile}' | base64 -d | docker build --tag '${imageTag}' -`,
            60_000
        )

        const ownedImageId = (
            await execOk(
                context,
                `docker image inspect --format '{{.Id}}' '${imageTag}'`
            )
        ).trim()
        expect(ownedImageId).toMatch(/^sha256:[a-f0-9]{64}$/)

        const deployedImageId = (
            await execOk(
                context,
                `docker image inspect --format '{{.Id}}' '${DEPLOYED_IMAGE}'`
            )
        ).trim()
        expect(deployedImageId).not.toBe(ownedImageId)

        const serviceImageReferences = (
            await execOk(
                context,
                "docker service ls -q | xargs -r docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'"
            )
        )
            .split('\n')
            .filter(Boolean)
        expect(
            serviceImageReferences.some((reference) =>
                reference.includes(ownedImageId)
            )
        ).toBe(false)

        const unusedImages = await api.getUnusedImages(0)
        expect(unusedImages).toContainEqual({
            id: ownedImageId,
            tags: expect.arrayContaining([imageTag]),
        })
        expect(unusedImages.map((image) => image.id)).not.toContain(
            deployedImageId
        )

        const beforeDeletion = await listImageIds(context)
        expect(beforeDeletion).toContain(ownedImageId)
        expect(beforeDeletion).toContain(deployedImageId)

        await api.deleteImages([ownedImageId])
        await eventually(
            async () => {
                const afterDeletion = await listImageIds(context)
                expect(afterDeletion).toEqual(
                    beforeDeletion.filter((id) => id !== ownedImageId)
                )
            },
            { description: 'only the owned unused image to be deleted' }
        )
        await execOk(
            context,
            `docker image inspect '${DEPLOYED_IMAGE}' >/dev/null`
        )
    })
})

async function listImageIds(
    context: import('../src/context').TestContext
): Promise<string[]> {
    return (
        await execOk(
            context,
            'docker image ls --no-trunc --quiet | sort --unique'
        )
    )
        .split('\n')
        .filter(Boolean)
}

async function removeOwnedImage(
    context: import('../src/context').TestContext,
    imageTag: string
): Promise<void> {
    await execOk(
        context,
        `if docker image inspect '${imageTag}' >/dev/null 2>&1; then docker image rm --force '${imageTag}' >/dev/null; fi`
    )
}

async function execOk(
    context: import('../src/context').TestContext,
    command: string,
    timeoutMs?: number
): Promise<string> {
    const result = await context.ssh.exec(command, timeoutMs)
    if (result.exitCode !== 0) {
        throw new Error(
            `SSH command failed with exit ${result.exitCode}: ${result.stderr.trim()}`
        )
    }
    return result.stdout
}
