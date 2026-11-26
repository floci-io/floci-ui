import {expect, test, type Page} from '@playwright/test'

async function mockCloudApi(page: Page) {
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/clouds') {
            await route.fulfill({json: [{id: 'aws', displayName: 'AWS', availability: 'available'}]})
        } else if (path.endsWith('/status')) {
            await route.fulfill({json: {cloud: 'aws', runtime: 'reachable', adapterRegistered: true}})
        } else {
            await route.fulfill({json: []})
        }
    })
}

/** The rail hides its section labels; the expanded panel shows them. */
function sectionLabel(page: Page) {
    return page.locator('.sidebar .nav-label', {hasText: 'General'})
}

test.describe('collapsed nav rail on a phone', () => {
    test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true})

    test('one tap navigates and the rail stays collapsed', async ({page}) => {
        await page.addInitScript(() => localStorage.removeItem('floci-sidebar'))
        await mockCloudApi(page)
        await page.goto('/console/aws')
        await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed')
        await expect(sectionLabel(page)).toBeHidden()

        await page.getByRole('link', {name: 'Activity'}).tap()

        await expect(page).toHaveURL(/\/activity$/)
        await expect(page.getByRole('heading', {name: 'Activity', exact: true})).toBeVisible()
        await expect(sectionLabel(page)).toBeHidden()
    })
})

test('keyboard focus in the collapsed rail still expands it', async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('floci-sidebar', 'collapsed'))
    await mockCloudApi(page)
    await page.goto('/console/aws')

    await page.getByRole('link', {name: 'Activity'}).click()
    await expect(page).toHaveURL(/\/activity$/)
    await expect(sectionLabel(page)).toBeHidden()

    await page.keyboard.press('Shift+Tab')
    await expect(sectionLabel(page)).toBeVisible()
})
