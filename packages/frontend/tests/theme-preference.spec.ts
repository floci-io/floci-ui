import {expect, test} from '@playwright/test'

for (const colorScheme of ['light', 'dark'] as const) {
    test(`restores System theme before hydration in ${colorScheme} mode`, async ({page}) => {
        await page.emulateMedia({colorScheme})
        await page.addInitScript(() => {
            if (!localStorage.getItem('floci-theme')) localStorage.setItem('floci-theme', 'system')
        })

        const entry = '**/src/main.tsx*'
        await page.route(entry, (route) => route.abort())
        await page.goto('/console/aws/settings', {waitUntil: 'domcontentloaded'})
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)

        await page.unroute(entry)
        await page.reload({waitUntil: 'domcontentloaded'})
        await expect(page.getByRole('radio', {name: 'System'})).toHaveAttribute('aria-checked', 'true')
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)

        const headerToggle = page.getByRole('button', {name: 'Dark theme'})
        await expect(headerToggle).toHaveAttribute('aria-pressed', String(colorScheme === 'dark'))
        const logo = page.locator('.brand-logo')
        const initialLogo = await logo.getAttribute('src') ?? ''
        expect(initialLogo).not.toBe('')

        const opposite = colorScheme === 'dark' ? 'light' : 'dark'
        await page.emulateMedia({colorScheme: opposite})
        await expect(page.locator('html')).toHaveAttribute('data-theme', opposite)
        await expect(headerToggle).toHaveAttribute('aria-pressed', String(opposite === 'dark'))
        await expect(logo).not.toHaveAttribute('src', initialLogo)
        await expect(page.getByRole('radio', {name: 'System'})).toHaveAttribute('aria-checked', 'true')

        await headerToggle.click()
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)
        await expect(logo).toHaveAttribute('src', initialLogo)
        await expect(page.getByRole('radio', {name: colorScheme === 'dark' ? 'Dark' : 'Light', exact: true})).toHaveAttribute('aria-checked', 'true')
        await expect.poll(() => page.evaluate(() => localStorage.getItem('floci-theme'))).toBe(colorScheme)

        await page.reload({waitUntil: 'domcontentloaded'})
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)
        await expect(headerToggle).toHaveAttribute('aria-pressed', String(colorScheme === 'dark'))
        await expect(page.getByRole('radio', {name: colorScheme === 'dark' ? 'Dark' : 'Light', exact: true})).toHaveAttribute('aria-checked', 'true')
    })
}
