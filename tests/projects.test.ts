import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { CapRoverClient } from '../src/clients/caprover'
import { CleanupRegistry, withCleanup } from '../src/helpers/cleanup'
import { createTestNames } from '../src/helpers/names'
import { cleanUpApp, withTestContext } from '../src/helpers/test-context'

const { runId, initialAppName } = createTestNames()

// The API allocates IDs. Reconcile by an exact run-owned name even when creation's response is lost.
async function ownedProject(
    api: CapRoverClient,
    cleanup: CleanupRegistry,
    name: string,
    parentProjectId = ''
) {
    cleanup.add(async () => {
        const { projects } = await api.getProjects()
        for (const project of projects.filter((item) => item.name === name))
            await api.deleteProject(project.id)
    })
    return api.createProject(name, `description-${name}`, parentProjectId)
}

test('project hierarchy, app membership, validation, and deletion', async () => {
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const root = await ownedProject(api, cleanup, `e2e-${runId}-root`)
        const child = await ownedProject(
            api,
            cleanup,
            `e2e-${runId}-child`,
            root.id
        )
        expect(root.id).toMatch(/^[a-f0-9-]{36}$/)
        expect(child.id).not.toBe(root.id)
        expect((await api.getProjects()).projects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: root.id,
                    name: root.name,
                    description: `description-${root.name}`,
                }),
                expect.objectContaining({
                    id: child.id,
                    name: child.name,
                    description: `description-${child.name}`,
                    parentProjectId: root.id,
                }),
            ])
        )
        await api.updateProject({ ...child, description: 'updated child' })
        expect(
            (await api.getProjects()).projects.find(
                (item) => item.id === child.id
            )?.description
        ).toBe('updated child')
        cleanUpApp(context, cleanup, initialAppName)
        await api.createApp(initialAppName, child.id)
        expect((await api.getApp(initialAppName)).projectId).toBe(child.id)
        expect(await context.docker.serviceExists(initialAppName)).toBe(true)
        await expect(api.deleteProject(child.id)).rejects.toMatchObject({
            captainStatus: 1108,
        })
        await expect(api.deleteProject(root.id)).rejects.toMatchObject({
            captainStatus: 1108,
        })
        const unknown = randomUUID()
        await expect(
            api.updateProject({ ...child, parentProjectId: child.id })
        ).rejects.toMatchObject({ captainStatus: 1108 })
        await expect(
            api.updateProject({ ...child, parentProjectId: unknown })
        ).rejects.toMatchObject({ captainStatus: 1108 })
        const invalidApp = `e2e-${runId}-invalid`
        cleanUpApp(context, cleanup, invalidApp)
        await expect(api.createApp(invalidApp, unknown)).rejects.toMatchObject({
            captainStatus: 1108,
        })
        expect(await api.appExists(invalidApp)).toBe(false)
        await expect(
            api.updateApp(initialAppName, { projectId: unknown })
        ).rejects.toMatchObject({ captainStatus: 1108 })
        expect((await api.getApp(initialAppName)).projectId).toBe(child.id)
        await api.updateApp(initialAppName, { projectId: root.id })
        expect((await api.getApp(initialAppName)).projectId).toBe(root.id)
        await api.updateApp(initialAppName, { projectId: '' })
        expect((await api.getApp(initialAppName)).projectId || '').toBe('')
        await api.deleteProject(child.id)
        await api.deleteProject(root.id)
        expect(
            (await api.getProjects()).projects.some((item) =>
                [root.id, child.id].includes(item.id)
            )
        ).toBe(false)
    })
})

test('cleans up an allocated project after a partial operation failure', async () => {
    await withTestContext(async (context) => {
        const name = `e2e-${runId}-partial`
        const failure = new Error('simulated failure after creation')
        await expect(
            withCleanup(async (cleanup) => {
                await ownedProject(context.caprover, cleanup, name)
                throw failure
            })
        ).rejects.toBe(failure)
        expect(
            (await context.caprover.getProjects()).projects.some(
                (project) => project.name === name
            )
        ).toBe(false)
    })
})
