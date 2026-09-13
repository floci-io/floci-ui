import {expect, test, type Page, type Route} from '@playwright/test'
import type {CloudResource} from '../src/types/resource'

const dynamo: CloudResource = {
    cloud: 'aws', service: 'nosql', type: 'dynamodb-table', id: 'orders', name: 'orders',
    region: 'us-east-1', createdAt: null,
    metadata: {keySchema: [{AttributeName: 'id', KeyType: 'HASH'}], attributeDefinitions: [{AttributeName: 'id', AttributeType: 'S'}]},
}
const cosmos: CloudResource = {...dynamo, cloud: 'azure', type: 'cosmos-database', id: 'catalog', name: 'catalog', metadata: {}}
const sql: CloudResource = {...cosmos, service: 'database', type: 'sql-server', id: '/subscriptions/local/resourceGroups/dev/providers/Microsoft.Sql/servers/my server', name: 'my server', metadata: {administratorLogin: 'admin'}}
const containers = ['products', 'archive'].map((id) => ({id, name: id, partitionKeyPath: '/id'}))
const sqlResult = {resultSets: [{columns: [{name: 'id', type: 'text'}], rows: [{id: 'row-1'}]}], rowsAffected: [1], durationMs: 1}

function workspacePath(resource: CloudResource) {
    return `/cloud-explorer/${resource.cloud}/${resource.service}/${encodeURIComponent(resource.id)}/data`
}

async function mockApi(page: Page, resource: CloudResource, handle?: (route: Route, path: string) => Promise<boolean>) {
    const requests: string[] = []
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname)
        requests.push(path)
        if (await handle?.(route, path)) return
        let json: unknown
        if (path === '/api/clouds') json = [{id: resource.cloud, displayName: resource.cloud, availability: 'available'}]
        else if (path.endsWith('/status')) json = {cloud: resource.cloud, runtime: 'reachable', adapterRegistered: true, endpoint: 'http://localhost:4566'}
        else if (path.endsWith('/services')) json = [{cloud: resource.cloud, service: resource.service, displayName: 'Test database service', route: resource.service, group: 'Databases', availability: 'available', iconKey: 'database'}]
        else if (path.endsWith('/schema')) json = {cloud: resource.cloud, service: resource.service, displayName: 'Test database service', actions: ['list', 'inspect', 'delete'], fields: [], filters: [], columns: [{name: 'name', label: 'Name'}]}
        else if (path.endsWith('/resources')) json = [resource]
        else if (path.endsWith(`/resources/${resource.id}`)) json = resource
        else if (path.endsWith('/containers')) json = containers
        else if (path.endsWith('/items')) json = []
        else if (path.endsWith('/sql/databases')) json = [{name: 'app', state: 'ONLINE'}, {name: 'analytics', state: 'ONLINE'}]
        else if (path.endsWith('/sql/tables')) json = [{schema: 'sales', name: 'orders', type: 'TABLE', rowCount: 1}]
        else if (path.endsWith('/sql/query')) json = sqlResult
        else throw new Error(`Unexpected API request: ${path}`)
        await route.fulfill({json})
    })
    return requests
}

test('DynamoDB management links to records and Add record in a dedicated workspace', async ({page}) => {
    let document: Record<string, unknown> | undefined
    await mockApi(page, dynamo, async (route, path) => {
        if (!path.endsWith('/items')) return false
        if (route.request().method() === 'POST') document = route.request().postDataJSON()
        const item = {id: 'new', key: {id: 'new'}, document}
        await route.fulfill({json: route.request().method() === 'POST' ? item : document ? [item] : []})
        return true
    })
    await page.goto('/cloud-explorer/aws/nosql')
    await page.getByRole('cell', {name: 'orders', exact: true}).click()
    await expect(page.locator('.dynamodb-explorer')).toHaveCount(0)
    await page.getByRole('link', {name: 'Explore data in orders'}).click()
    await expect(page).toHaveURL(new RegExp(`${workspacePath(dynamo)}$`))
    await expect(page.locator('.resource-table')).toHaveCount(0)
    await expect(page.getByRole('heading', {name: 'No records'})).toBeVisible()
    await page.getByRole('button', {name: 'Add record', exact: true}).click()
    await page.getByRole('textbox', {name: 'Record JSON'}).fill('{"id":"new","value":42}')
    await page.getByRole('dialog').getByRole('button', {name: 'Add record', exact: true}).click()
    await expect(page.locator('.dynamodb-document')).toContainText('42')
    expect(document).toEqual({id: 'new', value: 42})
    await page.reload()
    await expect(page.getByRole('cell', {name: '{"id":"new"}', exact: true})).toBeVisible()
    await page.getByRole('link', {name: /Back to/}).click()
    await expect(page).toHaveURL(/\/cloud-explorer\/aws\/nosql$/)
})

