import {describe, expect, test} from 'bun:test'
import {AzureAppConfigAdapter} from './AzureAppConfigAdapter'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'
import {ConflictError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'

interface RecordedCall {
    method: string
    path: string
    body: unknown
    options: AzureRuntimeFetchOptions
}

type Responder = (call: RecordedCall) => Response | null

const BASE = '/devstoreaccount1-appconfig'
const V = 'api-version=2024-09-01'

describe('AzureAppConfigAdapter', () => {
    test('lists key-values across pages, detects feature flags and filters', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(({path}) => {
            if (path === `${BASE}/kv?${V}`) {
                return json({
                    items: [record('app/timeout', {label: 'prod', value: '30'})],
                    '@nextLink': `/kv?${V}&after=page-2`,
                })
            }
            if (path === `${BASE}/kv?${V}&after=page-2`) {
                return json({items: [flag('dark', true), record('web/title', {locked: true})]})
            }
            return null
        }, calls))

        const all = await adapter.list()
        expect(all.map((resource) => resource.id)).toEqual([
            'app%2Ftimeout|prod',
            '.appconfig.featureflag%2Fdark|',
            'web%2Ftitle|',
        ])
        expect(all[0]).toMatchObject({
            name: 'app/timeout',
            type: 'key-value',
            status: 'active',
            metadata: {label: 'prod', kind: 'key-value', value: '30', enabled: null, locked: false},
        })
        expect(all[1].metadata).toMatchObject({kind: 'feature-flag', enabled: true, enabledValue: 'true', label: null})
        expect(all[2]).toMatchObject({status: 'locked', metadata: {locked: true}})

        await expect(adapter.list({filters: {kind: 'feature-flag'}})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'WEB'})).resolves.toHaveLength(1)
        expect(calls.every((call) => call.options.includeStorageApiVersion === false)).toBe(true)
    })

    test('stops paging when the runtime echoes the current page as its nextLink', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(() => json({
            items: [record('a')],
            '@nextLink': `${BASE}/kv?${V}`,
        }), calls))

        await expect(adapter.list()).resolves.toHaveLength(1)
        expect(calls).toHaveLength(1)
    })

    test('inspect adds the revision history of the key and label', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(({path}) => {
            if (path.startsWith(`${BASE}/kv/`)) return json(record('app/timeout', {label: 'prod', value: '31'}))
            if (path.startsWith(`${BASE}/revisions`)) {
                return json({items: [record('app/timeout', {label: 'prod', value: '31'}), record('app/timeout', {label: 'prod', value: '30'})]})
            }
            return null
        }, calls))

        const resource = await adapter.get('app%2Ftimeout|prod')
        expect(resource?.metadata.revisions).toEqual([
            {etag: 'etag-1', lastModified: '2026-10-17T00:00:00Z', value: '31'},
            {etag: 'etag-1', lastModified: '2026-10-17T00:00:00Z', value: '30'},
        ])
        expect(calls.map((call) => call.path)).toEqual([
            `${BASE}/kv/app%2Ftimeout?${V}&label=prod`,
            `${BASE}/revisions?${V}&key=app%2Ftimeout&label=prod`,
        ])
    })

    test('inspect of an unlabelled key asks for the null label and a missing key is null', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(({path}) => {
            if (path.startsWith(`${BASE}/kv/missing`)) return new Response(null, {status: 404})
            if (path.startsWith(`${BASE}/kv/`)) return json(record('plain'))
            return json({items: []})
        }, calls))

        await adapter.get('plain|')
        expect(calls[1].path).toBe(`${BASE}/revisions?${V}&key=plain&label=%00`)
        await expect(adapter.get('missing|')).resolves.toBeNull()
    })

    test('creates a key-value with a label and content type', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(({method, body}) => method === 'GET'
            ? new Response(null, {status: 404})
            : json(record('web/title', {label: 'prod', value: (body as {value: string}).value})), calls))

        const created = await adapter.create({values: {
            kind: 'key-value', key: ' web/title ', label: 'prod', value: ' Hello ', contentType: 'text/plain',
        }})

        expect(created.id).toBe('web%2Ftitle|prod')
        expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT'])
        expect(calls[1]).toMatchObject({
            method: 'PUT',
            path: `${BASE}/kv/web%2Ftitle?${V}&label=prod`,
            body: {value: ' Hello ', content_type: 'text/plain'},
        })
    })

    test('creates a feature flag with the reserved prefix, content type and state', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(({method}) => method === 'GET'
            ? new Response(null, {status: 404})
            : json(flag('beta', true)), calls))

        await adapter.create({values: {kind: 'feature-flag', key: 'beta', enabled: 'true'}})

        const sent = calls[1].body as {value: string; content_type: string}
        expect(calls[1].path).toBe(`${BASE}/kv/.appconfig.featureflag%2Fbeta?${V}`)
        expect(sent.content_type).toBe('application/vnd.microsoft.appconfig.ff+json;charset=utf-8')
        expect(JSON.parse(sent.value)).toMatchObject({id: 'beta', enabled: true})
    })

    test('refuses to create over an existing key and label', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(() => json(record('web/title', {label: 'prod'})), calls))

        await expect(adapter.create({values: {kind: 'key-value', key: 'web/title', label: 'prod', value: 'x'}}))
            .rejects.toBeInstanceOf(ConflictError)
        expect(calls.map((call) => call.method)).toEqual(['GET'])
    })

    test('asks the runtime for a create-only write and names an empty response', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(({method}) => new Response(null, {status: method === 'GET' ? 404 : 200}), calls))

        await expect(adapter.create({values: {kind: 'key-value', key: 'a', value: 'x'}})).rejects.toBeInstanceOf(RuntimeError)
        expect(calls[1].method).toBe('PUT')
    })

    test('rejects a create without a key', async () => {
        const adapter = new AzureAppConfigAdapter(testClient(() => json({})))
        await expect(adapter.create({values: {kind: 'key-value', key: '  '}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('updates the value and keeps the existing tags', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(() => json(
            record('app/timeout', {label: 'prod', value: '30', tags: {env: 'prod'}, contentType: 'text/plain'}),
        ), calls))

        await adapter.update('app%2Ftimeout|prod', {values: {value: '45'}})

        expect(calls[1]).toMatchObject({
            method: 'PUT',
            body: {value: '45', content_type: 'text/plain', tags: {env: 'prod'}},
        })
    })

    test('toggles a feature flag by rewriting only its enabled state', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(() => json(flag('beta', true)), calls))

        await adapter.update('.appconfig.featureflag%2Fbeta|', {values: {enabled: 'false'}})

        const sent = calls[1].body as {value: string}
        expect(JSON.parse(sent.value)).toEqual({id: 'beta', enabled: false, conditions: {client_filters: []}})
    })

    test('refuses a state change on a plain key-value', async () => {
        const adapter = new AzureAppConfigAdapter(testClient(() => json(record('plain'))))
        await expect(adapter.update('plain|', {values: {enabled: 'true'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('refuses to update or delete a locked key-value and says why', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(() => json(record('app/timeout', {locked: true})), calls))

        await expect(adapter.update('app%2Ftimeout|', {values: {value: '1'}})).rejects.toThrow('locked')
        await expect(adapter.delete('app%2Ftimeout|')).rejects.toBeInstanceOf(ConflictError)
        expect(calls.every((call) => call.method === 'GET')).toBe(true)
    })

    test('maps a 423 from the runtime to a conflict', async () => {
        const adapter = new AzureAppConfigAdapter(testClient(({method}) => (
            method === 'GET' ? json(record('a')) : new Response(null, {status: 423})
        )))
        await expect(adapter.update('a|', {values: {value: '2'}})).rejects.toBeInstanceOf(ConflictError)
    })

    test('updating a missing key-value is not found', async () => {
        const adapter = new AzureAppConfigAdapter(testClient(() => new Response(null, {status: 404})))
        await expect(adapter.update('gone|', {values: {value: '2'}})).rejects.toBeInstanceOf(NotFoundError)
    })

    test('deletes with the label and decodes the composite id', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureAppConfigAdapter(testClient(({method}) => (
            method === 'GET' ? json(record('a b/c', {label: 'x y'})) : json(record('a b/c'))
        ), calls))

        await adapter.delete('a%20b%2Fc|x%20y')

        expect(calls[1]).toMatchObject({method: 'DELETE', path: `${BASE}/kv/a%20b%2Fc?${V}&label=x%20y`})
    })

    test('rejects an id that cannot be decoded as a validation error', async () => {
        const adapter = new AzureAppConfigAdapter(testClient(() => json({})))
        await expect(adapter.get('%zz|prod')).rejects.toBeInstanceOf(ValidationError)
    })

    test('inspect follows the revisions pages', async () => {
        const adapter = new AzureAppConfigAdapter(testClient(({path}) => {
            if (path.startsWith(`${BASE}/kv/`)) return json(record('k', {value: '3'}))
            if (path.includes('after=p2')) return json({items: [record('k', {value: '1'})]})
            return json({items: [record('k', {value: '3'}), record('k', {value: '2'})], '@nextLink': `/revisions?${V}&key=k&label=%00&after=p2`})
        }))

        const resource = await adapter.get('k|')
        expect((resource?.metadata.revisions as {value: string}[]).map((revision) => revision.value)).toEqual(['3', '2', '1'])
    })

    test('rejects an id without a label separator', async () => {
        const adapter = new AzureAppConfigAdapter(testClient(() => json({})))
        await expect(adapter.get('no-separator')).rejects.toBeInstanceOf(ValidationError)
    })
})

function record(
    key: string,
    options: {label?: string; value?: string; locked?: boolean; tags?: Record<string, string>; contentType?: string} = {},
) {
    return {
        key,
        label: options.label ?? null,
        value: options.value ?? 'v',
        content_type: options.contentType ?? null,
        tags: options.tags ?? {},
        etag: 'etag-1',
        last_modified: '2026-10-17T00:00:00Z',
        locked: options.locked ?? false,
    }
}

function flag(id: string, enabled: boolean) {
    return {
        ...record(`.appconfig.featureflag/${id}`, {
            value: JSON.stringify({id, enabled, conditions: {client_filters: []}}),
            contentType: 'application/vnd.microsoft.appconfig.ff+json;charset=utf-8',
        }),
    }
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
}

function testClient(responder: Responder, calls: RecordedCall[] = []): AzureRuntimeClient {
    return {
        endpoint: 'http://localhost:4577',
        accountName: 'devstoreaccount1',
        async fetch(path: string, init: RequestInit, options: AzureRuntimeFetchOptions = {}) {
            const call: RecordedCall = {
                method: init.method ?? 'GET',
                path,
                body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
                options,
            }
            calls.push(call)
            const res = responder(call)
            if (!res) {
                if (options.emptyOnNotFound) return null
                throw new Error(`Unexpected App Configuration path: ${path}`)
            }
            if (res.status === 404 && options.emptyOnNotFound) return null
            return res
        },
    }
}
