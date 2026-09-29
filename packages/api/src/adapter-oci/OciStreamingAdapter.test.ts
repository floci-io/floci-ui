import {afterEach, describe, expect, test} from 'bun:test'
import {OciStreamingAdapter} from './OciStreamingAdapter'
import {OciRestRuntimeClient} from '../oci'
import {NotFoundError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const STREAMS = `${ENDPOINT}/20180418/streams`
const STREAM_ID = 'ocid1.stream.oc1.iad.abc'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciStreamingAdapter {
    return new OciStreamingAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

function summary(overrides: Record<string, unknown> = {}) {
    return {
        id: STREAM_ID,
        name: 'orders',
        partitions: 2,
        compartmentId: TENANCY,
        streamPoolId: 'ocid1.streampool.oc1.iad.pool',
        lifecycleState: 'ACTIVE',
        timeCreated: '2026-09-29T00:00:00Z',
        messagesEndpoint: 'https://cell-1.streaming.us-ashburn-1.oci.oraclecloud.com',
        ...overrides,
    }
}

describe('OciStreamingAdapter', () => {
    test('identifies itself as the OCI streams adapter', () => {
        const schema = adapter().schema()
        expect(adapter().cloud).toBe('oci')
        expect(adapter().service).toBe('streams')
        expect(schema).toMatchObject({cloud: 'oci', service: 'streams', displayName: 'OCI Streaming'})
        expect(schema.actions).toEqual(['list', 'create', 'inspect', 'delete'])
    })

    test('lists streams in the tenancy root compartment', async () => {
        const calls = stubFetch(() => json([summary()]))
        const [resource] = await adapter().list()

        expect(calls[0]?.url).toBe(`${STREAMS}?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(resource).toMatchObject({
            id: STREAM_ID,
            name: 'orders',
            cloud: 'oci',
            service: 'streams',
            type: 'stream',
            region: 'us-ashburn-1',
            status: 'ACTIVE',
            createdAt: '2026-09-29T00:00:00Z',
        })
        expect(resource?.metadata).toMatchObject({
            ocid: STREAM_ID,
            partitions: 2,
            compartmentId: TENANCY,
            streamPoolId: 'ocid1.streampool.oc1.iad.pool',
            messagesEndpoint: 'https://cell-1.streaming.us-ashburn-1.oci.oraclecloud.com',
        })
    })

    test('follows opc-next-page across list pages', async () => {
        const calls = stubFetch((url) => url.includes('page=p2')
            ? json([summary({id: 'ocid1.stream.oc1.iad.b', name: 'billing'})])
            : json([summary()], {status: 200, headers: {'opc-next-page': 'p2'}}))
        const resources = await adapter().list()

        expect(calls).toHaveLength(2)
        expect(resources.map((r) => r.name)).toEqual(['orders', 'billing'])
    })

    test('hides DELETED streams and filters by search term', async () => {
        stubFetch(() => json([
            summary(),
            summary({id: 'ocid1.stream.oc1.iad.old', name: 'orders-old', lifecycleState: 'DELETED'}),
            summary({id: 'ocid1.stream.oc1.iad.logs', name: 'logs'}),
        ]))
        expect((await adapter().list()).map((r) => r.name)).toEqual(['orders', 'logs'])
        expect((await adapter().list({search: 'ORD'})).map((r) => r.name)).toEqual(['orders'])
    })

    test('get reads the full stream including retention', async () => {
        const calls = stubFetch(() => json(summary({retentionInHours: 48})))
        const resource = await adapter().get(STREAM_ID)

        expect(calls[0]?.url).toBe(`${STREAMS}/${STREAM_ID}`)
        expect(resource?.metadata.retentionInHours).toBe(48)
    })

    test('get returns null for a missing or deleted stream', async () => {
        stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().get('ocid1.stream.oc1.iad.missing')).resolves.toBeNull()

        stubFetch(() => json(summary({lifecycleState: 'DELETED'})))
        await expect(adapter().get(STREAM_ID)).resolves.toBeNull()
    })

    test('creates a stream in the root compartment and keeps the work request id', async () => {
        const calls = stubFetch(() => json(
            summary({name: 'fresh', partitions: 3, retentionInHours: 72, lifecycleState: 'CREATING'}),
            {status: 200, headers: {'opc-work-request-id': 'ocid1.streamworkrequest.x'}},
        ))
        const resource = await adapter().create({values: {name: 'fresh', partitions: '3', retentionInHours: '72'}})

        expect(calls[0]?.url).toBe(STREAMS)
        expect(calls[0]?.init?.method).toBe('POST')
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            name: 'fresh',
            partitions: 3,
            retentionInHours: 72,
            compartmentId: TENANCY,
        })
        expect(resource).toMatchObject({id: STREAM_ID, name: 'fresh', status: 'CREATING'})
        expect(resource.metadata).toMatchObject({retentionInHours: 72, workRequestId: 'ocid1.streamworkrequest.x'})
    })

    test('defaults to one partition and leaves retention to the runtime default', async () => {
        const calls = stubFetch(() => json(summary({name: 'plain', partitions: 1})))
        await adapter().create({values: {name: 'plain'}})

        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({name: 'plain', partitions: 1, compartmentId: TENANCY})
    })

    test('rejects invalid input before calling the runtime', async () => {
        const calls = stubFetch(() => json({}))
        const invalid = [
            {},
            {name: '   '},
            {name: 'x'.repeat(256)},
            {name: 'ok', partitions: '0'},
            {name: 'ok', partitions: 'two'},
            {name: 'ok', retentionInHours: '23'},
            {name: 'ok', retentionInHours: '169'},
            {name: 'ok', retentionInHours: '24.5'},
        ]
        for (const values of invalid) {
            await expect(adapter().create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toEqual([])
    })

    test('deletes a stream by OCID', async () => {
        const calls = stubFetch(() => new Response(null, {status: 202, headers: {'opc-work-request-id': 'wr'}}))
        await adapter().delete(STREAM_ID)

        expect(calls[0]?.url).toBe(`${STREAMS}/${STREAM_ID}`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })

    test('treats deleting an already-gone stream as done', async () => {
        stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().delete(STREAM_ID)).resolves.toBeUndefined()
    })

    test('maps runtime failures to typed errors', async () => {
        stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().list()).rejects.toBeInstanceOf(NotFoundError)

        globalThis.fetch = (async () => {
            throw new TypeError('connection refused')
        }) as unknown as typeof fetch
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })

    test('health lists at most one stream', async () => {
        const calls = stubFetch(() => json([]))
        await adapter().health()

        const url = new URL(calls[0]!.url)
        expect(url.pathname).toBe('/20180418/streams')
        expect(url.searchParams.get('compartmentId')).toBe(TENANCY)
        expect(url.searchParams.get('limit')).toBe('1')
    })
})
