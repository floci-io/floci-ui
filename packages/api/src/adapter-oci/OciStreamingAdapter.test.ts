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

    test('lists only columns the ListStreams summary carries', () => {
        expect(adapter().schema().columns.map((column) => column.name)).not.toContain('retention')
    })

    test('limits the retention field to the 24 to 168 hours the adapter accepts', () => {
        const pattern = new RegExp(adapter().schema().fields.find((field) => field.name === 'retentionInHours')?.validation?.pattern ?? '')
        expect(['24', '72', '168'].every((value) => pattern.test(value))).toBe(true)
        expect(['10', '23', '169', '024'].some((value) => pattern.test(value))).toBe(false)
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

describe('OciStreamingAdapter messages', () => {
    const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

    test('advertises put and read as available capabilities', () => {
        const names = adapter().schema().capabilities?.resourceActions?.map((capability) => capability.name)
        expect(names).toContain('putMessages')
        expect(names).toContain('readMessages')
    })

    test('puts a keyed message base64 encoded and returns where it landed', async () => {
        const calls = stubFetch(() =>
            json({failures: 0, entries: [{partition: '1', offset: 0, timestamp: '2026-10-27T15:49:22Z'}]}),
        )

        const result = await adapter().putMessages(STREAM_ID, [{key: 'k1', value: 'hello'}, {value: 'no key'}])

        expect(calls[0]?.url).toBe(`${STREAMS}/${STREAM_ID}/messages`)
        expect(calls[0]?.init?.method).toBe('POST')
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            messages: [{key: b64('k1'), value: b64('hello')}, {key: null, value: b64('no key')}],
        })
        expect(result).toEqual({failures: 0, entries: [{partition: '1', offset: 0, timestamp: '2026-10-27T15:49:22Z'}]})
    })

    test('raises a rejected entry instead of reporting it as sent', async () => {
        stubFetch(() =>
            json({failures: 1, entries: [{error: 'InvalidParameter', errorMessage: 'value must be base64-encoded'}]}),
        )
        await expect(adapter().putMessages(STREAM_ID, [{value: 'x'}])).rejects.toBeInstanceOf(ValidationError)
    })

    test('reports a missing stream when putting or reading', async () => {
        stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().putMessages(STREAM_ID, [{value: 'x'}])).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter().readMessages(STREAM_ID, {partition: '0', cursorType: 'LATEST'})).rejects.toBeInstanceOf(NotFoundError)
    })

    test('reads from a cursor created for the chosen type and decodes key and value', async () => {
        const calls = stubFetch((url) =>
            url.endsWith('/cursors')
                ? json({value: 'cursor-1'})
                : new Response(
                    JSON.stringify([
                        {stream: 'orders', partition: '1', key: b64('k1'), value: b64('hello 314'), offset: 0, timestamp: 't1'},
                        {stream: 'orders', partition: '1', key: null, value: b64('no key'), offset: 1, timestamp: 't2'},
                    ]),
                    {status: 200, headers: {'opc-next-cursor': 'cursor-2'}},
                ),
        )

        const result = await adapter().readMessages(STREAM_ID, {partition: '1', cursorType: 'AT_OFFSET', offset: 0, limit: 5})

        expect(calls[0]?.url).toBe(`${STREAMS}/${STREAM_ID}/cursors`)
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({partition: '1', type: 'AT_OFFSET', offset: 0})
        const read = new URL(calls[1]!.url)
        expect(read.pathname).toBe(`/20180418/streams/${STREAM_ID}/messages`)
        expect(read.searchParams.get('cursor')).toBe('cursor-1')
        expect(read.searchParams.get('limit')).toBe('5')
        expect(result.nextCursor).toBe('cursor-2')
        expect(result.messages).toEqual([
            {partition: '1', offset: 0, timestamp: 't1', key: 'k1', value: 'hello 314', valueEncoding: 'utf8'},
            {partition: '1', offset: 1, timestamp: 't2', key: null, value: 'no key', valueEncoding: 'utf8'},
        ])
    })

    test('sends the time for an AT_TIME cursor', async () => {
        const calls = stubFetch((url) => (url.endsWith('/cursors') ? json({value: 'c'}) : json([])))
        await adapter().readMessages(STREAM_ID, {partition: '0', cursorType: 'AT_TIME', time: '2020-01-01T00:00:00Z'})
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            partition: '0',
            type: 'AT_TIME',
            time: '2020-01-01T00:00:00Z',
        })
    })

    test('continues from a previous next cursor without creating another', async () => {
        const calls = stubFetch(() => json([]))
        const result = await adapter().readMessages(STREAM_ID, {partition: '0', cursorType: 'LATEST', cursor: 'cursor-2'})

        expect(calls).toHaveLength(1)
        expect(new URL(calls[0]!.url).searchParams.get('cursor')).toBe('cursor-2')
        expect(result).toEqual({messages: [], nextCursor: undefined})
    })

    test('keeps a payload that is not UTF-8 as base64 instead of corrupting it', async () => {
        const binary = Buffer.from([0xff, 0xfe, 0x00]).toString('base64')
        stubFetch((url) => (url.endsWith('/cursors') ? json({value: 'c'}) : json([{partition: '0', value: binary, offset: 0}])))

        const result = await adapter().readMessages(STREAM_ID, {partition: '0', cursorType: 'TRIM_HORIZON'})

        expect(result.messages[0]).toMatchObject({value: binary, valueEncoding: 'base64'})
    })

    test('passes the runtime rejection of a bad partition through as a typed error', async () => {
        stubFetch(() => json({code: 'InvalidParameter', message: 'partition out of range: 9'}, {status: 400}))
        await expect(adapter().readMessages(STREAM_ID, {partition: '9', cursorType: 'LATEST'})).rejects.toBeInstanceOf(ValidationError)
    })
})
