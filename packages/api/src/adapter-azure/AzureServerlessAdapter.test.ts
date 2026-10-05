import {describe, expect, test} from 'bun:test'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'
import {AzureServerlessAdapter} from './AzureServerlessAdapter'

interface RecordedCall {
    path: string
    init: RequestInit
    options?: AzureRuntimeFetchOptions
}

const BASE = '/devstoreaccount1-functions'
const ZIP_BASE64 = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(20).fill(0)]).toString('base64')

const appRecord = (name: string, runtime = 'node') => ({
    name, runtime, status: 'Running', createdAt: '2026-10-04T14:57:57.459Z',
})

const functionRecord = (appName: string, name: string, status = 'AwaitingDeploy') => ({
    name, appName, runtime: 'node', handler: 'index.handler', timeoutSeconds: 30, status,
    invokeUrl: `http://localhost:4577${BASE}/api/${appName}/${name}`,
    createdAt: '2026-10-04T14:57:57.626Z',
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status})

function testClient(
    handler: (path: string, init: RequestInit, options?: AzureRuntimeFetchOptions) => Promise<Response | null>,
): {client: AzureRuntimeClient; calls: RecordedCall[]} {
    const calls: RecordedCall[] = []
    return {
        calls,
        client: {
            endpoint: 'http://localhost:4577',
            accountName: 'devstoreaccount1',
            fetch: async (path, init, options) => {
                calls.push({path, init, options})
                return handler(path, init, options)
            },
        },
    }
}

/** A runtime where `apps` exist and `functions` are keyed by `app/function`. */
function runtime(apps: string[], functions: Array<[string, string]> = []) {
    return testClient(async (path, init, options) => {
        const method = init.method ?? 'GET'
        const found = (record: unknown) => (record ? json(record) : options?.emptyOnNotFound ? null : json({Code: 'NotFound'}, 404))
        if (path === `${BASE}/admin/apps`) return json({value: apps.map((app) => appRecord(app))})
        const fnList = path.match(/\/admin\/apps\/([^/]+)\/functions$/)
        if (fnList) return json({value: functions.filter(([app]) => app === fnList[1]).map(([app, fn]) => functionRecord(app, fn))})
        const fnOne = path.match(/\/admin\/apps\/([^/]+)\/functions\/([^/]+)$/)
        if (fnOne) {
            const exists = functions.some(([app, fn]) => app === fnOne[1] && fn === fnOne[2])
            if (method === 'PUT') return json(functionRecord(fnOne[1], fnOne[2]), 201)
            if (method === 'DELETE') return new Response(null, {status: 204})
            return found(exists ? functionRecord(fnOne[1], fnOne[2]) : null)
        }
        const appOne = path.match(/\/admin\/apps\/([^/]+)$/)
        if (appOne) {
            if (method === 'PUT') return json(appRecord(appOne[1]), 201)
            if (method === 'DELETE') return new Response(null, {status: 204})
            return found(apps.includes(appOne[1]) ? appRecord(appOne[1]) : null)
        }
        throw new Error(`unexpected ${method} ${path}`)
    })
}

