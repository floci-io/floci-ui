import {afterEach, describe, expect, test} from 'bun:test'
import {OciWorkRequestsAdapter} from './OciWorkRequestsAdapter'
import {OciRestRuntimeClient} from '../oci'
import {NotSupportedError, RuntimeError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const QUEUE_WR = 'ocid1.coreservicesworkrequest.oc1..queue'
const IDENTITY_WR = 'ocid1.coreservicesworkrequest.oc1..identity'
const STORAGE_WR = 'ocid1.coreservicesworkrequest.oc1..storage'
const DATABASE_WR = 'ocid1.coreservicesworkrequest.oc1..database'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciWorkRequestsAdapter {
    return new OciWorkRequestsAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

function stubFetch(handler: (url: URL) => Response) {
    const calls: string[] = []
    globalThis.fetch = (async (url: string | URL | Request) => {
        calls.push(String(url))
        return handler(new URL(String(url)))
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

const notFound = () => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404})

function workRequest(id: string, operationType: string, timeAccepted: string, extra: Record<string, unknown> = {}) {
    return {
        id,
        operationType,
        status: 'SUCCEEDED',
        compartmentId: TENANCY,
        resources: [{entityType: 'QUEUE', actionType: 'CREATED', identifier: 'ocid1.queue.oc1.iad.q'}],
        percentComplete: 100,
        timeAccepted,
        ...extra,
    }
}

/** The shapes Floci-OCI answers today: bare arrays for Identity and Object Storage, `{items}` elsewhere. */
function listings(url: URL): Response {
    const path = url.pathname
    if (path === '/20160918/workRequests') return json([workRequest(IDENTITY_WR, 'DELETE_COMPARTMENT', '2026-11-06T10:00:00Z')])
    if (path === '/workRequests') return json([workRequest(STORAGE_WR, 'COPY_OBJECT', '2026-11-06T12:00:00Z')])
    if (path === '/20210201/workRequests') return json({items: [workRequest(QUEUE_WR, 'CREATE_QUEUE', '2026-11-06T11:00:00Z')]})
    if (path === '/20220915/workRequests') return json({items: [workRequest(DATABASE_WR, 'CREATE_DB_SYSTEM', '2026-11-06T09:00:00Z', {status: 'FAILED', percentComplete: 40})]})
    if (path.endsWith('/workRequests')) return json(path.startsWith('/20180222') ? [] : {items: []})
    return notFound()
}

describe('OciWorkRequestsAdapter', () => {
    test('identifies itself as the OCI work requests adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('workrequests')
        expect(instance.schema().displayName).toBe('OCI Work Requests')
    })

    test('advertises list and inspect only', () => {
        const schema = adapter().schema()
        expect(schema.actions).toEqual(['list', 'inspect'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual(['list', 'inspect'])
    })

    test('lists the work requests of every service, newest first, with the owning service', async () => {
        const calls = stubFetch(listings)

        const rows = await adapter().list()

        expect(rows.map((row) => row.name)).toEqual(['COPY_OBJECT', 'CREATE_QUEUE', 'DELETE_COMPARTMENT', 'CREATE_DB_SYSTEM'])
        expect(rows.map((row) => row.metadata.service)).toEqual(['Object Storage', 'Queue', 'Identity', 'Database'])
        expect(rows[0]).toMatchObject({id: STORAGE_WR, status: 'SUCCEEDED', createdAt: '2026-11-06T12:00:00Z', type: 'workRequest'})
        expect(rows[3]).toMatchObject({status: 'FAILED', metadata: {percentComplete: 40}})
        expect(calls).toHaveLength(7)
        for (const call of calls) expect(new URL(call).searchParams.get('compartmentId')).toBe(TENANCY)
    })

    test('is empty when no service has a work request', async () => {
        stubFetch((url) => json(url.pathname.startsWith('/20160918') || url.pathname === '/workRequests' || url.pathname.startsWith('/20180222') ? [] : {items: []}))

        expect(await adapter().list()).toEqual([])
    })

    test('follows opc-next-page until a service runs out', async () => {
        const calls = stubFetch((url) => {
            if (url.pathname !== '/20210201/workRequests') return json(url.pathname === '/20160918/workRequests' || url.pathname === '/workRequests' || url.pathname.startsWith('/20180222') ? [] : {items: []})
            if (url.searchParams.get('page') === 'p2') return json({items: [workRequest('wr-2', 'DELETE_QUEUE', '2026-11-06T08:00:00Z')]})
            return new Response(JSON.stringify({items: [workRequest('wr-1', 'CREATE_QUEUE', '2026-11-06T07:00:00Z')]}), {
                status: 200,
                headers: {'opc-next-page': 'p2'},
            })
        })

        const rows = await adapter().list()

        expect(rows.map((row) => row.id)).toEqual(['wr-2', 'wr-1'])
        expect(calls.filter((call) => call.includes('/20210201/workRequests'))).toHaveLength(2)
    })

    test('treats a service the runtime does not serve as empty', async () => {
        stubFetch((url) => (url.pathname.startsWith('/20260325') ? notFound() : listings(url)))

        expect(await adapter().list()).toHaveLength(4)
    })

    test('fails the list when a service errors instead of returning a partial one', async () => {
        stubFetch((url) => (url.pathname.startsWith('/20180418') ? json({code: 'InternalServerError', message: 'boom'}, {status: 500}) : listings(url)))

        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('searches by operation, service, state and id', async () => {
        stubFetch(listings)

        expect((await adapter().list({search: 'queue'})).map((row) => row.name)).toEqual(['CREATE_QUEUE'])
        expect((await adapter().list({search: 'failed'})).map((row) => row.name)).toEqual(['CREATE_DB_SYSTEM'])
        expect((await adapter().list({search: 'identity'})).map((row) => row.id)).toEqual([IDENTITY_WR])
        expect(await adapter().list({search: 'nothing-matches'})).toEqual([])
    })

    test('inspects a work request from the service that owns it, with its errors and logs', async () => {
        const calls = stubFetch((url) => {
            const path = url.pathname
            if (path === `/20210201/workRequests/${QUEUE_WR}`) return json(workRequest(QUEUE_WR, 'CREATE_QUEUE', '2026-11-06T11:00:00Z', {status: 'FAILED', percentComplete: 10}))
            if (path === `/20210201/workRequests/${QUEUE_WR}/errors`) return json({items: [{code: 'QuotaExceeded', message: 'too many queues', timestamp: '2026-11-06T11:00:01Z'}]})
            if (path === `/20210201/workRequests/${QUEUE_WR}/logs`) return json({items: [{message: 'creating queue', timestamp: '2026-11-06T11:00:00Z'}]})
            return notFound()
        })

        const row = await adapter().get(QUEUE_WR)

        expect(row).toMatchObject({id: QUEUE_WR, name: 'CREATE_QUEUE', status: 'FAILED'})
        expect(row?.metadata.service).toBe('Queue')
        expect(row?.metadata.errors).toEqual([{code: 'QuotaExceeded', message: 'too many queues', timestamp: '2026-11-06T11:00:01Z'}])
        expect(row?.metadata.logs).toEqual([{message: 'creating queue', timestamp: '2026-11-06T11:00:00Z'}])
        expect(row?.metadata.resources).toEqual([{entityType: 'QUEUE', actionType: 'CREATED', identifier: 'ocid1.queue.oc1.iad.q'}])
        // Identity and Object Storage are asked first and answer 404, so the search moves on.
        expect(calls[0]).toContain('/20160918/workRequests/')
    })

    test('reads a bare-array errors and logs answer, as Object Storage serves them', async () => {
        stubFetch((url) => {
            const path = url.pathname
            if (path === `/workRequests/${STORAGE_WR}`) return json(workRequest(STORAGE_WR, 'COPY_OBJECT', '2026-11-06T12:00:00Z'))
            if (path === `/workRequests/${STORAGE_WR}/errors`) return json([{code: 'Boom', message: 'copy failed'}])
            if (path === `/workRequests/${STORAGE_WR}/logs`) return json([])
            return notFound()
        })

        const row = await adapter().get(STORAGE_WR)

        expect(row?.metadata.errors).toEqual([{code: 'Boom', message: 'copy failed'}])
        expect(row?.metadata.logs).toEqual([])
    })

    test('inspects a service that has no errors or logs endpoint, using the errors on the work request', async () => {
        stubFetch((url) => {
            if (url.pathname === `/20160918/workRequests/${IDENTITY_WR}`) {
                return json(workRequest(IDENTITY_WR, 'DELETE_COMPARTMENT', '2026-11-06T10:00:00Z', {errors: [{code: 'Conflict', message: 'not empty'}]}))
            }
            return notFound()
        })

        const row = await adapter().get(IDENTITY_WR)

        expect(row?.metadata.service).toBe('Identity')
        expect(row?.metadata.errors).toEqual([{code: 'Conflict', message: 'not empty'}])
        expect(row?.metadata.logs).toEqual([])
    })

    test('returns null for a work request no service knows', async () => {
        const calls = stubFetch(() => notFound())

        expect(await adapter().get('ocid1.coreservicesworkrequest.oc1..missing')).toBeNull()
        expect(calls).toHaveLength(7)
    })

    test('refuses to create or delete a work request', async () => {
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(NotSupportedError)
        await expect(adapter().delete(QUEUE_WR)).rejects.toBeInstanceOf(NotSupportedError)
    })
})
