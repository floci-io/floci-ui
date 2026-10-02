import {expect, test, type Page} from '@playwright/test'

const clouds = ['aws', 'azure', 'gcp', 'oci'] as const

async function mockCloudApi(page: Page) {
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = new URL(route.request().url()).pathname
        const cloud = path.split('/')[3]
        let json: unknown
        if (path === '/api/clouds') {
            json = clouds.map((id) => ({id, displayName: id.toUpperCase(), availability: 'available'}))
        } else if (path.endsWith('/status')) {
            json = {cloud, runtime: 'reachable', adapterRegistered: true, endpoint: 'http://localhost:4566'}
        } else if (path.endsWith('/services')) {
            json = [{cloud, service: 'storage', displayName: 'Storage', route: 'storage', group: 'Storage', availability: 'available', iconKey: 'storage'}]
        } else if (path.endsWith('/schema')) {
            json = {cloud, service: 'storage', displayName: 'Storage', actions: ['list'], fields: [], filters: [], columns: [{name: 'name', label: 'Name'}]}
        } else if (path.endsWith('/resources')) {
            json = []
        } else {
            throw new Error(`Unexpected API request: ${path}`)
        }
        await route.fulfill({json})
    })
}

async function expectCloud(page: Page, cloud: string) {
    await expect(page.getByRole('link', {name: 'Console Home', exact: true})).toHaveAttribute('href', `/console/${cloud}`)
    await expect(page.locator('.cloud-service-nav > .nav-label')).toHaveText(`Cloud Services · ${cloud.toUpperCase()}`)
    await expect(page.getByRole('button', {name: `Switch cloud, currently ${cloud.toUpperCase()}`})).toBeVisible()
}

for (const cloud of clouds) {
    test(`global Settings recalls ${cloud} on direct entry`, async ({page}) => {
        await mockCloudApi(page)
        await page.goto(`/console/${cloud}`)
        await expectCloud(page, cloud)
        await page.goto('/settings')
        await expectCloud(page, cloud)
        await page.reload()
        await expectCloud(page, cloud)
        await page.goto('/settings/')
        await expectCloud(page, cloud)
        await page.goto('/SETTINGS/')
        await expectCloud(page, cloud)
    })

    test(`global Settings preserves ${cloud} through navigation, reload and history`, async ({page}) => {
        await mockCloudApi(page)
        await page.goto(`/console/${cloud}`)
        const settings = page.getByRole('link', {name: 'Settings', exact: true})
        await expect(settings).toHaveAttribute('href', '/settings')
        await settings.click()
        await expect(page).toHaveURL(/\/settings$/)
        await expectCloud(page, cloud)
        await page.reload()
        await expectCloud(page, cloud)
        await page.getByRole('link', {name: 'Console Home', exact: true}).click()
        await expect(page).toHaveURL(new RegExp(`/console/${cloud}$`))
        await page.goBack()
        await expect(page).toHaveURL(/\/settings$/)
        await expectCloud(page, cloud)

        await page.getByRole('link', {name: 'Storage', exact: true}).click()
        await expect(page).toHaveURL(new RegExp(`/cloud-explorer/${cloud}/storage$`))
        await settings.click()
        await expect(page).toHaveURL(/\/settings$/)
        await expectCloud(page, cloud)
        await expect.poll(() => page.evaluate(() => window.history.state.usr?.fromCloudExplorer)).toBe(true)
        await page.getByRole('textbox', {name: 'Search services, features, docs, and more'}).fill('storage')
        await expect(page).toHaveURL(/\/settings\?search=storage$/)
        await expectCloud(page, cloud)
        await expect.poll(() => page.evaluate(() => window.history.state.usr?.fromCloudExplorer)).toBe(true)
        await page.reload()
        await expectCloud(page, cloud)
        await expect.poll(() => page.evaluate(() => window.history.state.usr?.fromCloudExplorer)).toBe(true)
        await settings.click()
        await expect(page).toHaveURL(/\/settings$/)
        await expect.poll(() => page.evaluate(() => window.history.state.usr?.fromCloudExplorer)).toBe(true)
        await page.goBack()
        await expect(page).toHaveURL(/\/settings\?search=storage$/)
        await page.goBack()
        await expect(page).toHaveURL(new RegExp(`/cloud-explorer/${cloud}/storage$`))
        await page.goto('/settings')
        await expectCloud(page, cloud)
    })

    test(`legacy ${cloud} Settings redirects while preserving cloud, search and hash`, async ({page}) => {
        await mockCloudApi(page)
        await page.goto(`/console/${cloud}/settings?search=legacy#appearance`)
        await expect(page).toHaveURL(/\/settings\?search=legacy#appearance$/)
        await expectCloud(page, cloud)
        await page.reload()
        await expectCloud(page, cloud)
        await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible()
    })
}

test('direct global Settings defaults to AWS without remembered cloud', async ({page}) => {
    await mockCloudApi(page)
    await page.goto('/settings')
    await expectCloud(page, 'aws')
})

test('direct global Settings ignores an invalid remembered cloud', async ({page}) => {
    await mockCloudApi(page)
    await page.addInitScript(() => sessionStorage.setItem('floci-last-cloud', 'invalid-cloud'))
    await page.goto('/settings')
    await expectCloud(page, 'aws')
})

test('Settings navigation preserves OCI when session storage is unavailable', async ({page}) => {
    await mockCloudApi(page)
    await page.addInitScript(() => {
        Object.defineProperty(window, 'sessionStorage', {get() {throw new Error('Storage disabled')}})
    })
    await page.goto('/cloud-explorer/oci/storage')
    await page.getByRole('link', {name: 'Settings', exact: true}).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expectCloud(page, 'oci')
    await page.getByRole('textbox', {name: 'Search services, features, docs, and more'}).fill('storage')
    await expect(page).toHaveURL(/\/settings\?search=storage$/)
    await expect.poll(() => page.evaluate(() => window.history.state.usr?.fromCloudExplorer)).toBe(true)
    await page.reload()
    await expectCloud(page, 'oci')
})

test('Settings history restores its cloud after another cloud was selected', async ({page}) => {
    await mockCloudApi(page)
    await page.goto('/console/oci')
    await page.getByRole('link', {name: 'Settings', exact: true}).click()
    await expectCloud(page, 'oci')
    await page.getByRole('button', {name: 'Switch cloud, currently OCI'}).click()
    await page.getByRole('option', {name: 'AZURE', exact: true}).click()
    await expect(page).toHaveURL(/\/console\/azure$/)
    await page.getByRole('link', {name: 'Settings', exact: true}).click()
    await expectCloud(page, 'azure')
    await page.goBack()
    await expect(page).toHaveURL(/\/console\/azure$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
    await expectCloud(page, 'oci')
    await page.goForward()
    await expect(page).toHaveURL(/\/console\/azure$/)
    await expectCloud(page, 'azure')
    await page.goForward()
    await expect(page).toHaveURL(/\/settings$/)
    await expectCloud(page, 'azure')
})

for (const colorScheme of ['light', 'dark'] as const) {
    test(`restores System theme before hydration in ${colorScheme} mode`, async ({page}) => {
        await page.emulateMedia({colorScheme})
        await page.addInitScript(() => {
            if (!localStorage.getItem('floci-theme')) localStorage.setItem('floci-theme', 'system')
        })

        const entry = '**/src/main.tsx*'
        await page.route(entry, (route) => route.abort())
        await page.goto('/settings', {waitUntil: 'domcontentloaded'})
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
