import {expect, test} from '@playwright/test'

for (const colorScheme of ['light', 'dark'] as const) {
    test(`restores System theme before hydration in ${colorScheme} mode`, async ({page}) => {
        await page.emulateMedia({colorScheme})
        await page.addInitScript(() => localStorage.setItem('floci-theme', 'system'))

        const entry = '**/src/main.tsx*'
        await page.route(entry, (route) => route.abort())
        await page.goto('/console/aws/settings', {waitUntil: 'domcontentloaded'})
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)

        await page.unroute(entry)
        await page.reload({waitUntil: 'domcontentloaded'})
        await expect(page.getByRole('radio', {name: 'System'})).toHaveAttribute('aria-checked', 'true')
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)
    })
}
