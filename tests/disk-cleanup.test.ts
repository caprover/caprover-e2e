import { expect, test } from 'vitest'
import { DiskCleanupSettings } from '../src/clients/caprover'
import { TestContext } from '../src/context'
import { createTestNames } from '../src/helpers/names'
import { waitForServiceStable } from '../src/helpers/deployment'
import { eventually } from '../src/helpers/retry'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

const DEPLOYED_IMAGE = 'nginx:1.28.3-alpine'

test('disk-cleanup settings normalize input and preserve the original settings', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const original = await api.getDiskCleanupSettings()

        cleanup.add(async () => {
            await api.setDiskCleanupSettings(original)
            await expectDiskCleanupSettings(api, original)
        })

        const normalized: DiskCleanupSettings = {
            mostRecentLimit: 2,
            cronSchedule: '0 3 * * *',
            timezone: 'UTC',
        }
        await api.setDiskCleanupSettings({
            mostRecentLimit: normalized.mostRecentLimit,
            cronSchedule: `  ${normalized.cronSchedule}  `,
            timezone: `  ${normalized.timezone}  `,
        })
        await expectDiskCleanupSettings(api, normalized)

        await expect(
            api.setDiskCleanupSettings({
                mostRecentLimit: 2,
                cronSchedule: 'not-a-valid-cron',
                timezone: 'UTC',
            })
        ).rejects.toMatchObject({
            captainStatus: 1110,
            captainMessage: expect.stringContaining('Invalid cron schedule'),
        })
        await expectDiskCleanupSettings(api, normalized)

        const negativeNormalized: DiskCleanupSettings = {
            mostRecentLimit: 1,
            cronSchedule: '0 4 * * *',
            timezone: 'UTC',
        }
        await api.setDiskCleanupSettings({
            ...negativeNormalized,
            mostRecentLimit: -1,
        })
        await expectDiskCleanupSettings(api, negativeNormalized)

        await expect(api.getUnusedImages(-1)).rejects.toMatchObject({
            captainStatus: 1110,
            captainMessage: expect.stringContaining(
                'Most Recent Limit cannot be negative'
            ),
        })
    })
})

test('disk cleanup identifies and deletes only an owned unused image', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const { runId } = createTestNames()
        const compactId = runId.replaceAll('-', '')
        const imageTag = `caprover-e2e-unused:${compactId}`
        const appName = `disk-${compactId}`

        cleanup.add(() => removeOwnedImage(context, imageTag))
        const imageId = await buildOwnedImage(context, imageTag, runId)

        const serviceImages = await getServiceImages(context)
        expect(serviceImages).not.toContain(imageId)
        expect(serviceImages.some((image) => image.startsWith(imageTag))).toBe(
            false
        )

        cleanUpApp(context, cleanup, appName)
        await api.createApp(appName)
        await api.deployImage(appName, DEPLOYED_IMAGE)
        await waitForServiceStable(context, appName)

        const deployedImageId = await inspectImageId(context, DEPLOYED_IMAGE)
        const unusedImages = (await api.getUnusedImages(0)).unusedImages
        expect(unusedImages).toContainEqual({
            id: imageId,
            tags: expect.arrayContaining([imageTag]),
        })
        expect(unusedImages.map((image) => image.id)).not.toContain(
            deployedImageId
        )

        const imageIdsBefore = await listImageIds(context)
        expect(imageIdsBefore).toContain(imageId)

        await api.deleteImages([imageId])
        await eventually(
            async () => {
                expect(await imageExists(context, imageId)).toBe(false)
            },
            { description: `deletion of owned image ${imageId}` }
        )

        const imageIdsAfter = await listImageIds(context)
        expect(imageIdsAfter).toEqual(
            imageIdsBefore.filter((candidate) => candidate !== imageId)
        )
        expect(await imageExists(context, deployedImageId)).toBe(true)
    })
})

async function expectDiskCleanupSettings(
    api: import('../src/clients/caprover').CapRoverClient,
    expected: DiskCleanupSettings
): Promise<void> {
    await eventually(
        async () => {
            expect(await api.getDiskCleanupSettings()).toEqual(expected)
        },
        { description: 'disk-cleanup settings to converge' }
    )
}

async function buildOwnedImage(
    context: TestContext,
    imageTag: string,
    runId: string
): Promise<string> {
    const dockerfile = Buffer.from(
        `FROM scratch\nLABEL com.caprover.e2e.run=${runId}\n`
    ).toString('base64')
    await exec(
        context,
        `printf %s ${shellQuote(dockerfile)} | base64 -d | docker build --tag ${shellQuote(imageTag)} -`,
        30_000
    )
    return inspectImageId(context, imageTag)
}

async function inspectImageId(
    context: TestContext,
    image: string
): Promise<string> {
    const result = await exec(
        context,
        `docker image inspect --format '{{.Id}}' ${shellQuote(image)}`
    )
    const imageId = result.trim()
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
        throw new Error(`Docker returned an invalid image ID: ${imageId}`)
    }
    return imageId
}

async function listImageIds(context: TestContext): Promise<string[]> {
    const result = await exec(context, 'docker image ls --no-trunc --quiet')
    return [...new Set(lines(result))].sort()
}

async function getServiceImages(context: TestContext): Promise<string[]> {
    const serviceIds = lines(await exec(context, 'docker service ls --quiet'))
    for (const serviceId of serviceIds) {
        if (!/^[a-z0-9]{25}$/.test(serviceId)) {
            throw new Error(
                `Docker returned an invalid service ID: ${serviceId}`
            )
        }
    }
    if (serviceIds.length === 0) return []
    return lines(
        await exec(
            context,
            `docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' ${serviceIds.map(shellQuote).join(' ')}`
        )
    )
}

async function imageExists(
    context: TestContext,
    image: string
): Promise<boolean> {
    const result = await context.ssh.exec(
        `docker image inspect ${shellQuote(image)}`
    )
    if (result.exitCode === 0) return true
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
    if (output.includes('no such image')) return false
    throw new Error(`Unable to inspect Docker image ${image}: ${result.stderr}`)
}

async function removeOwnedImage(
    context: TestContext,
    imageTag: string
): Promise<void> {
    const result = await context.ssh.exec(
        `docker image rm --force ${shellQuote(imageTag)}`
    )
    if (result.exitCode === 0) return
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
    if (output.includes('no such image')) return
    throw new Error(
        `Unable to clean up owned image ${imageTag}: ${result.stderr}`
    )
}

async function exec(
    context: TestContext,
    command: string,
    timeoutMs?: number
): Promise<string> {
    const result = await context.ssh.exec(command, timeoutMs)
    if (result.exitCode !== 0) {
        throw new Error(
            `SSH command failed with exit code ${result.exitCode}: ${result.stderr.trim()}`
        )
    }
    return result.stdout
}

function lines(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`
}
