import { expect, test } from 'vitest'
import { prioritizeSystemDefaults } from '../../src/test-sequencer'
import {
    coreFiles,
    destructiveFiles,
    multiNodeFiles,
    proAnd2faFiles,
    requireEphemeral,
    selectTests,
    smokeFiles,
    sslAndRegistryFiles,
    upgradeFiles,
} from '../../src/test-selection'

test('default invocation excludes destructive and specialized files on persistent servers', () => {
    expect(selectTests('test', {})).toEqual([
        'tests/unit/**/*.test.ts',
        ...smokeFiles,
        ...coreFiles,
    ])
})

test('ephemeral default adds only ordinary destructive files', () => {
    expect(
        selectTests('all', { CAPROVER_E2E_ENVIRONMENT: 'ephemeral' })
    ).toEqual([
        'tests/unit/**/*.test.ts',
        ...smokeFiles,
        ...coreFiles,
        ...destructiveFiles,
    ])
    expect(
        [...smokeFiles, ...coreFiles, ...destructiveFiles].some((file) =>
            file.includes('specialized')
        )
    ).toBe(false)
    const files = [...smokeFiles, ...coreFiles, ...destructiveFiles]
    expect(new Set(files).size).toBe(files.length)
    expect(destructiveFiles).toContain('tests/git-webhooks.test.ts')
    expect(
        selectTests('ssl-and-registry', {
            CAPROVER_E2E_ENVIRONMENT: 'ephemeral',
        })
    ).toEqual(sslAndRegistryFiles)
    expect(
        selectTests('multi-node', {
            CAPROVER_E2E_ENVIRONMENT: 'ephemeral',
        })
    ).toEqual(multiNodeFiles)
    expect(
        selectTests('pro-and-2fa', {
            CAPROVER_E2E_ENVIRONMENT: 'ephemeral',
        })
    ).toEqual(proAnd2faFiles)
    expect(
        selectTests('upgrade', {
            CAPROVER_E2E_ENVIRONMENT: 'ephemeral',
        })
    ).toEqual(upgradeFiles)
})

test('fresh-system defaults are sequenced before other test files', () => {
    const files = [
        { moduleId: '/repo/tests/themes.test.ts' },
        { moduleId: '/repo/tests/system-defaults.test.ts' },
        { moduleId: '/repo/tests/backup.test.ts' },
    ]

    expect(
        prioritizeSystemDefaults(files).map((spec) => spec.moduleId)
    ).toEqual([
        '/repo/tests/system-defaults.test.ts',
        '/repo/tests/themes.test.ts',
        '/repo/tests/backup.test.ts',
    ])
})

test.each([undefined, '', 'persistent', 'true', 'Ephemeral'])(
    'rejects destructive selection and direct guard with %s',
    (value) => {
        const environment = { CAPROVER_E2E_ENVIRONMENT: value }
        expect(() => selectTests('destructive', environment)).toThrow(
            'require CAPROVER_E2E_ENVIRONMENT=ephemeral'
        )
        expect(() => selectTests('ssl-and-registry', environment)).toThrow(
            'require CAPROVER_E2E_ENVIRONMENT=ephemeral'
        )
        expect(() => selectTests('multi-node', environment)).toThrow(
            'require CAPROVER_E2E_ENVIRONMENT=ephemeral'
        )
        expect(() => selectTests('pro-and-2fa', environment)).toThrow(
            'require CAPROVER_E2E_ENVIRONMENT=ephemeral'
        )
        expect(() => selectTests('upgrade', environment)).toThrow(
            'require CAPROVER_E2E_ENVIRONMENT=ephemeral'
        )
        expect(() => requireEphemeral(environment)).toThrow()
    }
)
