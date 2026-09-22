import { BaseSequencer } from 'vitest/node'

const SYSTEM_DEFAULTS_SUFFIX = '/tests/system-defaults.test.ts'

export function prioritizeSystemDefaults<T extends readonly [unknown, string]>(
    files: T[]
): T[] {
    const defaults: T[] = []
    const rest: T[] = []

    for (const entry of files) {
        const file = entry[1].replaceAll('\\', '/')
        if (file.endsWith(SYSTEM_DEFAULTS_SUFFIX)) {
            defaults.push(entry)
        } else {
            rest.push(entry)
        }
    }

    return [...defaults, ...rest]
}

export class CapRoverSequencer extends BaseSequencer {
    override async sort(files: Parameters<BaseSequencer['sort']>[0]) {
        const sorted = await super.sort(files)
        return prioritizeSystemDefaults(sorted)
    }
}
