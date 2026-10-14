import {expect, test, type Page} from '@playwright/test'
import type {CloudResource, StorageObject} from '../src/types/resource'

const bucket: CloudResource = {
    cloud: 'aws', service: 'storage', type: 's3-bucket', id: 'media', name: 'media',
    region: 'us-east-1', createdAt: null, metadata: {},
}

function object(name: string): StorageObject {
    return {key: name, name, type: 'object', size: 1024, lastModified: null, metadata: {}}
}

async function mockApi(page: Page) {
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname)
        if (path.endsWith('/object')) return route.fulfill({status: 404, body: ''})
        let json: unknown
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
        else throw new Error(`Unexpected API request: ${path}`)
        await route.fulfill({json})
    })
}

for (const [file, tag] of [['clip.mp4', 'video'], ['song.mp3', 'audio']] as const) {
    test(`Tab reaches the ${tag} player in the ${file} preview`, async ({page}) => {
        await mockApi(page)
        await page.goto('/cloud-explorer/aws/storage')
        await page.getByRole('cell', {name: 'media', exact: true}).click()
        await page.getByTitle(`Preview ${file}`).click()

        const dialog = page.getByRole('dialog', {name: `Preview of ${file}`})
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', {name: 'Close'}).focus()
        await page.keyboard.press('Tab')
        await expect(dialog.locator(tag)).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(dialog.getByRole('link', {name: `Download ${file}`})).toBeFocused()
    })
}
