import {afterEach, describe, expect, test} from 'bun:test'
import {AzureEventGridAdapter} from './AzureEventGridAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {ConflictError, NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'
const KEY1 = 'topic-key-one'
const KEY2 = 'topic-key-two'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureEventGridAdapter {
    return new AzureEventGridAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function topic(name = 'orders', resourceGroup = 'rg1', extra: Record<string, unknown> = {}) {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/${resourceGroup}/providers/Microsoft.EventGrid/topics/${name}`,
        name,
        type: 'Microsoft.EventGrid/topics',
        location: 'eastus',
        properties: {
            provisioningState: 'Succeeded',
            endpoint: `http://localhost:4577/${name}-eventgrid/api/events`,
            inputSchema: 'EventGridSchema',
            publicNetworkAccess: 'Enabled',
        },
        ...extra,
    }
}

function eventSubscription(name: string, properties: Record<string, unknown> = {}, topicName = 'orders') {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/rg1/providers/Microsoft.EventGrid/topics/${topicName}/providers/Microsoft.EventGrid/eventSubscriptions/${name}`,
        name,
        type: 'Microsoft.EventGrid/eventSubscriptions',
        properties: {
            provisioningState: 'Succeeded',
            destination: {endpointType: 'WebHook', properties: {endpointUrl: 'https://app.example/hook'}},
            filter: {subjectBeginsWith: '/orders', subjectEndsWith: null, includedEventTypes: null, isSubjectCaseSensitive: false},
            retryPolicy: {maxDeliveryAttempts: 30, eventTimeToLiveInMinutes: 1440},
            eventDeliverySchema: 'EventGridSchema',
            ...properties,
        },
    }
}

interface Call {
    method: string
    url: string
    body?: unknown
}

interface Fixtures {
    topics?: ReturnType<typeof topic>[]
    subscriptions?: Record<string, unknown[]>
    groups?: string[]
    pages?: unknown[][]
}

/** A runtime that keeps topics: a PUT stores one, a DELETE removes it, and every call is recorded. */
function stub(fixtures: Fixtures = {}) {
    const calls: Call[] = []
    const topics = [...(fixtures.topics ?? [])]
    const groups = fixtures.groups ?? ['rg1']
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({method, url, body})
        const path = url.slice(ENDPOINT.length).split('?')[0]

        if (path === '/subscriptions') return json({value: [{subscriptionId: SUB}]})
        if (path === `/subscriptions/${SUB}/resourceGroups`) return json({value: groups.map((name) => ({name}))})
        if (path === `/subscriptions/${SUB}/providers/Microsoft.EventGrid/topics`) {
            if (fixtures.pages) {
                const page = Number(new URL(url).searchParams.get('page') ?? 0)
                const next = page + 1 < fixtures.pages.length ? `${url.split('&page=')[0]}&page=${page + 1}` : undefined
                return json({value: fixtures.pages[page], nextLink: next})
            }
            return json({value: topics})
        }

        const children = path.match(/\/topics\/([^/]+)\/providers\/Microsoft\.EventGrid\/eventSubscriptions$/)
        if (children) return json({value: fixtures.subscriptions?.[children[1]] ?? []})

        const one = path.match(/\/resourceGroups\/([^/]+)\/providers\/Microsoft\.EventGrid\/topics\/([^/]+)$/)
        if (one) {
            const index = topics.findIndex((t) => t.name === one[2])
            if (method === 'PUT') {
                const created = topic(one[2], one[1], {location: body?.location})
                created.properties.inputSchema = body?.properties?.inputSchema
                if (index >= 0) topics[index] = created
                else topics.push(created)
                return json(created)
            }
            if (method === 'DELETE') {
                if (index >= 0) topics.splice(index, 1)
                return json({})
            }
            return index >= 0 ? json(topics[index]) : new Response('{}', {status: 404})
        }
        return new Response('unexpected', {status: 500})
    }) as typeof fetch
    return calls
}

describe('AzureEventGridAdapter topics', () => {
    test('lists nothing as an empty array, not an error', async () => {
        stub()
        expect(await adapter().list()).toEqual([])
    })

    test('maps endpoint, schema and provisioning state and keys the id by resource group', async () => {
        stub({topics: [topic()]})
        const [item] = await adapter().list()

        expect(item.id).toBe('rg1/orders')
        expect(item.type).toBe('event-grid-topic')
        expect(item.status).toBe('Succeeded')
        expect(item.region).toBe('eastus')
        expect(item.createdAt).toBeNull()
        expect(item.metadata).toMatchObject({
            endpoint: 'http://localhost:4577/orders-eventgrid/api/events',
            inputSchema: 'EventGridSchema',
            resourceGroup: 'rg1',
        })
    })

    test('filters by name', async () => {
        stub({topics: [topic('alpha'), topic('beta')]})
        expect((await adapter().list({search: 'BET'})).map((r) => r.name)).toEqual(['beta'])
    })

    test('follows nextLink across ARM pages', async () => {
        stub({pages: [[topic('one')], [topic('two')]]})
        expect((await adapter().list()).map((r) => r.name)).toEqual(['one', 'two'])
    })

    test('get returns null for a topic the runtime does not know', async () => {
        stub()
        expect(await adapter().get('rg1/ghost')).toBeNull()
    })

    test('get rejects an id without a resource group', async () => {
        stub()
        await expect(adapter().get('orders')).rejects.toBeInstanceOf(ValidationError)
    })

    test('never calls listKeys or regenerateKey and never shows a key', async () => {
        const calls = stub({topics: [topic('orders', 'rg1', {key1: KEY1, key2: KEY2})]})
        const a = adapter()
        const [listed] = await a.list()
        const got = await a.get('rg1/orders')
        await a.documents.listCollections('rg1/orders')
        await a.documents.listItems('rg1/orders', 'eventSubscriptions')

        expect(JSON.stringify([listed, got])).not.toMatch(new RegExp(`${KEY1}|${KEY2}|key1|key2`))
        expect(calls.some((call) => /listKeys|regenerateKey/i.test(call.url))).toBe(false)
    })
})

describe('AzureEventGridAdapter create and delete', () => {
    test('creates through a PUT with location and schema and reads it back', async () => {
        const calls = stub()
        const created = await adapter().create({
            values: {name: 'orders', resourceGroup: 'RG1', location: 'westus', inputSchema: 'CloudEventSchemaV1_0'},
        })

        const put = calls.find((call) => call.method === 'PUT')
        expect(put?.url).toContain(
            `/subscriptions/${SUB}/resourceGroups/rg1/providers/Microsoft.EventGrid/topics/orders?api-version=2025-02-15`,
        )
        expect(put?.body).toEqual({location: 'westus', properties: {inputSchema: 'CloudEventSchemaV1_0'}})
        expect(created.id).toBe('rg1/orders')
        expect(created.region).toBe('westus')
        expect(created.metadata.inputSchema).toBe('CloudEventSchemaV1_0')
    })

    test('defaults to the console location and the Event Grid schema', async () => {
        const original = process.env.FLOCI_AZURE_LOCATION
        process.env.FLOCI_AZURE_LOCATION = 'westus2'
        try {
            const calls = stub()
            await adapter().create({values: {name: 'orders', resourceGroup: 'rg1'}})
            expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
                location: 'westus2',
                properties: {inputSchema: 'EventGridSchema'},
            })
        } finally {
            if (original === undefined) delete process.env.FLOCI_AZURE_LOCATION
            else process.env.FLOCI_AZURE_LOCATION = original
        }
    })

    test('refuses a topic that exists, because the runtime would silently overwrite it', async () => {
        const calls = stub({topics: [topic()]})
        await expect(adapter().create({values: {name: 'orders', resourceGroup: 'rg1'}})).rejects.toBeInstanceOf(ConflictError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('rejects an invalid name, location, schema and missing fields', async () => {
        stub()
        const base = {name: 'orders', resourceGroup: 'rg1'}
        await expect(adapter().create({values: {...base, name: 'ab'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {...base, name: 'bad_name'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {...base, name: 'a'.repeat(51)}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {...base, location: 'mars'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {...base, inputSchema: 'CustomEventSchema'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {name: 'orders'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('rejects a resource group that does not exist and sends no PUT', async () => {
        const calls = stub({groups: []})
        await expect(adapter().create({values: {name: 'orders', resourceGroup: 'ghost'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('deletes by resource group and name', async () => {
        const calls = stub({topics: [topic()]})
        await adapter().delete('rg1/orders')

        const del = calls.find((call) => call.method === 'DELETE')
        expect(del?.url).toContain('/resourceGroups/rg1/providers/Microsoft.EventGrid/topics/orders?')
        expect(await adapter().get('rg1/orders')).toBeNull()
    })

    test('advertises create and delete for topics and keeps subscriptions read only', () => {
        const a = adapter()
        expect(a.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(a.documents.createCollection).toBeUndefined()
        expect(a.documents.putItem).toBeUndefined()
        expect(a.documents.deleteItem).toBeUndefined()
    })
})

describe('AzureEventGridAdapter event subscriptions', () => {
    test('lists the one fixed collection of an existing topic', async () => {
        stub({topics: [topic()]})
        const page = await adapter().documents.listCollections('rg1/orders')
        expect(page.items.map((c) => c.id)).toEqual(['eventSubscriptions'])
        expect(page.nextCursor).toBeNull()
    })

    test('a missing topic is not found rather than an empty collection', async () => {
        stub()
        await expect(adapter().documents.listCollections('rg1/ghost')).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter().documents.listItems('rg1/ghost', 'eventSubscriptions')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('an unknown collection is not found', async () => {
        stub({topics: [topic()]})
        await expect(adapter().documents.listItems('rg1/orders', 'keys')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('lists subscriptions with destination, filters and retry policy', async () => {
        const calls = stub({
            topics: [topic()],
            subscriptions: {
                orders: [
                    eventSubscription('to-app', {
                        filter: {subjectBeginsWith: '/orders', subjectEndsWith: '.json', includedEventTypes: ['Order.Created'], isSubjectCaseSensitive: true},
                        deadLetterDestination: {endpointType: 'StorageBlob', properties: {resourceId: '/subscriptions/x/storage', blobContainerName: 'dead'}},
                    }),
                ],
            },
        })
        const page = await adapter().documents.listItems('rg1/orders', 'eventSubscriptions')

        expect(page.items).toHaveLength(1)
        expect(page.items[0].id).toBe('to-app')
        expect(page.items[0].collectionId).toBe('eventSubscriptions')
        expect(page.items[0].timestamp).toBeNull()
        expect(page.items[0].body).toEqual({
            name: 'to-app',
            provisioningState: 'Succeeded',
            endpointType: 'WebHook',
            endpointUrl: 'https://app.example/hook',
            subjectBeginsWith: '/orders',
            subjectEndsWith: '.json',
            includedEventTypes: ['Order.Created'],
            isSubjectCaseSensitive: true,
            eventDeliverySchema: 'EventGridSchema',
            maxDeliveryAttempts: 30,
            eventTimeToLiveInMinutes: 1440,
            deadLetterEndpointType: 'StorageBlob',
        })
        expect(calls.some((call) => call.url.includes('/topics/orders/providers/Microsoft.EventGrid/eventSubscriptions?api-version='))).toBe(true)
    })

    test('treats null filters as no filter', async () => {
        stub({
            topics: [topic()],
            subscriptions: {orders: [eventSubscription('plain', {filter: {subjectBeginsWith: null, subjectEndsWith: null, includedEventTypes: null}})]},
        })
        const [item] = (await adapter().documents.listItems('rg1/orders', 'eventSubscriptions')).items
        expect(item.body).toMatchObject({subjectBeginsWith: null, includedEventTypes: [], isSubjectCaseSensitive: false})
    })

    test('hides the query string and user info of a webhook URL', async () => {
        stub({
            topics: [topic()],
            subscriptions: {
                orders: [
                    eventSubscription('keyed', {
                        destination: {endpointType: 'WebHook', properties: {endpointUrl: 'https://user:pw@fn.example/api/hook?code=SECRETKEY&sig=abc'}},
                    }),
                ],
            },
        })
        const page = await adapter().documents.listItems('rg1/orders', 'eventSubscriptions')

        expect(page.items[0].body.endpointUrl).toBe('https://fn.example/api/hook?...')
        expect(JSON.stringify(page)).not.toMatch(/SECRETKEY|sig=abc|user:pw/)
    })

    test('drops a webhook URL it cannot parse instead of echoing it', async () => {
        stub({
            topics: [topic()],
            subscriptions: {
                orders: [eventSubscription('odd', {destination: {endpointType: 'WebHook', properties: {endpointUrl: 'not a url?code=SECRETKEY'}}})],
            },
        })
        const page = await adapter().documents.listItems('rg1/orders', 'eventSubscriptions')
        expect(page.items[0].body.endpointUrl).toBeUndefined()
        expect(JSON.stringify(page)).not.toContain('SECRETKEY')
    })

    test('pages the full list with an offset cursor', async () => {
        stub({topics: [topic()], subscriptions: {orders: ['a', 'b', 'c'].map((name) => eventSubscription(name))}})

        const first = await adapter().documents.listItems('rg1/orders', 'eventSubscriptions', {limit: 2})
        expect(first.items.map((i) => i.id)).toEqual(['a', 'b'])
        expect(first.nextCursor).toBe('2')

        const second = await adapter().documents.listItems('rg1/orders', 'eventSubscriptions', {limit: 2, cursor: first.nextCursor ?? undefined})
        expect(second.items.map((i) => i.id)).toEqual(['c'])
        expect(second.nextCursor).toBeNull()
    })

    test('rejects a cursor that is not an offset', async () => {
        stub({topics: [topic()]})
        await expect(adapter().documents.listItems('rg1/orders', 'eventSubscriptions', {cursor: 'abc'})).rejects.toBeInstanceOf(ValidationError)
    })
})
