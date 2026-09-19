import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import { selectTests } from './src/test-selection'

if (!process.env.CI && existsSync('.env')) {
    process.loadEnvFile('.env')
}

export default defineConfig(({ mode }: { mode: string }) => ({
    test: {
        fileParallelism: false,
        include: selectTests(mode),
        hookTimeout: 120_000,
        testTimeout: 240_000,
    },
}))
