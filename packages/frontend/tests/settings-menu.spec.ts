import {expect, test, type Page} from '@playwright/test'

async function mockCloudApi(page: Page) {
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/clouds') {
            await route.fulfill({json: [
                {id: 'aws', displayName: 'AWS', availability: 'available'},
                {id: 'azure', displayName: 'Azure', availability: 'available'},
                {id: 'oci', displayName: 'OCI', availability: 'available'},
            ]})
        } else if (path.endsWith('/services')) {
            await route.fulfill({json: []})
        } else if (path.endsWith('/status')) {
            await route.fulfill({json: {
                cloud: path.split('/')[3], runtime: 'reachable', adapterRegistered: true,
            }})
        } else {
            await route.fulfill({json: []})
        }
    })
}

test('Settings switcher menus fit within narrow screens', async ({page}) => {
    await page.addInitScript(() => localStorage.removeItem('floci-sidebar'))
    await mockCloudApi(page)

    for (const width of [320, 390]) {
        await page.setViewportSize({width, height: 720})
        await page.goto('/settings')

        for (const name of ['Cloud', 'Account']) {
            const trigger = page.getByRole('combobox', {name})
            await trigger.click()
            const menu = page.getByRole('listbox')
            await expect(menu).toBeVisible()
            const fits = await menu.evaluate((element) => {
                const bounds = element.getBoundingClientRect()
                return bounds.left >= -1 && bounds.right <= window.innerWidth + 1
            })
            expect(fits, `${width}px ${name} menu overflows the screen`).toBe(true)
            await page.keyboard.press('Escape')
            await expect(page.getByRole('listbox')).toHaveCount(0)
        }
    }
})

test('cloud switching from Explorer Settings keeps the storage landing', async ({page}) => {
    await mockCloudApi(page)
    await page.goto('/cloud-explorer/aws/storage')
    await page.getByRole('link', {name: 'Settings'}).click()
    await expect(page).toHaveURL(/\/settings$/)
    // Navigations render as transitions, so the URL changes before the page commits.
    await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible()

    await page.getByRole('searchbox', {name: 'Search services, features, docs, and more'}).fill('storage')
    await expect(page).toHaveURL(/\/settings\?search=storage$/)
    await page.reload()

    await page.getByRole('combobox', {name: 'Cloud'}).click()
    await page.getByRole('option', {name: 'Azure'}).click()
    await expect(page).toHaveURL(/\/cloud-explorer\/azure\/storage$/)
})

test('cloud switching from direct Settings keeps the console landing', async ({page}) => {
    await mockCloudApi(page)
    await page.goto('/settings')

    await page.getByRole('combobox', {name: 'Cloud'}).click()
    await page.getByRole('option', {name: 'Azure'}).click()
    await expect(page).toHaveURL(/\/console\/azure$/)
})

test('OCI Settings keeps one cloud and account control and shares the main theme toggle', async ({page}) => {
    await mockCloudApi(page)
    await page.goto('/console/oci')
    await page.getByRole('link', {name: 'Settings', exact: true}).click()
    await expect(page).toHaveURL(/\/settings$/)

    await expect(page.getByRole('combobox', {name: 'Cloud'})).toHaveCount(1)
    await expect(page.getByRole('combobox', {name: 'Account'})).toHaveCount(1)
    await expect(page.locator('.topbar .cloud-switcher, .topbar .account-switcher')).toHaveCount(0)

    const toggle = page.getByRole('button', {name: /^Theme: /})
    await expect(toggle).toHaveCount(1)
    await page.getByRole('radio', {name: 'Light', exact: true}).click()
    await expect(toggle).toHaveAccessibleName('Theme: Light')
    await toggle.click()
    await expect(page.getByRole('radio', {name: 'System', exact: true})).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(page.getByRole('radio', {name: 'Dark', exact: true})).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('combobox', {name: 'Cloud'}).click()
    await expect(page.getByRole('option', {name: 'OCI'})).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('option', {name: 'AWS'}).click()
    await expect(page).toHaveURL(/\/console\/aws$/)
})
