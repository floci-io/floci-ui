import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'
import {ConflictError, RuntimeError, toHttpError, ValidationError} from '../cloud-spi/errors'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {createCloudRoutes} from '../routes/clouds'
import {CloudProxyService} from '../service/CloudProxyService'
import {AzureTableAdapter} from './AzureTableAdapter'

interface RecordedCall {
    path: string
    init: RequestInit
    options?: AzureRuntimeFetchOptions
}

describe('AzureTableAdapter', () => {
    test('lists tables through the Azure Table REST endpoint', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            return jsonResponse({value: [{TableName: 'Orders'}, {TableName: 'AuditLog'}]})
        })

        const resources = await new AzureTableAdapter(client).list({search: 'audit'})

        expect(calls).toEqual([{
            path: '/devstoreaccount1-table/Tables',
            init: {method: 'GET', headers: {accept: 'application/json'}},
            options: undefined,
        }])
        expect(resources).toEqual([{
            id: 'AuditLog',
            name: 'AuditLog',
            cloud: 'azure',
            service: 'table',
            type: 'table',
            region: null,
            createdAt: null,
            metadata: {provider: 'azure', storageService: 'table', accountName: 'devstoreaccount1'},
        }])
    })

    test('preserves an empty table list', async () => {
        const client = testClient(async () => jsonResponse({value: []}))

        await expect(new AzureTableAdapter(client).list()).resolves.toEqual([])
    })

    test('follows Azure table continuation headers for listing and inspection', async () => {
        const paths: string[] = []
        const client = testClient(async (path) => {
            paths.push(path)
            if (path === '/devstoreaccount1-table/Tables') {
                return new Response(JSON.stringify({value: [{TableName: 'Orders'}]}), {
                    headers: {'x-ms-continuation-NextTableName': 'next/a+b'},
                })
            }
            if (path === '/devstoreaccount1-table/Tables?NextTableName=next%2Fa%2Bb') {
                return jsonResponse({value: [{TableName: 'AuditLog'}]})
            }
            throw new Error(`Unexpected table request: ${path}`)
        })
        const adapter = new AzureTableAdapter(client)

        await expect(adapter.list({search: 'audit'})).resolves.toMatchObject([{id: 'AuditLog'}])
        expect((await adapter.get('AuditLog'))?.id).toBe('AuditLog')
        expect(paths).toEqual([
            '/devstoreaccount1-table/Tables',
            '/devstoreaccount1-table/Tables?NextTableName=next%2Fa%2Bb',
            '/devstoreaccount1-table/Tables',
            '/devstoreaccount1-table/Tables?NextTableName=next%2Fa%2Bb',
        ])
    })

    test('rejects repeated Azure table continuation tokens', async () => {
        let calls = 0
        const client = testClient(async () => {
            calls += 1
            if (calls > 2) throw new Error('unexpected third table page')
            return new Response(JSON.stringify({value: []}), {
                headers: {'x-ms-continuation-NextTableName': 'repeat'},
            })
        })

        await expect(new AzureTableAdapter(client).list()).rejects.toThrow('repeated a continuation token')
        expect(calls).toBe(2)
    })

    test('does not truncate a valid table listing after 100 pages', async () => {
        let calls = 0
        const client = testClient(async () => {
            calls += 1
            return new Response(JSON.stringify({value: [{TableName: `Table${calls}`}]}), {
                headers: calls < 101 ? {'x-ms-continuation-NextTableName': `page-${calls + 1}`} : {},
            })
        })

        const resources = await new AzureTableAdapter(client).list()
        expect(resources).toHaveLength(101)
        expect(resources.at(-1)?.id).toBe('Table101')
        expect(calls).toBe(101)
    })

    test('gets a table from the listing and reports missing tables as null', async () => {
        const client = testClient(async () => jsonResponse({value: [{TableName: 'Orders'}]}))
        const adapter = new AzureTableAdapter(client)

        expect((await adapter.get('Orders'))?.id).toBe('Orders')
        await expect(adapter.get('Missing')).resolves.toBeNull()
    })

    test('creates a table using the Azure Table REST payload', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            return jsonResponse({TableName: 'Orders'}, 201)
        })

        const resource = await new AzureTableAdapter(client).create({values: {tableName: ' Orders '}})

        expect(calls).toEqual([{
            path: '/devstoreaccount1-table/Tables',
            init: {
                method: 'POST',
                body: '{"TableName":"Orders"}',
                headers: {accept: 'application/json', 'content-type': 'application/json'},
            },
            options: undefined,
        }])
        expect(resource.id).toBe('Orders')
    })

    test('rejects invalid table names without calling the runtime', async () => {
        let calls = 0
        const client = testClient(async () => {
            calls += 1
            return jsonResponse({TableName: 'Orders'})
        })
        const adapter = new AzureTableAdapter(client)

        for (const tableName of ['', 'ab', '9Orders', 'order-items', 'a'.repeat(64)]) {
            const error = await adapter.create({values: {tableName}}).catch((failure: unknown) => failure)
            expect(error).toBeInstanceOf(ValidationError)
            expect(toHttpError(error).status).toBe(400)
        }
        expect(calls).toBe(0)
    })

    test('deletes a table through the OData resource path', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            return new Response(null, {status: 204})
        })

        await new AzureTableAdapter(client).delete('Orders')

        expect(calls).toEqual([{
            path: "/devstoreaccount1-table/Tables('Orders')",
            init: {method: 'DELETE'},
            options: undefined,
        }])
    })

    test('does not hide malformed table listings or runtime conflicts', async () => {
        const malformed = new AzureTableAdapter(testClient(async () => jsonResponse({tables: []})))
        await expect(malformed.list()).rejects.toBeInstanceOf(RuntimeError)

        const conflict = new AzureTableAdapter(testClient(async () => {
            throw new ConflictError('TableAlreadyExists')
        }))
        await expect(conflict.create({values: {tableName: 'Orders'}})).rejects.toBeInstanceOf(ConflictError)
    })

    test('serves catalog, schema, and table CRUD through the generic cloud routes', async () => {
        const tables = new Set<string>()
        const client = testClient(async (path, init) => {
            if (path === '/devstoreaccount1-table/Tables' && init.method === 'GET') {
                return jsonResponse({value: [...tables].map((TableName) => ({TableName}))})
            }
            if (path === '/devstoreaccount1-table/Tables' && init.method === 'POST') {
                const {TableName} = JSON.parse(String(init.body)) as {TableName: string}
                tables.add(TableName)
                return jsonResponse({TableName}, 201)
            }
            if (path === "/devstoreaccount1-table/Tables('Orders')" && init.method === 'DELETE') {
                tables.delete('Orders')
                return new Response(null, {status: 204})
            }
            throw new Error(`Unexpected Table Storage request: ${init.method} ${path}`)
        })
        const registry = new CloudAdapterRegistry([new AzureTableAdapter(client)])
        const app = new Hono()
        app.route('/api/clouds', createCloudRoutes(new CloudProxyService(registry)))
        const base = '/api/clouds/azure/services'

        const nav = await app.request(base)
        expect(nav.status).toBe(200)
        expect((await nav.json() as Array<{service: string; availability: string}>).find((item) => item.service === 'table'))
            .toMatchObject({availability: 'available'})

        const schema = await app.request(`${base}/table/schema`)
        expect(schema.status).toBe(200)
        expect(await schema.json()).toMatchObject({service: 'table', actions: ['list', 'create', 'delete', 'inspect']})

        const resources = `${base}/table/resources`
        const invalid = await app.request(resources, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: 'null',
        })
        expect(invalid.status).toBe(400)

        const created = await app.request(resources, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({tableName: 'Orders'}),
        })
        expect(created.status).toBe(201)
        expect(await created.json()).toMatchObject({id: 'Orders'})

        const list = await app.request(resources)
        expect(list.status).toBe(200)
        expect(await list.json()).toMatchObject([{id: 'Orders'}])

        const get = await app.request(`${resources}/Orders`)
        expect(get.status).toBe(200)
        expect(await get.json()).toMatchObject({id: 'Orders'})

        const deleted = await app.request(`${resources}/Orders`, {method: 'DELETE'})
        expect(deleted.status).toBe(200)
        expect(await deleted.json()).toEqual({ok: true})
        expect((await app.request(`${resources}/Orders`)).status).toBe(404)
    })
})

function testClient(
    handler: (path: string, init: RequestInit, options?: AzureRuntimeFetchOptions) => Promise<Response | null>,
): AzureRuntimeClient {
    return {
        endpoint: 'http://localhost:4577',
        accountName: 'devstoreaccount1',
        fetch: handler,
    }
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}})
}
