import {afterEach, describe, expect, test} from 'bun:test'
import {AzureCacheAdapter} from './AzureCacheAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'
const PRIMARY = 'primary-secret-key'
const SECONDARY = 'secondary-secret-key'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureCacheAdapter {
    return new AzureCacheAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

interface Call {
    method: string
    url: string
    body?: unknown
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

/** The runtime embeds the access keys in every cache body, so every fixture carries them. */
function cache(name = 'demo-cache', overrides: Record<string, unknown> = {}) {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/rg-redis/providers/Microsoft.Cache/Redis/${name}`,
        name,
        type: 'Microsoft.Cache/Redis',
        location: 'eastus',
        properties: {
            provisioningState: 'Succeeded',
            redisVersion: '7.0',
            sku: {name: 'Basic', family: 'C', capacity: 0},
            enableNonSslPort: true,
            minimumTlsVersion: '1.2',
            hostName: 'localhost',
            port: 6379,
            sslPort: 6380,
            publicNetworkAccess: 'Enabled',
            accessKeys: {primaryKey: PRIMARY, secondaryKey: SECONDARY},
        },
        ...overrides,
    }
}

/** Serves the fixtures a scenario needs and records every call the adapter makes. */
function stub(handlers: {caches?: unknown[]; nameStatus?: number; groups?: string[]} = {}) {
    const calls: Call[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        calls.push({method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined})

        if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
        if (url.includes('/resourceGroups?')) {
            return json({value: (handlers.groups ?? ['rg-redis']).map((name) => ({name}))})
        }
        if (url.includes('checkNameAvailability')) {
            return handlers.nameStatus === 409
                ? json({error: {code: 'NameNotAvailable', message: 'taken'}}, 409)
                : new Response('', {status: handlers.nameStatus ?? 200})
        }
        if (method === 'DELETE') return new Response(null, {status: 202})
        if (method === 'PUT') return json(cache(), 201)
        if (url.includes('/redis/')) {
            const found = (handlers.caches ?? []).find((c) => url.includes(`/redis/${(c as {name: string}).name}?`))
            return found ? json(found) : new Response('{}', {status: 404})
        }
        if (url.includes('/redis?')) return json({value: handlers.caches ?? []})
        return new Response('unexpected', {status: 500})
    }) as typeof fetch
    return calls
}

describe('AzureCacheAdapter', () => {
    test('lists nothing as an empty array, not an error', async () => {
        stub()
        expect(await adapter().list()).toEqual([])
    })

    test('maps host name, port, sku and state and keys the id by resource group', async () => {
        stub({caches: [cache()]})
        const [item] = await adapter().list()

        expect(item.id).toBe('rg-redis/demo-cache')
        expect(item.status).toBe('Succeeded')
        expect(item.region).toBe('eastus')
        expect(item.metadata).toMatchObject({
            hostName: 'localhost',
            port: 6379,
            sslPort: 6380,
            sku: 'Basic',
            redisVersion: '7.0',
            resourceGroup: 'rg-redis',
        })
    })

    test('never exposes the access keys the runtime embeds, and never calls the key actions', async () => {
        const calls = stub({caches: [cache()]})

        const [listed] = await adapter().list()
        const inspected = await adapter().get('rg-redis/demo-cache')

        const rendered = JSON.stringify([listed, inspected])
        expect(rendered).not.toContain(PRIMARY)
        expect(rendered).not.toContain(SECONDARY)
        expect(rendered).not.toContain('accessKeys')
        expect(calls.some((call) => /listKeys|regenerateKey/i.test(call.url))).toBe(false)
    })

    test('filters by name', async () => {
        stub({caches: [cache('alpha'), cache('beta')]})
        const result = await adapter().list({search: 'BET'})
        expect(result.map((r) => r.name)).toEqual(['beta'])
    })

    test('get returns null for a cache the runtime does not know', async () => {
        stub()
        expect(await adapter().get('rg-redis/ghost')).toBeNull()
    })

    test('get rejects an id without a resource group', async () => {
        stub()
        await expect(adapter().get('demo-cache')).rejects.toBeInstanceOf(ValidationError)
    })

    test('create checks the name, then PUTs the ARM body and reads the cache back', async () => {
        const calls = stub({caches: [cache()]})
        const created = await adapter().create({
            values: {name: 'demo-cache', resourceGroup: 'RG-REDIS', sku: 'Standard'},
        })

        expect(created.id).toBe('rg-redis/demo-cache')
        const order = calls.map((call) => `${call.method} ${call.url.includes('checkName') ? 'check' : call.url.includes('/redis/') ? 'cache' : 'other'}`)
        expect(order.indexOf('POST check')).toBeLessThan(order.indexOf('PUT cache'))
        expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
            location: 'eastus',
            properties: {sku: {name: 'Standard', family: 'C', capacity: 0}},
        })
        expect(calls.find((call) => call.method === 'POST')?.body).toEqual({name: 'demo-cache', type: 'Microsoft.Cache/redis'})
    })

    test('create sends the P family and capacity 1 for Premium', async () => {
        const calls = stub({caches: [cache()]})
        await adapter().create({values: {name: 'demo-cache', resourceGroup: 'rg-redis', sku: 'Premium'}})
        expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
            properties: {sku: {name: 'Premium', family: 'P', capacity: 1}},
        })
    })

    test('a taken name is a validation error and nothing is created', async () => {
        const calls = stub({nameStatus: 409})
        await expect(adapter().create({values: {name: 'demo-cache', resourceGroup: 'rg-redis'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('a failing name check is a runtime error, not a silent create', async () => {
        const calls = stub({nameStatus: 500})
        await expect(adapter().create({values: {name: 'demo-cache', resourceGroup: 'rg-redis'}})).rejects.toBeInstanceOf(RuntimeError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test.each(['-bad', 'bad-', 'bad--name', 'bad_name', 'a'.repeat(64)])('create rejects the invalid name %s', async (name) => {
        const calls = stub()
        await expect(adapter().create({values: {name, resourceGroup: 'rg-redis'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('create rejects a resource group the runtime does not have', async () => {
        const calls = stub()
        await expect(adapter().create({values: {name: 'demo-cache', resourceGroup: 'ghost'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('create rejects an unknown sku and location', async () => {
        stub()
        await expect(adapter().create({values: {name: 'demo-cache', resourceGroup: 'rg-redis', sku: 'Enterprise'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {name: 'demo-cache', resourceGroup: 'rg-redis', location: 'mars'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('delete sends a DELETE to the group scoped path', async () => {
        const calls = stub()
        await adapter().delete('rg-redis/demo-cache')
        const call = calls.find((c) => c.method === 'DELETE')
        expect(call?.url).toContain('/resourceGroups/rg-redis/providers/Microsoft.Cache/redis/demo-cache')
    })

    test('delete of a missing cache is a no-op', async () => {
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input)
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            return new Response('{}', {status: 404})
        }) as typeof fetch
        await expect(adapter().delete('rg-redis/ghost')).resolves.toBeUndefined()
    })

    test('schema declares only the actions the adapter performs', () => {
        const schema = adapter().schema()
        expect(schema.actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(JSON.stringify(schema)).not.toMatch(/accessKeys|primaryKey/)
    })
})
