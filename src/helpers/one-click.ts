import { OneClickDeploymentState } from '../clients/caprover'
import { withTimeout } from './retry'

export interface OneClickProgressSnapshot {
    currentStep: number
    steps: string[]
    error?: string
    successMessage?: string
}

export interface OneClickDeploymentResult {
    outcome: 'success' | 'error'
    state: OneClickDeploymentState
    history: OneClickProgressSnapshot[]
}

interface OneClickPollOptions {
    timeoutMs?: number
    intervalMs?: number
}

export async function waitForOneClickDeployment(
    getProgress: () => Promise<OneClickDeploymentState>,
    options: OneClickPollOptions = {}
): Promise<OneClickDeploymentResult> {
    const timeoutMs = options.timeoutMs ?? 120_000
    const intervalMs = options.intervalMs ?? 500
    const deadline = Date.now() + timeoutMs
    const history: OneClickProgressSnapshot[] = []
    let previousStep = -1

    while (true) {
        const remainingBeforeRequest = deadline - Date.now()
        if (remainingBeforeRequest <= 0) throw timeoutError(timeoutMs, history)

        const state = await withTimeout(
            getProgress(),
            remainingBeforeRequest,
            'One-click deployment progress request'
        )
        validateProgress(state, previousStep)
        previousStep = state.currentStep
        history.push({
            currentStep: state.currentStep,
            steps: [...state.steps],
            ...(state.error ? { error: state.error } : {}),
            ...(state.successMessage !== undefined
                ? { successMessage: state.successMessage }
                : {}),
        })

        if (state.error)
            return {
                outcome: 'error',
                state,
                history,
            }

        if (state.currentStep >= state.steps.length)
            return {
                outcome: 'success',
                state,
                history,
            }

        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) throw timeoutError(timeoutMs, history)
        await delay(Math.min(intervalMs, remainingMs))
    }
}

function timeoutError(
    timeoutMs: number,
    history: OneClickProgressSnapshot[]
): Error {
    return new Error(
        `Timed out after ${timeoutMs}ms waiting for one-click deployment. Last progress: ${JSON.stringify(history.at(-1))}`
    )
}

function validateProgress(
    state: OneClickDeploymentState,
    previousStep: number
): void {
    if (!Array.isArray(state.steps) || state.steps.length === 0) {
        throw new Error('One-click deployment progress had no steps')
    }
    if (!Number.isInteger(state.currentStep) || state.currentStep < 0) {
        throw new Error(
            `One-click deployment progress had invalid currentStep: ${state.currentStep}`
        )
    }
    if (state.currentStep > state.steps.length) {
        throw new Error(
            `One-click deployment progress exceeded its step count: ${state.currentStep}/${state.steps.length}`
        )
    }
    if (state.currentStep < previousStep) {
        throw new Error(
            `One-click deployment progress regressed from ${previousStep} to ${state.currentStep}`
        )
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
