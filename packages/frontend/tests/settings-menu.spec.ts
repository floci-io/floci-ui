import {expect, test} from '@playwright/test'

test('Settings switcher menus fit within narrow screens', async ({page}) => {
    await page.addInitScript(() => localStorage.removeItem('floci-sidebar'))
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/clouds') {
            await route.fulfill({json: [{id: 'aws', displayName: 'AWS', availability: 'available'}]})
        } else if (path.endsWith('/services')) {
            await route.fulfill({json: []})
        } else if (path.endsWith('/status')) {
            await route.fulfill({json: {cloud: 'aws', runtime: 'reachable', adapterRegistered: true}})
        } else {
            await route.fulfill({json: []})
        }
    })

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
            await trigger.click()
        }
    }
})
