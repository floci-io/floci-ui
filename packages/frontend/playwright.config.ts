import {defineConfig} from '@playwright/test'

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    workers: process.env.CI ? 2 : undefined,
    use: {
        baseURL: 'http://127.0.0.1:4510',
        channel: process.env.PLAYWRIGHT_CHANNEL,
        viewport: {width: 1440, height: 1000},
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'pnpm exec vite --host 127.0.0.1 --port 4510 --strictPort',
        url: 'http://127.0.0.1:4510',
        reuseExistingServer: !process.env.CI,
    },
})
