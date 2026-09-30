import {expect, test, type Page} from '@playwright/test'

async function mockCloudApi(page: Page) {
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/clouds') {
            await route.fulfill({json: [
                {id: 'aws', displayName: 'AWS', availability: 'available'},
                {id: 'azure', displayName: 'Azure', availability: 'available'},
            ]})
        } else if (path.endsWith('/services')) {
            await route.fulfill({json: []})
        } else if (path.endsWith('/status')) {
            await route.fulfill({json: {
                cloud: path.includes('/azure/') ? 'azure' : 'aws', runtime: 'reachable', adapterRegistered: true,
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
        await page.goto('/console/aws/settings')

        for (const name of ['Switch cloud, currently AWS', /Switch AWS account/]) {
            const trigger = page.getByRole('button', {name})
            await trigger.click()
            const menu = page.getByRole('listbox')
            await expect(menu).toBeVisible()
            const fits = await menu.evaluate((element) => {
                const bounds = element.getBoundingClientRect()
                const row = element.closest('.settings-row')?.getBoundingClientRect()
                return row !== undefined && bounds.left >= row.left - 1
                    && bounds.right <= row.right + 1 && bounds.right <= window.innerWidth
            })
            expect(fits, `${width}px ${String(name)} menu overflows its Settings row`).toBe(true)
            if (typeof name !== 'string') {
                const accountIdFits = await menu.locator('.account-option-id').first().evaluate((element) => {
                    const bounds = element.getBoundingClientRect()
                    return bounds.height <= 20 && element.scrollWidth <= element.clientWidth + 1
                })
                expect(accountIdFits, `${width}px account ID wraps or clips`).toBe(true)
                await expect(menu.locator('.account-tag').first()).toBeVisible()
            }
            await trigger.click()
        }
    }
})

test('cloud switching from Explorer Settings keeps the storage landing', async ({page}) => {
    await mockCloudApi(page)
    await page.goto('/cloud-explorer/aws/storage')
    await page.getByRole('link', {name: 'Settings'}).click()
    await expect(page).toHaveURL(/\/console\/aws\/settings$/)

    await page.getByRole('textbox', {name: 'Search services, features, docs, and more'}).fill('storage')
    await expect(page).toHaveURL(/\/console\/aws\/settings\?search=storage$/)
    await page.reload()

    await page.getByRole('button', {name: 'Switch cloud, currently AWS'}).click()
    await page.getByRole('option', {name: 'Azure'}).click()
    await expect(page).toHaveURL(/\/cloud-explorer\/azure\/storage$/)
})

test('cloud switching from direct Settings keeps the console landing', async ({page}) => {
    await mockCloudApi(page)
    await page.goto('/console/aws/settings')

    await page.getByRole('button', {name: 'Switch cloud, currently AWS'}).click()
    await page.getByRole('option', {name: 'Azure'}).click()
    await expect(page).toHaveURL(/\/console\/azure$/)
})
