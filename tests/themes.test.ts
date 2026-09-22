import { expect, test } from 'vitest'
import { Theme } from '../src/clients/caprover'
import { loadConfig } from '../src/config'
import { CleanupRegistry } from '../src/helpers/cleanup'
import { createTestNames } from '../src/helpers/names'
import { eventually } from '../src/helpers/retry'
import { withTestContext } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

test('custom themes round-trip, are publicly available, and preserve built-in protections', async () => {
    requireEphemeral()
    await withTestContext(async (context, cleanup) => {
        const api = context.caprover
        const { runId } = createTestNames()
        const originalName = `e2e-theme-${runId}-original`
        const renamedName = `e2e-theme-${runId}-renamed`
        const originalCurrentName = (await api.getCurrentTheme()).theme?.name
        const builtIn = (await api.getAllThemes()).themes?.find(
            (theme) => theme.builtIn === true
        )

        expect(builtIn, 'at least one built-in theme exists').toBeDefined()
        if (!builtIn) throw new Error('No built-in theme was returned')

        restoreCurrentTheme(api, cleanup, originalCurrentName)
        cleanUpThemes(api, cleanup, [originalName, renamedName])

        const initialTheme = themeFor(originalName, runId, 'initial')
        await api.saveTheme('', initialTheme)
        await expectTheme(api, initialTheme)
        expect((await api.getCurrentTheme()).theme).toMatchObject(initialTheme)
        await expectPublicTheme(context.http, initialTheme)

        const updatedTheme = themeFor(renamedName, runId, 'updated')
        await api.saveTheme(originalName, updatedTheme)
        expect(
            (await api.getAllThemes()).themes?.some(
                (theme) => theme.name === originalName
            )
        ).toBe(false)
        await expectTheme(api, updatedTheme)
        expect((await api.getCurrentTheme()).theme).toMatchObject(updatedTheme)

        await api.setCurrentTheme(builtIn.name)
        expect((await api.getCurrentTheme()).theme).toMatchObject(builtIn)

        await api.setCurrentTheme(renamedName)
        await api.deleteTheme(renamedName)
        expect(
            (await api.getAllThemes()).themes?.some(
                (theme) => theme.name === renamedName
            )
        ).toBe(false)
        expect((await api.getCurrentTheme()).theme).toBeUndefined()
        await expectPublicTheme(context.http, undefined)

        await expect(
            api.saveTheme(builtIn.name, {
                ...builtIn,
                content: `${builtIn.content}\n/* e2e-${runId} */`,
            })
        ).rejects.toMatchObject({ captainStatus: 1110 })
        await expectTheme(api, builtIn)

        await expect(api.deleteTheme(builtIn.name)).rejects.toMatchObject({
            captainStatus: 1110,
        })
        await expectTheme(api, builtIn)

        await expect(
            api.setCurrentTheme(`e2e-theme-${runId}-missing`)
        ).rejects.toMatchObject({
            captainStatus: 1110,
        })
    })
})

function themeFor(name: string, runId: string, version: string): Theme {
    const marker = `e2e-theme-${runId}-${version}`
    return {
        name,
        content: JSON.stringify({ marker, color: version }),
        extra: JSON.stringify({ siderTheme: marker }),
        headEmbed: `<meta name="caprover-e2e-theme" content="${marker}">`,
    }
}

function restoreCurrentTheme(
    api: import('../src/clients/caprover').CapRoverClient,
    cleanup: CleanupRegistry,
    originalCurrentName: string | undefined
): void {
    cleanup.add(() => api.setCurrentTheme(originalCurrentName ?? ''))
}

function cleanUpThemes(
    api: import('../src/clients/caprover').CapRoverClient,
    cleanup: CleanupRegistry,
    names: string[]
): void {
    cleanup.add(async () => {
        const themes = (await api.getAllThemes()).themes ?? []
        for (const name of names) {
            const theme = themes.find((candidate) => candidate.name === name)
            if (theme && !theme.builtIn) await api.deleteTheme(name)
        }
    })
}

async function expectTheme(
    api: import('../src/clients/caprover').CapRoverClient,
    expected: Theme
): Promise<void> {
    await eventually(
        async () => {
            const themes = (await api.getAllThemes()).themes ?? []
            const matches = themes.filter(
                (theme) => theme.name === expected.name
            )
            expect(matches).toHaveLength(1)
            expect(matches[0]).toEqual({
                ...expected,
                builtIn: expected.builtIn ?? false,
            })
        },
        { description: `theme ${expected.name} to round-trip` }
    )
}

async function expectPublicTheme(
    http: import('../src/clients/http').HttpClient,
    expected: Theme | undefined
): Promise<void> {
    const response = await http.get(
        `${loadConfig().caproverUrl}/api/v2/theme/current`
    )
    expect(response.status).toBe(200)
    const envelope = JSON.parse(response.body) as {
        status: number
        data?: { theme?: Theme }
    }
    expect(envelope.status).toBe(100)
    expect(envelope.data?.theme).toEqual(
        expected && { ...expected, builtIn: false }
    )
}