test('Cosmos preserves container links through create, edit, query, reload and history', async ({page}) => {
    const databaseContainers = [...containers]
    let document: Record<string, unknown> = {id: 'product-1', price: 5}
    await mockApi(page, cosmos, async (route, path) => {
        if (path.endsWith('/containers')) {
            const created = {id: 'new-container', name: 'new-container', partitionKeyPath: '/id'}
            if (route.request().method() === 'POST') databaseContainers.push(created)
            await route.fulfill({json: route.request().method() === 'POST' ? created : databaseContainers})
        } else if (path.endsWith('/items')) {
            if (route.request().method() === 'POST') document = route.request().postDataJSON()
            const item = {id: document.id, document, partitionKey: document.id, etag: 'etag', timestamp: null}
            await route.fulfill({json: route.request().method() === 'POST' ? item : [item]})
        } else if (path.endsWith('/query')) {
            expect(route.request().postDataJSON()).toEqual({query: 'SELECT * FROM c'})
            await route.fulfill({json: {count: 1, items: [document]}})
        } else return false
        return true
    })
    await page.goto('/cloud-explorer/azure/nosql')
    await page.getByRole('link', {name: 'Explore data in catalog'}).click()
    await expect(page.getByRole('heading', {name: 'Select a container'})).toBeVisible()
    await page.getByPlaceholder('Container name').fill('new-container')
    await page.getByRole('button', {name: 'Create', exact: true}).click()
    await expect(page).toHaveURL(/\?container=new-container$/)
    await page.getByRole('button', {name: 'Add record', exact: true}).click()
    await page.getByRole('textbox', {name: 'Record JSON'}).fill('{"id":"product-2","price":10}')
    await page.getByRole('dialog').getByRole('button', {name: 'Add record', exact: true}).click()
    await page.locator('.cosmos-editor textarea').fill('{"id":"product-2","price":20}')
    await page.getByRole('button', {name: 'Update document'}).click()
    await expect.poll(() => document.price).toBe(20)
    await page.getByRole('button', {name: 'Run query'}).click()
    await expect(page.locator('.cosmos-query-result')).toContainText('20')
    await page.getByRole('button', {name: /archive Partition key/}).click()
    await expect(page).toHaveURL(/\?container=archive$/)
    await page.goBack()
    await expect(page).toHaveURL(/\?container=new-container$/)
    await page.reload()
    await expect(page.locator('.cosmos-list-row.selected')).toContainText('new-container')
    await expect(page.getByRole('cell', {name: 'product-2', exact: true})).toBeVisible()
    await page.getByRole('link', {name: /Back to/}).click()
    await expect(page.locator('.cosmos-panel')).toHaveCount(0)
})

for (const type of ['sql-server', 'postgres-flexible-server']) {
    test(`${type} restores database/table context with credentials kept out of URL`, async ({page}) => {
        const resource = {...sql, type}
        const queries: Record<string, unknown>[] = []
        await mockApi(page, resource, async (route, path) => {
            if (!path.endsWith('/sql/query')) return false
            queries.push(route.request().postDataJSON())
            await route.fulfill({json: sqlResult})
            return true
        })
        await page.goto(`${workspacePath(resource)}?database=app&schema=sales&table=orders`)
        await expect(page.getByRole('heading', {name: 'my server'})).toBeVisible()
        await page.getByLabel('Password', {exact: true}).fill('test-password')
        await page.getByRole('button', {name: 'Connect', exact: true}).click()
        await expect(page.getByRole('cell', {name: 'row-1', exact: true})).toBeVisible()
        expect(queries.at(-1)).toMatchObject({database: 'app', username: 'admin', password: 'test-password', engine: type === 'sql-server' ? 'azure-sql' : 'postgresql'})
        expect(queries.at(-1)?.query).toBe(type === 'sql-server' ? 'SELECT TOP (100) * FROM [sales].[orders];' : 'SELECT * FROM "sales"."orders" LIMIT 100;')
        await page.getByRole('button', {name: 'analytics ONLINE'}).click()
        await expect(page).toHaveURL(/\?database=analytics$/)
        await page.getByRole('button', {name: 'sales.orders TABLE 1 rows'}).click()
        await expect(page.getByRole('cell', {name: 'row-1', exact: true})).toBeVisible()
        await page.goBack()
        await expect(page).toHaveURL(/\?database=analytics$/)
        await expect(page.getByRole('heading', {name: 'No query results'})).toBeVisible()
        await page.goBack()
        await expect(page.getByRole('cell', {name: 'row-1', exact: true})).toBeVisible()
        expect(queries.at(-1)?.database).toBe('app')
        expect(page.url()).not.toContain('test-password')
        await page.reload()
        await expect(page.getByLabel('Password', {exact: true})).toHaveValue('')
        await expect(page).toHaveURL(/\?database=app&schema=sales&table=orders$/)
    })
}

