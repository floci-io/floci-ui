import {afterEach, describe, expect, test} from 'bun:test'
import {AzureManagedIdentityAdapter} from './AzureManagedIdentityAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureManagedIdentityAdapter {
    return new AzureManagedIdentityAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

interface Call {
    method: string
    url: string
    body?: unknown
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function identity(name = 'app-identity', resourceGroup = 'rg-id') {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/${resourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${name}`,
        name,
        type: 'Microsoft.ManagedIdentity/userAssignedIdentities',
        location: 'eastus',
        tags: {team: 'platform'},
        properties: {
            tenantId: '00000000-0000-0000-0000-000000000002',
            principalId: 'f3c50168-9d04-4548-b820-fc57b3160227',
            clientId: '77216dd2-adc3-4ff0-b792-f6c0ad9c019c',
            // Not part of the real shape; proves the adapter copies only what it names.
            clientSecretUrl: 'http://localhost:4577/leaky',
        },
    }
}

function credential(name = 'github') {
    return {
        name,
        type: 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials',
        properties: {
            issuer: 'https://token.actions.githubusercontent.com',
            subject: 'repo:org/repo:ref:refs/heads/main',
            audiences: ['api://AzureADTokenExchange'],
        },
    }
}

/** Routes each request to what the runtime answers for it, recording what was sent. */
function runtimeStub(options: {identities?: unknown[]; credentials?: unknown[]; groups?: string[]} = {}) {
    const calls: Call[] = []
    const identities = [...(options.identities ?? [identity()])]
    const credentials = options.credentials ?? [credential()]
    const groups = options.groups ?? ['rg-id']

    globalThis.fetch = (async (input: string, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        calls.push({method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined})
        const path = url.replace(ENDPOINT, '')

        if (path === '/subscriptions') return json({value: [{subscriptionId: SUB}]})
        if (path.includes('/resourceGroups?')) return json({value: groups.map((name) => ({name}))})
        if (method === 'PUT') {
            const name = path.split('/userAssignedIdentities/')[1].split('?')[0]
            const saved = {...identity(name), location: (JSON.parse(String(init?.body)) as {location: string}).location}
            identities.push(saved)
            return json(saved, 201)
        }
        if (method === 'DELETE') return new Response(null, {status: 204})
        if (path.includes('/providers/Microsoft.ManagedIdentity/userAssignedIdentities?')) return json({value: identities})
        const found = identities.find((item) => path.includes(`/userAssignedIdentities/${(item as {name: string}).name}`))
        if (!found) return json({error: {code: 'ResourceNotFound'}}, 404)
        if (path.includes('/federatedIdentityCredentials?')) return json({value: credentials})
        return json(found)
    }) as unknown as typeof fetch
    return calls
}

describe('AzureManagedIdentityAdapter list and get', () => {
    test('lists identities with principal and client id', async () => {
        runtimeStub()
        const resources = await adapter().list()

        expect(resources).toHaveLength(1)
        expect(resources[0].id).toBe('rg-id/app-identity')
        expect(resources[0].type).toBe('user-assigned-identity')
        expect(resources[0].region).toBe('eastus')
        expect(resources[0].metadata.principalId).toBe('f3c50168-9d04-4548-b820-fc57b3160227')
        expect(resources[0].metadata.clientId).toBe('77216dd2-adc3-4ff0-b792-f6c0ad9c019c')
    })

    test('lists nothing when the runtime has no identities', async () => {
        runtimeStub({identities: []})
        expect(await adapter().list()).toEqual([])
    })

    test('filters by name', async () => {
        runtimeStub({identities: [identity('alpha'), identity('beta')]})
        const resources = await adapter().list({search: 'BET'})
        expect(resources.map((resource) => resource.name)).toEqual(['beta'])
    })

    test('inspect carries federated credentials and never the secret url', async () => {
        runtimeStub()
        const resource = await adapter().get('rg-id/app-identity')

        expect(resource?.metadata.federatedCredentials).toEqual([
            {
                name: 'github',
                issuer: 'https://token.actions.githubusercontent.com',
                subject: 'repo:org/repo:ref:refs/heads/main',
                audiences: ['api://AzureADTokenExchange'],
            },
        ])
        expect(JSON.stringify(resource)).not.toContain('leaky')
    })

    test('list does not fetch credentials', async () => {
        const calls = runtimeStub()
        await adapter().list()
        expect(calls.some((call) => call.url.includes('federatedIdentityCredentials'))).toBe(false)
    })

    test('a missing identity is null', async () => {
        runtimeStub({identities: []})
        expect(await adapter().get('rg-id/nope')).toBeNull()
    })

    test('rejects an id without a resource group', async () => {
        runtimeStub()
        await expect(adapter().get('app-identity')).rejects.toBeInstanceOf(ValidationError)
    })
})

describe('AzureManagedIdentityAdapter create and delete', () => {
    test('creates through a PUT and reads it back', async () => {
        const calls = runtimeStub({identities: []})
        const created = await adapter().create({values: {name: 'app-identity', resourceGroup: 'RG-ID', location: 'westus'}})

        const put = calls.find((call) => call.method === 'PUT')
        expect(put?.url).toContain(
            `/subscriptions/${SUB}/resourceGroups/rg-id/providers/Microsoft.ManagedIdentity/userAssignedIdentities/app-identity?api-version=2024-11-30`,
        )
        expect(put?.body).toEqual({location: 'westus'})
        expect(created.id).toBe('rg-id/app-identity')
        expect(created.region).toBe('westus')
    })

    test('falls back to the console location when none is given', async () => {
        const original = process.env.FLOCI_AZURE_LOCATION
        process.env.FLOCI_AZURE_LOCATION = 'westus'
        try {
            const calls = runtimeStub({identities: []})
            const created = await adapter().create({values: {name: 'app-identity', resourceGroup: 'rg-id'}})
            expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({location: 'westus'})
            expect(created.region).toBe('westus')
        } finally {
            if (original === undefined) delete process.env.FLOCI_AZURE_LOCATION
            else process.env.FLOCI_AZURE_LOCATION = original
        }
    })

    test('rejects an invalid name, location and missing fields', async () => {
        runtimeStub()
        await expect(adapter().create({values: {name: 'a', resourceGroup: 'rg-id'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {name: '-bad-name', resourceGroup: 'rg-id'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(
            adapter().create({values: {name: 'app-identity', resourceGroup: 'rg-id', location: 'mars'}}),
        ).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {name: 'app-identity'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('rejects a resource group that does not exist and sends no PUT', async () => {
        const calls = runtimeStub({groups: []})
        await expect(adapter().create({values: {name: 'app-identity', resourceGroup: 'ghost'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('deletes by resource group and name', async () => {
        const calls = runtimeStub()
        await adapter().delete('rg-id/app-identity')

        const del = calls.find((call) => call.method === 'DELETE')
        expect(del?.url).toContain('/resourceGroups/rg-id/providers/Microsoft.ManagedIdentity/userAssignedIdentities/app-identity?')
    })
})
