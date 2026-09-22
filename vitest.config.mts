import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import { CapRoverSequencer } from './src/test-sequencer'
import { selectTests } from './src/test-selection'

if (!process.env.CI && existsSync('.env')) {
    process.loadEnvFile('.env')
}

export default defineConfig(({ mode }: { mode: string }) => ({
    test: {
        fileParallelism: false,
        maxConcurrency: 1,
        include: selectTests(mode),
        sequence: { sequencer: CapRoverSequencer },
        hookTimeout: 120_000,
        testTimeout: 240_000,
    },
}))
