import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        fileParallelism: false,
        hookTimeout: 120_000,
        testTimeout: 240_000,
    },
})
