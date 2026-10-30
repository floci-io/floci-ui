import {afterEach, describe, expect, test} from 'bun:test'
import {AzureRegistryAdapter} from './AzureRegistryAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureRegistryAdapter {
    return new AzureRegistryAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

interface Call {
    method: string
    url: string
    body?: unknown
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function registry(name = 'demoreg', overrides: Record<string, unknown> = {}) {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/rg-acr/providers/Microsoft.ContainerRegistry/registries/${name}`,
        name,
        type: 'Microsoft.ContainerRegistry/registries',
        location: 'eastus',
        sku: {name: 'Standard', tier: 'Standard'},
        properties: {
            loginServer: `localhost:5050/${name}`,
            creationDate: '2026-10-30T00:04:32.950994Z',
            provisioningState: 'Succeeded',
            adminUserEnabled: true,
            publicNetworkAccess: 'Enabled',
        },
        ...overrides,
    }
}

/** Serves the fixtures a scenario needs and records every call the adapter makes. */
function stub(handlers: {registries?: unknown[]; taken?: boolean; groups?: string[]} = {}) {
    const calls: Call[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        calls.push({method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined})

        if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
        if (url.includes('/resourceGroups?')) {
            return json({value: (handlers.groups ?? ['rg-acr']).map((name) => ({name}))})
        }
        if (url.includes('checkNameAvailability')) {
            return json(
                handlers.taken
                    ? {nameAvailable: false, reason: 'AlreadyExists', message: 'The registry demoreg is already in use.'}
                    : {nameAvailable: true},
            )
        }
        if (method === 'DELETE') return new Response(null, {status: 202})
        if (method === 'PUT') return json(registry(), 201)
        if (url.includes('/registries/')) {
            const found = (handlers.registries ?? []).find((r) => (r as {id: string}).id && url.includes(`/registries/${(r as {name: string}).name}?`))
            return found ? json(found) : new Response('{}', {status: 404})
        }
        if (url.includes('/registries?')) return json({value: handlers.registries ?? []})
        return new Response('unexpected', {status: 500})
    }) as typeof fetch
    return calls
}

describe('AzureRegistryAdapter', () => {
    test('lists nothing as an empty array, not an error', async () => {
        stub()
        expect(await adapter().list()).toEqual([])
    })

    test('maps login server, sku and state and keys the id by resource group', async () => {
        stub({registries: [registry()]})
        const [item] = await adapter().list()

        expect(item.id).toBe('rg-acr/demoreg')
        expect(item.status).toBe('Succeeded')
        expect(item.createdAt).toBe('2026-10-30T00:04:32.950994Z')
        expect(item.metadata).toMatchObject({
            loginServer: 'localhost:5050/demoreg',
            sku: 'Standard',
            adminUserEnabled: true,
            resourceGroup: 'rg-acr',
        })
    })

    test('never calls the credential actions and drops any secret the registry body carries', async () => {
        const leaky = registry('demoreg', {
            username: 'demoreg',
            passwords: [{name: 'password', value: 'hunter2'}],
        })
        ;(leaky.properties as Record<string, unknown>).password = 'hunter2'
        const calls = stub({registries: [leaky]})

        const [listed] = await adapter().list()
        const inspected = await adapter().get('rg-acr/demoreg')

        expect(JSON.stringify([listed, inspected])).not.toContain('hunter2')
        expect(calls.some((call) => /listCredentials|regenerateCredential/i.test(call.url))).toBe(false)
    })

    test('filters by name', async () => {
        stub({registries: [registry('alphareg'), registry('betareg')]})
        const result = await adapter().list({search: 'BETA'})
        expect(result.map((r) => r.name)).toEqual(['betareg'])
    })

    test('get returns null for a registry the runtime does not know', async () => {
        stub()
        expect(await adapter().get('rg-acr/ghostreg')).toBeNull()
    })

    test('get rejects an id without a resource group', async () => {
        stub()
        await expect(adapter().get('demoreg')).rejects.toBeInstanceOf(ValidationError)
    })

    test('create checks the name, then PUTs the ARM body and reads the registry back', async () => {
        const calls = stub({registries: [registry()]})
        const created = await adapter().create({
            values: {name: 'demoreg', resourceGroup: 'RG-ACR', sku: 'Standard', adminUserEnabled: 'true'},
        })

        expect(created.id).toBe('rg-acr/demoreg')
        const order = calls.map((call) => `${call.method} ${call.url.includes('checkName') ? 'check' : call.url.includes('/registries/') ? 'registry' : 'other'}`)
        expect(order.indexOf('POST check')).toBeLessThan(order.indexOf('PUT registry'))
        expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
            location: 'eastus',
            sku: {name: 'Standard'},
            properties: {adminUserEnabled: true},
        })
    })

    test('a taken name surfaces the runtime message as a validation error and creates nothing', async () => {
        const calls = stub({taken: true})
        const attempt = adapter().create({values: {name: 'demoreg', resourceGroup: 'rg-acr'}})

        await expect(attempt).rejects.toBeInstanceOf(ValidationError)
        await expect(attempt).rejects.toThrow('already in use')
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test.each([
        ['a hyphenated name', {name: 'my-registry', resourceGroup: 'rg-acr'}],
        ['a short name', {name: 'abc', resourceGroup: 'rg-acr'}],
        ['an unknown sku', {name: 'demoreg', resourceGroup: 'rg-acr', sku: 'Gold'}],
        ['an unknown location', {name: 'demoreg', resourceGroup: 'rg-acr', location: 'mars'}],
        ['a missing resource group value', {name: 'demoreg'}],
    ])('create rejects %s before touching the runtime', async (_label, values) => {
        const calls = stub()
        await expect(adapter().create({values})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('create rejects a resource group the runtime does not have', async () => {
        const calls = stub({groups: ['other']})
        await expect(adapter().create({values: {name: 'demoreg', resourceGroup: 'rg-acr'}})).rejects.toThrow(
            'resource group rg-acr does not exist',
        )
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('delete issues a DELETE on the registry path', async () => {
        const calls = stub()
        await adapter().delete('rg-acr/demoreg')

        const call = calls.find((c) => c.method === 'DELETE')
        expect(call?.url).toContain(`/subscriptions/${SUB}/resourceGroups/rg-acr/providers/Microsoft.ContainerRegistry/registries/demoreg`)
    })
})
