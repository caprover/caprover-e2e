import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

if (!process.env.CI && existsSync('.env')) {
    process.loadEnvFile('.env')
}

export default defineConfig({
    test: {
        fileParallelism: false,
        hookTimeout: 120_000,
        testTimeout: 240_000,
    },
})
