import { expect, test } from 'vitest'
import {
    coreFiles,
    destructiveFiles,
    requireEphemeral,
    selectTests,
    smokeFiles,
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
})

test.each([undefined, '', 'persistent', 'true', 'Ephemeral'])(
    'rejects destructive selection and direct guard with %s',
    (value) => {
        const environment = { CAPROVER_E2E_ENVIRONMENT: value }
        expect(() => selectTests('destructive', environment)).toThrow(
            'require CAPROVER_E2E_ENVIRONMENT=ephemeral'
        )
        expect(() => requireEphemeral(environment)).toThrow()
    }
)
