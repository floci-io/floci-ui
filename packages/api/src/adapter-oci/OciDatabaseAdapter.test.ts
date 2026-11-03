import {afterEach, describe, expect, test} from 'bun:test'
import {OciDatabaseAdapter} from './OciDatabaseAdapter'
import {OciRestRuntimeClient} from '../oci'
import {ConflictError, NotFoundError, RuntimeError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const API = `${ENDPOINT}/20220915`
const DB_ID = 'ocid1.postgresqldbsystem.oc1.iad.abc'
const WORK_REQUEST_ID = 'ocid1.coreservicesworkrequest.oc1..wr1'
const SUBNET = 'ocid1.subnet.oc1.iad.demo'
const PASSWORD = 'Secret12345!'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciDatabaseAdapter {
    return new OciDatabaseAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

type Call = {url: string; method: string; body: unknown}

function stubFetch(handler: (url: string, method: string) => Response) {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push({url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined})
        return handler(String(url), method)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

const dbSystem = {
    id: DB_ID,
    displayName: 'pg1',
    compartmentId: TENANCY,
    lifecycleState: 'ACTIVE',
    dbVersion: '16.15',
    shape: 'VM.Standard.E4.Flex',
    instanceCount: 1,
    instanceOcpuCount: 2,
    instanceMemorySizeInGBs: 32,
    adminUsername: 'admin',
    timeCreated: '2026-11-03T16:56:40Z',
    networkDetails: {subnetId: SUBNET},
    storageDetails: {isRegionallyDurable: true},
}

const connection = {
    caCertificate: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n',
    primaryDbEndpoint: {fqdn: 'floci-oci-psql-abc', port: 5432},
}

const createValues = {
    displayName: 'pg1', dbVersion: '16', shape: 'VM.Standard.E4.Flex', subnetId: SUBNET,
    adminUsername: 'admin', adminPassword: PASSWORD,
}

describe('OciDatabaseAdapter', () => {
    test('advertises the oci database schema with only the actions it implements', () => {
        const a = adapter()
        const schema = a.schema()
        expect(a.cloud).toBe('oci')
        expect(a.service).toBe('database')
        expect(schema.actions).toEqual(['list', 'create', 'inspect', 'delete'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(schema.fields.find((field) => field.name === 'adminPassword')?.type).toBe('password')
    })

    test('lists DB systems with version, shape and state, hiding deleted ones', async () => {
        const calls = stubFetch(() => json({items: [dbSystem, {...dbSystem, id: 'ocid1.postgresqldbsystem.oc1.iad.old', displayName: 'gone', lifecycleState: 'DELETED'}]}))
        const rows = await adapter().list()
        expect(calls[0]?.url).toBe(`${API}/dbSystems?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            id: DB_ID, name: 'pg1', cloud: 'oci', service: 'database', status: 'ACTIVE',
            engine: 'PostgreSQL 16.15', version: '16.15', instanceClass: 'VM.Standard.E4.Flex', region: 'us-ashburn-1',
        })
    })

    test('list is empty for an empty collection and filters by search', async () => {
        stubFetch(() => json({items: []}))
        expect(await adapter().list()).toEqual([])
        stubFetch(() => json({items: [dbSystem, {...dbSystem, id: 'x', displayName: 'orders'}]}))
        expect((await adapter().list({search: 'ORD'})).map((row) => row.name)).toEqual(['orders'])
    })

    test('follows opc-next-page and stops on a repeated token', async () => {
        const calls = stubFetch((url) => {
            const page = new URL(url).searchParams.get('page')
            // The runtime keeps answering p2, which must not loop forever.
            return json({items: [{...dbSystem, id: `id-${page ?? 'first'}`}]}, {
                status: 200,
                headers: {'opc-next-page': 'p2'},
            })
        })
        const rows = await adapter().list()
        expect(rows.map((row) => row.id)).toEqual(['id-first', 'id-p2'])
        expect(calls).toHaveLength(2)
    })

    test('inspect shows host, port and CA certificate and never a password', async () => {
        const calls = stubFetch((url) => url.endsWith('/connectionDetails') ? json(connection) : json(dbSystem))
        const resource = await adapter().get(DB_ID)
        expect(calls.map((call) => call.url)).toEqual([`${API}/dbSystems/${DB_ID}`, `${API}/dbSystems/${DB_ID}/connectionDetails`])
        expect(resource?.metadata).toMatchObject({
            host: 'floci-oci-psql-abc', port: 5432, caCertificate: connection.caCertificate, adminUsername: 'admin',
        })
        expect(JSON.stringify(resource)).not.toContain('assword')
    })

    test('inspect skips connection details until the system is active', async () => {
        const calls = stubFetch(() => json({...dbSystem, lifecycleState: 'CREATING'}))
        const resource = await adapter().get(DB_ID)
        expect(calls).toHaveLength(1)
        expect(resource?.status).toBe('CREATING')
        expect(resource?.metadata.host).toBeUndefined()
    })

    test('get answers null for a missing or deleted system', async () => {
        stubFetch(() => json({code: 'NotFound'}, {status: 404}))
        expect(await adapter().get(DB_ID)).toBeNull()
        stubFetch(() => json({...dbSystem, lifecycleState: 'DELETED'}))
        expect(await adapter().get(DB_ID)).toBeNull()
    })

    test('create posts the DB system with credentials and resolves the OCID through the work request', async () => {
        const calls = stubFetch((url, method) => {
            if (method === 'POST') return json(dbSystem, {status: 200, headers: {'opc-work-request-id': WORK_REQUEST_ID}})
            if (url.includes('/workRequests/')) {
                return json({status: 'SUCCEEDED', resources: [{entityType: 'postgresqlDbSystem', identifier: DB_ID}]})
            }
            return url.endsWith('/connectionDetails') ? json(connection) : json(dbSystem)
        })
        const created = await adapter().create({values: createValues})
        const post = calls.find((call) => call.method === 'POST')
        expect(post?.url).toBe(`${API}/dbSystems`)
        expect(post?.body).toMatchObject({
            compartmentId: TENANCY, displayName: 'pg1', dbVersion: '16', shape: 'VM.Standard.E4.Flex',
            instanceCount: 1, instanceOcpuCount: 2, instanceMemorySizeInGBs: 32,
            networkDetails: {subnetId: SUBNET},
            credentials: {username: 'admin', passwordDetails: {passwordType: 'PLAIN_TEXT', password: PASSWORD}},
        })
        expect(created.id).toBe(DB_ID)
        expect(JSON.stringify(created)).not.toContain(PASSWORD)
    })

    test('create reports CREATING when the new system is not served yet', async () => {
        stubFetch((url, method) => {
            if (method === 'POST') return json(dbSystem, {status: 200, headers: {'opc-work-request-id': WORK_REQUEST_ID}})
            if (url.includes('/workRequests/')) {
                return json({status: 'IN_PROGRESS', resources: [{entityType: 'postgresqlDbSystem', identifier: DB_ID}]})
            }
            return json({code: 'NotFound'}, {status: 404})
        })
        const created = await adapter().create({values: createValues})
        expect(created).toMatchObject({id: DB_ID, name: 'pg1', status: 'CREATING'})
        expect(JSON.stringify(created)).not.toContain(PASSWORD)
    })

    test('create falls back to the echoed body when no work request id is returned', async () => {
        stubFetch((url, method) => {
            if (method === 'POST') return json(dbSystem)
            return url.endsWith('/connectionDetails') ? json(connection) : json(dbSystem)
        })
        expect((await adapter().create({values: createValues})).id).toBe(DB_ID)
    })

    test('create fails when the work request failed', async () => {
        stubFetch((url, method) => {
            if (method === 'POST') return json(dbSystem, {status: 200, headers: {'opc-work-request-id': WORK_REQUEST_ID}})
            return json({status: 'FAILED'})
        })
        await expect(adapter().create({values: createValues})).rejects.toBeInstanceOf(RuntimeError)
    })

    test('create rejects invalid input before calling the runtime', async () => {
        const calls = stubFetch(() => json({}))
        const a = adapter()
        const bad: Array<Record<string, unknown>> = [
            {...createValues, displayName: ''},
            {...createValues, displayName: 'x'.repeat(256)},
            {...createValues, dbVersion: ''},
            {...createValues, shape: ''},
            {...createValues, subnetId: ''},
            {...createValues, subnetId: 'ocid1.vcn.oc1.iad.demo'},
            {...createValues, adminUsername: ''},
            {...createValues, adminPassword: 'short'},
            {...createValues, instanceOcpuCount: '0'},
            {...createValues, instanceMemorySizeInGBs: 'abc'},
        ]
        for (const values of bad) {
            await expect(a.create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('maps runtime failures to typed errors', async () => {
        stubFetch(() => json({code: 'InvalidParameter', message: 'bad'}, {status: 400}))
        await expect(adapter().create({values: createValues})).rejects.toBeInstanceOf(ValidationError)
        stubFetch(() => json({code: 'Conflict', message: 'exists'}, {status: 409}))
        await expect(adapter().create({values: createValues})).rejects.toBeInstanceOf(ConflictError)
        stubFetch(() => json({code: 'NotFound'}, {status: 404}))
        await expect(adapter().list()).rejects.toBeInstanceOf(NotFoundError)
    })

    test('delete sends DELETE and tolerates a missing system', async () => {
        const calls = stubFetch(() => new Response(null, {status: 202, headers: {'opc-work-request-id': WORK_REQUEST_ID}}))
        await adapter().delete(DB_ID)
        expect(calls[0]).toMatchObject({method: 'DELETE', url: `${API}/dbSystems/${DB_ID}`})
        stubFetch(() => json({code: 'NotFound'}, {status: 404}))
        await adapter().delete(DB_ID)
    })

    test('reports an unreachable runtime', async () => {
        globalThis.fetch = (async () => {
            throw new Error('connect ECONNREFUSED')
        }) as unknown as typeof fetch
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })
})
