import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { ProvisioningState } from '../types'

export const STATE_FILE = '.e2e-provisioning-state.json'
const TEMP_STATE_FILE = `${STATE_FILE}.tmp`

export async function saveState(state: ProvisioningState): Promise<void> {
    await writeFile(TEMP_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
        mode: 0o600,
    })
    await rename(TEMP_STATE_FILE, STATE_FILE)
}

export async function loadState(): Promise<ProvisioningState | undefined> {
    try {
        return JSON.parse(
            await readFile(STATE_FILE, 'utf8')
        ) as ProvisioningState
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') return undefined
        throw error
    }
}

export async function removeState(): Promise<void> {
    await Promise.all([
        rm(STATE_FILE, { force: true }),
        rm(TEMP_STATE_FILE, { force: true }),
    ])
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error
}
