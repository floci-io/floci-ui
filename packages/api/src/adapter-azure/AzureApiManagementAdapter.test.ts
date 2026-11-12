import {afterEach, describe, expect, test} from 'bun:test'
import {AzureApiManagementAdapter} from './AzureApiManagementAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'
const SERVICE_ID = `/subscriptions/${SUB}/resourceGroups/rg1/providers/Microsoft.ApiManagement/service/svc1`
const PRIMARY = 'primary-subscription-key'
const SECONDARY = 'secondary-subscription-key'
const SECRET_VALUE = 'top-secret-value'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureApiManagementAdapter {
    return new AzureApiManagementAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function service(name = 'svc1') {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/rg1/providers/Microsoft.ApiManagement/service/${name}`,
        name,
        type: 'Microsoft.ApiManagement/service',
        location: 'eastus',
        sku: {name: 'Developer', capacity: 1},
        properties: {
            provisioningState: 'Succeeded',
            gatewayUrl: `http://localhost:4577/devstoreaccount1-apim/${name}`,
            publisherName: 'Acme',
            publisherEmail: 'ops@example.com',
        },
    }
}

function child(kind: string, name: string, properties: Record<string, unknown>) {
    return {id: `${SERVICE_ID}/${kind}/${name}`, name, type: `Microsoft.ApiManagement/service/${kind}`, properties}
}

interface Fixtures {
    services?: unknown[]
    children?: Record<string, unknown[]>
    operations?: Record<string, unknown[]>
    pages?: Record<string, unknown[][]>
}

/** Serves ARM fixtures and records every URL the adapter calls. */
function stub(fixtures: Fixtures = {}) {
    const urls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        urls.push(url)
        const path = url.slice(ENDPOINT.length).split('?')[0]

        if (path === '/subscriptions') return json({value: [{subscriptionId: SUB}]})
        if (path.endsWith('/providers/Microsoft.ApiManagement/service')) return json({value: fixtures.services ?? []})

        const operations = path.match(/\/service\/[^/]+\/apis\/([^/]+)\/operations$/)
        if (operations) return json({value: fixtures.operations?.[operations[1]] ?? []})

        const collection = path.match(/\/service\/([^/]+)\/(apis|products|backends|namedValues|subscriptions)$/)
        if (collection) {
            const paged = fixtures.pages?.[collection[2]]
            if (paged) {
                const page = Number(new URL(url).searchParams.get('page') ?? 0)
                const next = page + 1 < paged.length ? `${url.split('&page=')[0]}&page=${page + 1}` : undefined
                return json({value: paged[page], nextLink: next})
            }
            return json({value: fixtures.children?.[collection[2]] ?? []})
        }

        const one = path.match(/\/service\/([^/]+)$/)
        if (one) {
            const found = (fixtures.services ?? []).find((s) => (s as {name: string}).name === one[1])
            return found ? json(found) : new Response('{}', {status: 404})
        }
        return new Response('unexpected', {status: 500})
    }) as typeof fetch
    return urls
}