for (const failure of ['runtime', 'provider', 'missing', 'catalog']) {
    test(`direct workspace shows explicit ${failure} failure`, async ({page}) => {
        const requests = await mockApi(page, dynamo, async (route, path) => {
            if (failure === 'runtime' && path.endsWith('/status')) await route.fulfill({json: {runtime: 'unavailable', error: 'Start Floci'}})
            else if (failure === 'provider' && path.endsWith('/items')) await route.fulfill({status: 500, json: {error: 'Provider rejected scan'}})
            else if (failure === 'missing' && path.endsWith('/resources/orders')) await route.fulfill({status: 404, json: {error: 'Table deleted'}})
            else if (failure === 'catalog' && path.endsWith('/services')) await route.fulfill({status: 503, json: {error: 'Catalog unavailable'}})
            else return false
            return true
        })
        await page.goto(workspacePath(dynamo))
        const title = {runtime: 'Runtime unavailable', provider: 'Provider rejected scan', missing: 'Resource not found', catalog: 'Unable to load workspace'}[failure]!
        await expect(page.getByText(title, {exact: failure !== 'provider'}).first()).toBeVisible()
        await expect(page.getByRole('heading', {name: 'No records'})).toHaveCount(0)
        if (failure === 'runtime' || failure === 'catalog') expect(requests.some((path) => path.includes('/resources/'))).toBe(false)
        await expect(page.getByRole('link', {name: /Back to/})).toBeVisible()
    })
}

test('unsupported resource keeps management operations and explains direct data link', async ({page}) => {
    const resource = {...dynamo, service: 'database', type: 'db-instance'}
    await mockApi(page, resource)
    await page.goto('/cloud-explorer/aws/database')
    await expect(page.getByRole('cell', {name: 'orders', exact: true})).toBeVisible()
    await expect(page.getByRole('link', {name: /Explore data/})).toHaveCount(0)
    await page.goto(workspacePath(resource))
    await expect(page.getByRole('heading', {name: 'Data exploration unavailable'})).toBeVisible()
})

test('resource and record loading remain distinct from an empty table', async ({page}) => {
    let releaseResource!: () => void
    let releaseItems!: () => void
    const resourceReady = new Promise<void>((resolve) => { releaseResource = resolve })
    const itemsReady = new Promise<void>((resolve) => { releaseItems = resolve })
    await mockApi(page, dynamo, async (route, path) => {
        if (path.endsWith('/resources/orders')) {
            await resourceReady
            await route.fulfill({json: dynamo})
        } else if (path.endsWith('/items')) {
            await itemsReady
            await route.fulfill({json: []})
        } else return false
        return true
    })
    await page.goto(workspacePath(dynamo))
    await expect(page.getByRole('heading', {name: 'Loading resource'})).toBeVisible()
    releaseResource()
    await expect(page.getByText('Loading records', {exact: true})).toBeVisible()
    await expect(page.getByRole('heading', {name: 'No records'})).toHaveCount(0)
    releaseItems()
    await expect(page.getByRole('heading', {name: 'No records'})).toBeVisible()
})

