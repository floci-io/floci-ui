import {expect, test, type Locator, type Page} from '@playwright/test'
import type {CloudResource, StorageObject} from '../src/types/resource'

const bucket: CloudResource = {
    cloud: 'aws', service: 'storage', type: 's3-bucket', id: 'media', name: 'media',
    region: 'us-east-1', createdAt: null, metadata: {},
}

function object(name: string): StorageObject {
    return {key: name, name, type: 'object', size: 1024, lastModified: null, metadata: {}}
}

const secret = {
    name: 'db-password',
    arn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:db-password',
    description: 'Database password',
    rotationEnabled: false,
    tags: [],
}

async function mockApi(page: Page) {
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname)
        let json: unknown = []
        if (path === '/api/clouds') json = [{id: 'aws', displayName: 'aws', availability: 'available'}]
        else if (path.endsWith('/status')) json = {cloud: 'aws', runtime: 'reachable', adapterRegistered: true, endpoint: 'http://localhost:4566'}
        else if (path.endsWith('/services')) json = [{cloud: 'aws', service: 'storage', displayName: 'S3', route: 'storage', group: 'Storage', availability: 'available', iconKey: 'storage'}]
        else if (path.endsWith('/schema')) json = {
            cloud: 'aws', service: 'storage', displayName: 'S3', actions: ['list', 'inspect'], fields: [], filters: [],
            columns: [{name: 'name', label: 'Name'}],
            capabilities: {objectActions: ['list', 'download']},
        }
        else if (path.endsWith('/resources')) json = [bucket]
        else if (path.endsWith(`/resources/${bucket.id}`)) json = bucket
        else if (path.endsWith('/objects')) json = {prefix: '', objects: [object('clip.mp4'), object('song.mp3')]}
        else if (path === '/api/secretsmanager/secrets') json = [secret]
        else if (path === '/api/secretsmanager/secret') json = {...secret, versionIds: []}
        else if (path === '/api/secretsmanager/secret/value') json = {name: secret.name, secretString: 'hunter2'}
        await route.fulfill({json})
    })
}

async function expectIconInsideInput(input: Locator) {
    const icon = input.locator('xpath=preceding-sibling::*[local-name()="svg"][1]')
    const [iconBox, inputBox] = await Promise.all([icon.boundingBox(), input.boundingBox()])
    expect(iconBox).not.toBeNull()
    expect(inputBox).not.toBeNull()
    if (!iconBox || !inputBox) return
    expect(iconBox.x).toBeGreaterThanOrEqual(inputBox.x)
    expect(iconBox.y).toBeGreaterThanOrEqual(inputBox.y)
    expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width)
    expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height)
}

test('the S3 object search icon sits inside its input', async ({page}) => {
    await mockApi(page)
    await page.goto('/cloud-explorer/aws/storage')
    await page.getByRole('cell', {name: 'media', exact: true}).click()
    await expectIconInsideInput(page.getByRole('textbox', {name: 'Search objects and folders'}))
})

test('the Secrets Manager search icon sits inside its input', async ({page}) => {
    await mockApi(page)
    await page.goto('/secretsmanager')
    await expectIconInsideInput(page.getByRole('textbox', {name: 'Search by name or description'}))
})

test('the closed secret drawer casts no shadow onto the page', async ({page}) => {
    await mockApi(page)
    await page.goto('/secretsmanager')
    const drawer = page.locator('.tag-drawer')
    await expect(page.getByRole('cell', {name: secret.name})).toBeVisible()
    await expect(drawer).toHaveCSS('box-shadow', 'none')
    const viewport = page.viewportSize()
    const closedBox = await drawer.boundingBox()
    expect(closedBox && viewport && closedBox.x >= viewport.width).toBe(true)

    await page.getByRole('cell', {name: secret.name}).click()
    await expect(drawer).toHaveClass(/\bopen\b/)
    await expect(drawer).not.toHaveCSS('box-shadow', 'none')
})