describe('AzureApiManagementAdapter', () => {
    test('lists nothing as an empty array, not an error', async () => {
        stub()
        expect(await adapter().list()).toEqual([])
    })

    test('maps gateway URL, SKU, publisher and state and keys the id by resource group', async () => {
        stub({services: [service()]})
        const [item] = await adapter().list()

        expect(item.id).toBe('rg1/svc1')
        expect(item.status).toBe('Succeeded')
        expect(item.region).toBe('eastus')
        expect(item.metadata).toMatchObject({
            sku: 'Developer',
            gatewayUrl: 'http://localhost:4577/devstoreaccount1-apim/svc1',
            publisherName: 'Acme',
            resourceGroup: 'rg1',
        })
    })

    test('filters by name', async () => {
        stub({services: [service('alpha'), service('beta')]})
        expect((await adapter().list({search: 'BET'})).map((r) => r.name)).toEqual(['beta'])
    })

    test('get returns null for a service the runtime does not know', async () => {
        stub()
        expect(await adapter().get('rg1/ghost')).toBeNull()
    })

    test('get rejects an id without a resource group', async () => {
        stub()
        await expect(adapter().get('svc1')).rejects.toBeInstanceOf(ValidationError)
    })

    test('advertises read only service actions and no create or delete', () => {
        const schema = adapter().schema()
        expect(schema.actions).toEqual(['list', 'inspect'])
        expect(schema.capabilities?.resourceActions?.map((a) => a.name)).toEqual(['list', 'inspect'])
        expect(adapter().documents.createCollection).toBeUndefined()
        expect(adapter().documents.putItem).toBeUndefined()
        expect(adapter().documents.deleteItem).toBeUndefined()
    })

    test('lists the five fixed collections of an existing service', async () => {
        stub({services: [service()]})
        const page = await adapter().documents.listCollections('rg1/svc1')
        expect(page.items.map((c) => c.id)).toEqual(['apis', 'products', 'backends', 'namedValues', 'subscriptions'])
        expect(page.nextCursor).toBeNull()
    })

    test('a missing service is not found rather than an empty collection', async () => {
        stub()
        await expect(adapter().documents.listCollections('rg1/ghost')).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter().documents.listItems('rg1/ghost', 'apis')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('an unknown collection is not found', async () => {
        stub({services: [service()]})
        await expect(adapter().documents.listItems('rg1/svc1', 'policies')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('lists APIs with their operations', async () => {
        stub({
            services: [service()],
            children: {
                apis: [child('apis', 'petstore', {displayName: 'Petstore', path: 'pets', protocols: ['https'], serviceUrl: 'http://backend'})],
            },
            operations: {
                petstore: [{name: 'getpets', properties: {displayName: 'List', method: 'GET', urlTemplate: '/pets'}}],
            },
        })
        const page = await adapter().documents.listItems('rg1/svc1', 'apis')

        expect(page.items).toHaveLength(1)
        expect(page.items[0].id).toBe('petstore')
        expect(page.items[0].collectionId).toBe('apis')
        expect(page.items[0].body).toMatchObject({displayName: 'Petstore', path: 'pets', serviceUrl: 'http://backend'})
        expect(page.items[0].body.operations).toEqual([
            {name: 'getpets', displayName: 'List', method: 'GET', urlTemplate: '/pets'},
        ])
    })

    test('never exposes subscription keys and never calls a secrets action', async () => {
        const urls = stub({
            services: [service()],
            children: {
                subscriptions: [
                    child('subscriptions', 's1', {
                        displayName: 'S1',
                        scope: '/products/p1',
                        state: 'active',
                        primaryKey: PRIMARY,
                        secondaryKey: SECONDARY,
                    }),
                ],
            },
        })
        const page = await adapter().documents.listItems('rg1/svc1', 'subscriptions')

        const rendered = JSON.stringify(page)
        expect(rendered).not.toContain(PRIMARY)
        expect(rendered).not.toContain(SECONDARY)
        expect(rendered).not.toMatch(/primaryKey|secondaryKey/)
        expect(page.items[0].body).toMatchObject({displayName: 'S1', scope: '/products/p1', state: 'active'})
        expect(urls.some((url) => /listSecrets|regeneratePrimaryKey|regenerateSecondaryKey/i.test(url))).toBe(false)
    })

    test('hides the value of a secret named value even if the runtime sent it', async () => {
        stub({
            services: [service()],
            children: {
                namedValues: [
                    child('namedValues', 'sec', {displayName: 'sec', secret: true, value: SECRET_VALUE}),
                    child('namedValues', 'plain', {displayName: 'plain', secret: false, value: 'hello'}),
                ],
            },
        })
        const page = await adapter().documents.listItems('rg1/svc1', 'namedValues')

        expect(JSON.stringify(page)).not.toContain(SECRET_VALUE)
        expect(page.items[0].body).toEqual({name: 'sec', displayName: 'sec', secret: true})
        expect(page.items[1].body).toEqual({name: 'plain', displayName: 'plain', secret: false, value: 'hello'})
    })

    test('maps products and backends', async () => {
        stub({
            services: [service()],
            children: {
                products: [child('products', 'p1', {displayName: 'P1', state: 'published', subscriptionRequired: true})],
                backends: [child('backends', 'b1', {title: 'b1', url: 'http://backend', protocol: 'http'})],
            },
        })
        const products = await adapter().documents.listItems('rg1/svc1', 'products')
        const backends = await adapter().documents.listItems('rg1/svc1', 'backends')

        expect(products.items[0].body).toMatchObject({displayName: 'P1', state: 'published'})
        expect(backends.items[0].body).toMatchObject({url: 'http://backend', protocol: 'http'})
    })

    test('pages the full list with an offset cursor', async () => {
        const apis = ['a', 'b', 'c'].map((name) => child('apis', name, {displayName: name}))
        stub({services: [service()], children: {apis}})

        const first = await adapter().documents.listItems('rg1/svc1', 'apis', {limit: 2})
        expect(first.items.map((i) => i.id)).toEqual(['a', 'b'])
        expect(first.nextCursor).toBe('2')

        const second = await adapter().documents.listItems('rg1/svc1', 'apis', {limit: 2, cursor: first.nextCursor ?? undefined})
        expect(second.items.map((i) => i.id)).toEqual(['c'])
        expect(second.nextCursor).toBeNull()
    })

    test('rejects a cursor that is not an offset', async () => {
        stub({services: [service()]})
        await expect(adapter().documents.listItems('rg1/svc1', 'apis', {cursor: 'abc'})).rejects.toBeInstanceOf(ValidationError)
    })

    test('follows nextLink across ARM pages', async () => {
        stub({
            services: [service()],
            pages: {
                products: [[child('products', 'p1', {displayName: 'P1'})], [child('products', 'p2', {displayName: 'P2'})]],
            },
        })
        const page = await adapter().documents.listItems('rg1/svc1', 'products')
        expect(page.items.map((i) => i.id)).toEqual(['p1', 'p2'])
    })
})
