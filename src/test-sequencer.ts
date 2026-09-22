import { BaseSequencer } from 'vitest/node'

const SYSTEM_DEFAULTS_FILE = 'tests/system-defaults.test.ts'

export function prioritizeSystemDefaults<T extends { moduleId: string }>(
    files: T[]
): T[] {
    const defaults: T[] = []
    const rest: T[] = []

    for (const spec of files) {
        const file = spec.moduleId.replaceAll('\\', '/')
        if (
            file === SYSTEM_DEFAULTS_FILE ||
            file.endsWith(`/${SYSTEM_DEFAULTS_FILE}`)
        ) {
            defaults.push(spec)
        } else {
            rest.push(spec)
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
