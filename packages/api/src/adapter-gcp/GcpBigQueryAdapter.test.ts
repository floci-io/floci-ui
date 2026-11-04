import {afterEach, describe, expect, test} from 'bun:test'
import {GcpBigQueryAdapter} from './GcpBigQueryAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {ConflictError, NotFoundError, RuntimeError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const DATASETS = '/bigquery/v2/projects/floci-local/datasets'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpBigQueryAdapter {
    return new GcpBigQueryAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

type Call = {path: string; method: string; body: unknown}

function stubFetch(handler: (path: string, init?: RequestInit) => Response) {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const path = String(url).replace(ENDPOINT, '')
        calls.push({path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined})
        return handler(path, init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
}

function noContent(): Response {
    return new Response(null, {status: 204})
}

function notFound(message = 'Not found: Dataset floci-local:nope'): Response {
    return json({error: {code: 404, message, status: 'NOT_FOUND'}}, 404)
}

/** Shapes captured from floci/floci-gcp 0.12.0. */
function dataset(id = 'sales', overrides: Record<string, unknown> = {}) {
    return {
        kind: 'bigquery#dataset',
        id: `floci-local:${id}`,
        datasetReference: {projectId: 'floci-local', datasetId: id},
        location: 'US',
        creationTime: '1793720726660',
        lastModifiedTime: '1793720726660',
        type: 'DEFAULT',
        maxTimeTravelHours: '168',
        ...overrides,
    }
}

function table(name = 'orders', parent = 'sales', overrides: Record<string, unknown> = {}) {
    return {
        kind: 'bigquery#table',
        id: `floci-local:${parent}.${name}`,
        tableReference: {projectId: 'floci-local', datasetId: parent, tableId: name},
        type: 'TABLE',
        schema: {
            fields: [
                {name: 'id', type: 'INTEGER', mode: 'REQUIRED'},
                {name: 'item', type: 'STRING', mode: 'NULLABLE'},
            ],
        },
        numRows: '2',
        creationTime: '1793720823646',
        lastModifiedTime: '1793720823686',
        location: 'US',
        ...overrides,
    }
}

/** Routes the dataset and table lists the way the runtime does. */
function runtime(options: {datasets?: unknown[]; tables?: Record<string, unknown[]>} = {}) {
    const datasets = options.datasets ?? []
    const tables = options.tables ?? {}
    return stubFetch((path) => {
        if (path === DATASETS) return json(datasets.length ? {kind: 'bigquery#datasetList', datasets} : {kind: 'bigquery#datasetList'})
        const match = path.match(/\/datasets\/([^/?]+)\/tables$/)
        if (match) return json({kind: 'bigquery#tableList', tables: tables[match[1]] ?? [], totalItems: tables[match[1]]?.length ?? 0})
        return notFound()
    })
}

describe('GcpBigQueryAdapter', () => {
    test('advertises list, create, inspect and delete for the gcp analytics service', () => {
        const schema = adapter().schema()
        expect(schema.cloud).toBe('gcp')
        expect(schema.service).toBe('analytics')
        expect(schema.actions).toEqual(['list', 'create', 'inspect', 'delete'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual([
            'list',
            'create',
            'inspect',
            'delete',
        ])
    })

    test('returns an empty list when there are no datasets', async () => {
        const calls = runtime()
        expect(await adapter().list()).toEqual([])
        expect(calls.map((call) => call.path)).toEqual([DATASETS])
    })

    test('lists datasets and the tables under them', async () => {
        runtime({
            datasets: [dataset('sales'), dataset('ops')],
            tables: {sales: [table('orders'), table('items')], ops: [table('audit', 'ops')]},
        })

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['sales', 'ops', 'sales/orders', 'sales/items', 'ops/audit'])
        expect(resources[0]).toMatchObject({
            name: 'sales',
            type: 'dataset',
            service: 'analytics',
            cloud: 'gcp',
            region: 'US',
            createdAt: new Date(1793720726660).toISOString(),
            metadata: {location: 'US', maxTimeTravelHours: 168, resourcePath: 'floci-local:sales'},
        })
        expect(resources[2]).toMatchObject({
            name: 'orders',
            type: 'table',
            createdAt: new Date(1793720823646).toISOString(),
            metadata: {dataset: 'sales', tableType: 'TABLE', numRows: 2},
        })
    })

    test('filters by search across datasets and tables, case insensitively', async () => {
        runtime({datasets: [dataset('sales')], tables: {sales: [table('Orders'), table('items')]}})

        const resources = await adapter().list({search: 'ORD'})

        expect(resources.map((resource) => resource.id)).toEqual(['sales/Orders'])
    })

    test('follows nextPageToken for datasets and tables', async () => {
        const calls = stubFetch((path) => {
            if (path === DATASETS) return json({datasets: [dataset('a')], nextPageToken: 'd2'})
            if (path === `${DATASETS}?pageToken=d2`) return json({datasets: [dataset('b')]})
            if (path === `${DATASETS}/a/tables`) return json({tables: [table('t1', 'a')], nextPageToken: 't2'})
            if (path === `${DATASETS}/a/tables?pageToken=t2`) return json({tables: [table('t2', 'a')]})
            if (path === `${DATASETS}/b/tables`) return json({})
            return notFound()
        })

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['a', 'b', 'a/t1', 'a/t2'])
        expect(calls).toHaveLength(5)
    })

    test('refuses a partial list when the runtime never stops paging', async () => {
        stubFetch(() => json({datasets: [dataset('a')], nextPageToken: 'again'}))
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('fails the whole list when one dataset cannot list its tables', async () => {
        stubFetch((path) => {
            if (path === DATASETS) return json({datasets: [dataset('a'), dataset('b')]})
            if (path === `${DATASETS}/a/tables`) return json({tables: []})
            return json({error: {code: 500, message: 'boom', status: 'INTERNAL'}}, 500)
        })
        await expect(adapter().list()).rejects.toThrow('boom')
    })

    test('get returns a dataset, a table with its schema and row count, or null', async () => {
        stubFetch((path) => {
            if (path === `${DATASETS}/sales`) return json(dataset('sales'))
            if (path === `${DATASETS}/sales/tables/orders`) return json(table('orders'))
            return notFound()
        })

        expect((await adapter().get('sales'))?.type).toBe('dataset')
        const inspected = await adapter().get('sales/orders')
        expect(inspected).toMatchObject({type: 'table', metadata: {numRows: 2}})
        expect(inspected?.metadata.schema).toEqual([
            {name: 'id', type: 'INTEGER', mode: 'REQUIRED'},
            {name: 'item', type: 'STRING', mode: 'NULLABLE'},
        ])
        expect(await adapter().get('nope')).toBeNull()
        expect(await adapter().get('sales/nope')).toBeNull()
        expect(await adapter().get('a/b/c')).toBeNull()
    })

    test('creates a dataset in the configured project, leaving the location to the runtime', async () => {
        const calls = stubFetch(() => json(dataset('sales')))

        const created = await adapter().create({values: {resourceType: 'dataset', datasetName: ' sales '}})

        expect(created).toMatchObject({id: 'sales', type: 'dataset'})
        expect(calls[0]).toEqual({
            path: DATASETS,
            method: 'POST',
            body: {datasetReference: {projectId: 'floci-local', datasetId: 'sales'}},
        })
    })

    test('creates a table from the name:TYPE shorthand', async () => {
        const calls = stubFetch(() => json(table('orders')))

        const created = await adapter().create({
            values: {resourceType: 'table', dataset: 'sales', tableName: 'orders', schema: 'id:integer, item : STRING'},
        })

        expect(created).toMatchObject({id: 'sales/orders', type: 'table'})
        expect(calls[0]).toEqual({
            path: `${DATASETS}/sales/tables`,
            method: 'POST',
            body: {
                tableReference: {projectId: 'floci-local', datasetId: 'sales', tableId: 'orders'},
                schema: {
                    fields: [
                        {name: 'id', type: 'INTEGER'},
                        {name: 'item', type: 'STRING'},
                    ],
                },
            },
        })
    })

    test('rejects invalid input before any request', async () => {
        const calls = stubFetch(() => json({}))
        const bad = (values: Record<string, unknown>) => adapter().create({values})

        await expect(bad({resourceType: 'view', datasetName: 'a'})).rejects.toBeInstanceOf(ValidationError)
        await expect(bad({resourceType: 'dataset'})).rejects.toThrow('datasetName is required')
        await expect(bad({resourceType: 'dataset', datasetName: 'my-dataset'})).rejects.toThrow('letters, numbers, or underscores')
        await expect(bad({resourceType: 'table', tableName: 't', schema: 'a:STRING'})).rejects.toThrow('dataset is required')
        await expect(bad({resourceType: 'table', dataset: 'd', tableName: 't'})).rejects.toThrow('schema is required')
        await expect(bad({resourceType: 'table', dataset: 'd', tableName: 't', schema: 'a'})).rejects.toThrow('is not name:TYPE')
        await expect(bad({resourceType: 'table', dataset: 'd', tableName: 't', schema: 'a:STRING:x'})).rejects.toThrow('is not name:TYPE')
        await expect(bad({resourceType: 'table', dataset: 'd', tableName: 't', schema: 'a:TEXT'})).rejects.toThrow('unknown type "TEXT"')
        await expect(bad({resourceType: 'table', dataset: 'd', tableName: 't', schema: '1a:STRING'})).rejects.toThrow('must start with a letter')
        await expect(bad({resourceType: 'table', dataset: 'd', tableName: 't', schema: 'a:STRING,A:INT64'})).rejects.toThrow('listed twice')
        expect(calls).toHaveLength(0)
    })

    test('maps a duplicate to a conflict, a missing dataset to not found and a non-empty dataset to a validation error', async () => {
        stubFetch((path, init) => {
            if (init?.method === 'POST') {
                return json({error: {code: 409, message: 'Already Exists: Dataset floci-local:sales', status: 'ALREADY_EXISTS'}}, 409)
            }
            if (init?.method === 'DELETE') {
                return json({error: {code: 400, message: 'Dataset floci-local:sales is still in use', status: 'INVALID_ARGUMENT'}}, 400)
            }
            return notFound(`Not found: ${path}`)
        })

        await expect(adapter().create({values: {resourceType: 'dataset', datasetName: 'sales'}})).rejects.toBeInstanceOf(ConflictError)
        await expect(adapter().delete('sales')).rejects.toThrow('still in use')
        await expect(adapter().delete('sales')).rejects.toBeInstanceOf(ValidationError)
    })

    test('deletes a table by dataset and name, and a dataset by id', async () => {
        const calls = stubFetch(() => noContent())

        await adapter().delete('sales/orders')
        await adapter().delete('sales')

        expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
            `DELETE ${DATASETS}/sales/tables/orders`,
            `DELETE ${DATASETS}/sales`,
        ])
    })

    test('delete of a missing table is a not found', async () => {
        stubFetch(() => notFound('Not found: Table floci-local:sales.orders'))
        await expect(adapter().delete('sales/orders')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('an id with extra segments or path characters cannot address another path', async () => {
        const calls = stubFetch(() => noContent())

        await expect(adapter().delete('sales/orders/extra')).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter().delete('sales/..')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().delete('..')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('reports an unreachable runtime as unavailable', async () => {
        globalThis.fetch = (async () => {
            throw new Error('connect ECONNREFUSED')
        }) as unknown as typeof fetch
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })
})