test('a stale Cosmos container bookmark cannot write to an unknown container', async ({page}) => {
    const requests = await mockApi(page, cosmos)
    await page.goto(`${workspacePath(cosmos)}?container=deleted`)
    await expect(page.getByText('Container not found: deleted')).toBeVisible()
    await expect(page.getByRole('button', {name: 'Add record', exact: true})).toBeDisabled()
    await expect(page.getByRole('button', {name: 'Run query'})).toBeDisabled()
    expect(requests.some((path) => path.endsWith('/items'))).toBe(false)
})

test('SQL table refresh preserves custom query text and provider errors stay explicit', async ({page}) => {
    let tableReads = 0
    await mockApi(page, sql, async (route, path) => {
        if (path.endsWith('/sql/tables')) {
            tableReads++
            await route.fulfill({json: [{schema: 'sales', name: 'orders', type: 'TABLE', rowCount: tableReads}]})
        } else if (path.endsWith('/sql/query')) {
            await route.fulfill({status: 500, json: {error: 'SQL execution failed'}})
        } else return false
        return true
    })
    await page.goto(`${workspacePath(sql)}?database=app&schema=sales&table=orders`)
    await page.getByLabel('Password', {exact: true}).fill('test-password')
    await page.getByRole('button', {name: 'Connect', exact: true}).click()
    await expect(page.getByText(/SQL execution failed/)).toBeVisible()
    await page.locator('.sql-query-editor textarea').fill('SELECT 42;')
    await page.getByRole('button', {name: 'Refresh tables'}).click()
    await expect.poll(() => tableReads).toBe(2)
    await expect(page.locator('.sql-query-editor textarea')).toHaveValue('SELECT 42;')
})

test('late SQL results cannot replace results for the newly selected database', async ({page}) => {
    let releaseQuery!: () => void
    const queryReady = new Promise<void>((resolve) => { releaseQuery = resolve })
    await mockApi(page, sql, async (route, path) => {
        if (!path.endsWith('/sql/query')) return false
        const {database} = route.request().postDataJSON()
        if (database === 'app') await queryReady
        await route.fulfill({json: {...sqlResult, resultSets: [{columns: [{name: 'id', type: 'text'}], rows: [{id: database}]}]}})
        return true
    })
    await page.goto(`${workspacePath(sql)}?database=app&schema=sales&table=orders`)
    await page.getByLabel('Password', {exact: true}).fill('test-password')
    await page.getByRole('button', {name: 'Connect', exact: true}).click()
    await expect(page.getByRole('button', {name: 'Running', exact: true})).toBeVisible()
    await page.getByRole('button', {name: 'analytics ONLINE'}).click()
    await page.getByRole('button', {name: 'sales.orders TABLE 1 rows'}).click()
    await expect(page.getByRole('cell', {name: 'analytics', exact: true})).toBeVisible()
    const oldResponse = page.waitForResponse((response) => response.url().endsWith('/sql/query') && response.request().postDataJSON().database === 'app')
    releaseQuery()
    await oldResponse
    await expect(page.getByRole('cell', {name: 'analytics', exact: true})).toBeVisible()
    await expect(page.getByRole('cell', {name: 'app', exact: true})).toHaveCount(0)
})

for (const resource of [dynamo, cosmos, sql]) {
    test(`${resource.type} workspace fits desktop and narrow widths`, async ({page}, testInfo) => {
        await mockApi(page, resource)
        await page.goto(workspacePath(resource))
        await expect(page.getByRole('heading', {name: resource.name, exact: true})).toBeVisible()
        if (resource.type === 'sql-server') {
            await page.getByLabel('Password', {exact: true}).fill('test-password')
            await page.getByRole('button', {name: 'Connect', exact: true}).click()
            await page.getByRole('button', {name: 'sales.orders TABLE 1 rows'}).click()
            await expect(page.getByRole('cell', {name: 'row-1', exact: true})).toBeVisible()
        }
        for (const width of [1440, 768, 480]) {
            await page.setViewportSize({width, height: 1000})
            await expect(page.locator('.data-workspace')).toBeVisible()
            const dimensions = await page.locator('.data-workspace').evaluate((element) => ({client: element.clientWidth, scroll: element.scrollWidth, top: element.getBoundingClientRect().top}))
            expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1)
            expect(dimensions.top).toBeLessThan(350)
            await expect(page.locator('.resource-table')).toHaveCount(0)
            await page.screenshot({path: testInfo.outputPath(`workspace-${width}.png`)})
        }
    })
}