describe('AzureServerlessAdapter', () => {
    test('lists apps and their functions as one table', async () => {
        const {client, calls} = runtime(['shop', 'blog'], [['shop', 'checkout'], ['blog', 'render']])
        const resources = await new AzureServerlessAdapter(client).list()

        expect(resources.map((r) => [r.id, r.type, r.metadata.kind])).toEqual([
            ['shop', 'azure-function-app', 'app'],
            ['blog', 'azure-function-app', 'app'],
            ['shop/checkout', 'azure-function', 'function'],
            ['blog/render', 'azure-function', 'function'],
        ])
        expect(resources[2]).toMatchObject({
            name: 'checkout', cloud: 'azure', service: 'serverless', status: 'AwaitingDeploy',
            metadata: {appName: 'shop', handler: 'index.handler', timeoutSeconds: 30},
        })
        expect(calls[0].path).toBe(`${BASE}/admin/apps`)
        expect(calls[0].options).toBeUndefined()
    })

    test('filters by kind and search', async () => {
        const {client} = runtime(['shop', 'blog'], [['shop', 'checkout']])
        const adapter = new AzureServerlessAdapter(client)

        expect((await adapter.list({filters: {kind: 'app'}})).map((r) => r.id)).toEqual(['shop', 'blog'])
        expect((await adapter.list({filters: {kind: 'function'}})).map((r) => r.id)).toEqual(['shop/checkout'])
        expect((await adapter.list({search: 'CHECK'})).map((r) => r.id)).toEqual(['shop/checkout'])
        await expect(adapter.list({filters: {kind: 'bogus'}})).rejects.toMatchObject({status: 400})
    })

    test('an empty runtime lists nothing', async () => {
        expect(await new AzureServerlessAdapter(runtime([]).client).list()).toEqual([])
    })

    test('surfaces an unavailable apps endpoint instead of an empty list', async () => {
        const {client} = testClient(async () => { throw Object.assign(new Error('HTTP 404'), {status: 404}) })
        await expect(new AzureServerlessAdapter(client).list()).rejects.toThrow('HTTP 404')
    })

    test('an app deleted between the two list calls contributes no functions', async () => {
        const {client} = testClient(async (path, _init, options) =>
            path.endsWith('/admin/apps') ? json({value: [appRecord('gone')]}) : options?.emptyOnNotFound ? null : json({}, 404))
        const resources = await new AzureServerlessAdapter(client).list()
        expect(resources.map((r) => r.id)).toEqual(['gone'])
    })

    test('one app failing to list its functions does not hide the rest', async () => {
        const {client} = testClient(async (path) => {
            if (path.endsWith('/admin/apps')) return json({value: [appRecord('shop'), appRecord('broken')]})
            if (path.includes('/broken/')) throw Object.assign(new Error('HTTP 500'), {status: 500})
            return json({value: [functionRecord('shop', 'checkout')]})
        })
        const resources = await new AzureServerlessAdapter(client).list()
        expect(resources.map((r) => r.id)).toEqual(['shop', 'broken', 'shop/checkout'])
    })

    test('every app failing to list its functions is surfaced as an error', async () => {
        const {client} = testClient(async (path) => {
            if (path.endsWith('/admin/apps')) return json({value: [appRecord('a'), appRecord('b')]})
            throw Object.assign(new Error('HTTP 500'), {status: 500})
        })
        await expect(new AzureServerlessAdapter(client).list()).rejects.toThrow('HTTP 500')
    })

    test('concurrent creates of the same function: one wins, the other conflicts and nothing is overwritten', async () => {
        const deployed = new Set<string>()
        let puts = 0
        const {client} = testClient(async (path, init, options) => {
            const method = init.method ?? 'GET'
            const key = path.split('/functions/')[1]
            if (method === 'GET') return deployed.has(key) ? json(functionRecord('shop', key)) : options?.emptyOnNotFound ? null : json({}, 404)
            puts += 1
            await new Promise((resolve) => setTimeout(resolve, 20))
            deployed.add(key)
            return json(functionRecord('shop', key), 201)
        })
        const adapter = new AzureServerlessAdapter(client)
        const values = {appName: 'shop', functionName: 'race', zipBase64: ZIP_BASE64}
        const settled = await Promise.allSettled([adapter.create({values}), adapter.create({values}), adapter.create({values})])

        expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        expect(settled.filter((r) => r.status === 'rejected' && (r.reason as {status?: number}).status === 409)).toHaveLength(2)
        expect(puts).toBe(1)
    })

    test('concurrent creates of the same app: one wins, the other conflicts', async () => {
        const apps = new Set<string>()
        const {client} = testClient(async (path, init, options) => {
            const name = path.split('/admin/apps/')[1]
            if ((init.method ?? 'GET') === 'GET') return apps.has(name) ? json(appRecord(name)) : options?.emptyOnNotFound ? null : json({}, 404)
            await new Promise((resolve) => setTimeout(resolve, 20))
            apps.add(name)
            return json(appRecord(name), 201)
        })
        const adapter = new AzureServerlessAdapter(client)
        const values = {resourceType: 'app', appName: 'shop', runtime: 'node'}
        const settled = await Promise.allSettled([adapter.create({values}), adapter.create({values})])

        expect(settled.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    })

    test('gets an app and a function, null when missing', async () => {
        const {client, calls} = runtime(['shop'], [['shop', 'checkout']])
        const adapter = new AzureServerlessAdapter(client)

        expect((await adapter.get('shop'))?.type).toBe('azure-function-app')
        expect((await adapter.get('shop/checkout'))?.id).toBe('shop/checkout')
        expect(await adapter.get('shop/missing')).toBeNull()
        expect(await adapter.get('nope')).toBeNull()
        expect(calls[1].path).toBe(`${BASE}/admin/apps/shop/functions/checkout`)
        expect(calls[1].options).toEqual({emptyOnNotFound: true})
        await expect(adapter.get('a/b/c')).rejects.toMatchObject({status: 404})
    })

    test('creates an app with the requested runtime', async () => {
        const {client, calls} = runtime([])
        const created = await new AzureServerlessAdapter(client).create({
            values: {resourceType: 'app', appName: 'shop', runtime: 'python', linuxFxVersion: 'Python|3.12'},
        })

        expect(created).toMatchObject({id: 'shop', type: 'azure-function-app', status: 'Running'})
        const put = calls.find((c) => c.init.method === 'PUT')
        expect(put?.path).toBe(`${BASE}/admin/apps/shop`)
        expect(JSON.parse(String(put?.init.body))).toEqual({runtime: 'python', linuxFxVersion: 'Python|3.12'})
    })

    test('refuses to replace an existing app or function', async () => {
        const {client, calls} = runtime(['shop'], [['shop', 'checkout']])
        const adapter = new AzureServerlessAdapter(client)

        await expect(adapter.create({values: {resourceType: 'app', appName: 'shop', runtime: 'node'}}))
            .rejects.toMatchObject({status: 409})
        await expect(adapter.create({values: {resourceType: 'function', appName: 'shop', functionName: 'checkout'}}))
            .rejects.toMatchObject({status: 409})
        expect(calls.map((c) => c.init.method)).not.toContain('PUT')
    })

    test('creates a function with handler, timeout and package, defaulting to a function', async () => {
        const {client, calls} = runtime(['shop'])
        const created = await new AzureServerlessAdapter(client).create({
            values: {appName: 'shop', functionName: 'checkout', handler: 'main.run', timeoutSeconds: '30', zipBase64: `${ZIP_BASE64}\n`},
        })

        expect(created).toMatchObject({id: 'shop/checkout', type: 'azure-function'})
        const put = calls.find((c) => c.init.method === 'PUT')
        expect(put?.path).toBe(`${BASE}/admin/apps/shop/functions/checkout`)
        expect(JSON.parse(String(put?.init.body))).toEqual({handler: 'main.run', timeoutSeconds: 30, zipBase64: ZIP_BASE64})
    })

    test('creating a function in a missing app surfaces the runtime 404', async () => {
        const {client} = testClient(async (_path, init, options) => {
            if ((init.method ?? 'GET') === 'GET') return options?.emptyOnNotFound ? null : json({}, 404)
            throw Object.assign(new Error('AppNotFound'), {status: 404})
        })
        await expect(new AzureServerlessAdapter(client).create({values: {appName: 'nope', functionName: 'fn'}}))
            .rejects.toMatchObject({status: 404})
    })

    test('rejects invalid input before calling the runtime', async () => {
        const {client, calls} = runtime([])
        const adapter = new AzureServerlessAdapter(client)
        const bad = (values: Record<string, unknown>) => expect(adapter.create({values})).rejects.toMatchObject({status: 400})

        await bad({resourceType: 'queue'})
        await bad({resourceType: 'app', appName: '', runtime: 'node'})
        await bad({resourceType: 'app', appName: '-bad-', runtime: 'node'})
        await bad({resourceType: 'app', appName: 'shop', runtime: 'cobol'})
        await bad({resourceType: 'app', appName: 'shop'})
        await bad({appName: 'shop', functionName: ''})
        await bad({appName: 'shop', functionName: 'a/b'})
        await bad({appName: 'shop', functionName: 'fn', timeoutSeconds: '0'})
        await bad({appName: 'shop', functionName: 'fn', timeoutSeconds: '9'.repeat(400)})
        await bad({appName: 'shop', functionName: 'fn', timeoutSeconds: '2147483648'})
        await bad({appName: 'shop', functionName: 'fn', zipBase64: 'UEs='})
        await bad({appName: 'shop', functionName: 'fn', zipBase64: 'not base64!'})
        await bad({appName: 'shop', functionName: 'fn', zipBase64: Buffer.from('plain text').toString('base64')})
        expect(calls).toHaveLength(0)
    })

    test('deletes an app or a function', async () => {
        const {client, calls} = runtime(['shop'], [['shop', 'checkout']])
        const adapter = new AzureServerlessAdapter(client)

        await adapter.delete('shop/checkout')
        await adapter.delete('shop')
        expect(calls.map((c) => [c.init.method, c.path])).toEqual([
            ['DELETE', `${BASE}/admin/apps/shop/functions/checkout`],
            ['DELETE', `${BASE}/admin/apps/shop`],
        ])
    })

    test('invoke posts the payload to the app/function route and keeps the status in band', async () => {
        const {client, calls} = testClient(async () => new Response('{"ok":true}', {status: 200}))
        const result = await new AzureServerlessAdapter(client).invoke('shop/checkout', '{"a":1}')

        expect(result).toMatchObject({statusCode: 200, payload: '{"ok":true}'})
        expect(result.functionError).toBeUndefined()
        expect(calls[0].path).toBe(`${BASE}/api/shop/checkout`)
        expect(calls[0].init.method).toBe('POST')
        expect(calls[0].init.body).toBe('{"a":1}')
        expect(calls[0].options).toEqual({allowErrorStatus: true, includeStorageApiVersion: false})
    })

    test('invoke reports a runtime or function failure as a result and sends {} for a blank payload', async () => {
        const body = '{"Code":"FunctionCodeNotDeployed","Message":"No code has been deployed"}'
        const {client, calls} = testClient(async () => new Response(body, {status: 409}))
        const result = await new AzureServerlessAdapter(client).invoke('shop/checkout', '  ')

        expect(result).toMatchObject({statusCode: 409, payload: body, functionError: 'Function returned HTTP 409'})
        expect(calls[0].init.body).toBe('{}')
    })

    test('invoke refuses an app id', async () => {
        const {client, calls} = testClient(async () => json({}))
        await expect(new AzureServerlessAdapter(client).invoke('shop', '{}')).rejects.toMatchObject({status: 400})
        expect(calls).toHaveLength(0)
    })

    test('schema advertises invoke', () => {
        const adapter = new AzureServerlessAdapter(runtime([]).client)
        expect(adapter.schema().capabilities?.resourceActions?.find((a) => a.name === 'invoke')?.status).toBe('available')
    })
})
