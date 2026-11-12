import {afterEach, describe, expect, test} from 'bun:test'
import {GcpEventarcAdapter} from './GcpEventarcAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const PARENT = 'projects/floci-local/locations/us-central1'
const TRIGGERS_PATH = `/v1/${PARENT}/triggers`
const STORAGE_FINALIZED = 'google.cloud.storage.object.v1.finalized'
const PUBSUB_PUBLISHED = 'google.cloud.pubsub.topic.v1.messagePublished'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpEventarcAdapter {
    return new GcpEventarcAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function trigger(name: string, overrides: Record<string, unknown> = {}) {
    return {
        name: `${PARENT}/triggers/${name}`,
        uid: '340ed0a4-0f1a-4ac4-9c42-c20d646895be',
        createTime: '2026-11-12T15:04:59.060205133Z',
        updateTime: '2026-11-12T15:04:59.060205133Z',
        eventFilters: [
            {attribute: 'type', value: STORAGE_FINALIZED},
            {attribute: 'bucket', value: 'uploads'},
        ],
        destination: {cloudRun: {service: 'hello', region: 'us-central1'}},
        etag: 'bf40dbb7',
        ...overrides,
    }
}

/** The runtime answers a create with a finished operation that carries the trigger. */
function createdOperation(name: string, body: Record<string, unknown> = {}) {
    return {
        name: `${PARENT}/operations/op-1`,
        done: true,
        response: {'@type': 'type.googleapis.com/google.cloud.eventarc.v1.Trigger', ...trigger(name, body)},
    }
}

interface Sent {
    method: string
    url: string
    body?: Record<string, unknown>
}

function record(respond: (sent: Sent) => Response): Sent[] {
    const calls: Sent[] = []
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
        const sent = {
            method: init?.method ?? 'GET',
            url: String(input).replace(ENDPOINT, ''),
            body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        }
        calls.push(sent)
        return respond(sent)
    }) as unknown as typeof fetch
    return calls
}

describe('GcpEventarcAdapter list and get', () => {
    test('an empty location answers {} and lists nothing', async () => {
        record(() => json({}))
        expect(await adapter().list()).toEqual([])
    })

    test('maps the event type, filters and destination of a trigger', async () => {
        record(() => json({triggers: [trigger('on-upload')]}))
        const [resource] = await adapter().list()

        expect(resource.id).toBe('on-upload')
        expect(resource.type).toBe('trigger')
        expect(resource.region).toBe('us-central1')
        expect(resource.createdAt).toBe('2026-11-12T15:04:59.060205133Z')
        expect(resource.metadata.eventType).toBe(STORAGE_FINALIZED)
        expect(resource.metadata.filterSummary).toEqual(['bucket=uploads'])
        expect(resource.metadata.destination).toBe('Cloud Run hello (us-central1)')
    })

    test('describes an http endpoint destination and a filter operator', async () => {
        record(() =>
            json({
                triggers: [
                    trigger('hook', {
                        eventFilters: [
                            {attribute: 'type', value: PUBSUB_PUBLISHED},
                            {attribute: 'topic', value: 'orders', operator: 'match-path-pattern'},
                        ],
                        destination: {httpEndpoint: {uri: 'http://localhost:9000/events'}},
                    }),
                ],
            }),
        )
        const [resource] = await adapter().list()

        expect(resource.metadata.destination).toBe('http://localhost:9000/events')
        expect(resource.metadata.filterSummary).toEqual(['topic match-path-pattern orders'])
    })

    test('a trigger without a destination has a null destination, not an invented one', async () => {
        record(() => json({triggers: [trigger('bare', {destination: undefined})]}))
        const [resource] = await adapter().list()
        expect(resource.metadata.destination).toBeNull()
    })

    test('follows nextPageToken across pages', async () => {
        const calls = record((sent) =>
            sent.url.includes('pageToken=p2')
                ? json({triggers: [trigger('b')]})
                : json({triggers: [trigger('a')], nextPageToken: 'p2'}),
        )
        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['a', 'b'])
        expect(calls[1].url).toBe(`${TRIGGERS_PATH}?pageToken=p2`)
    })

    test('refuses a partial list when the runtime never stops paging', async () => {
        record(() => json({triggers: [trigger('a')], nextPageToken: 'again'}))
        await expect(adapter().list()).rejects.toThrow('refusing a partial list')
    })

    test('filters by name', async () => {
        record(() => json({triggers: [trigger('alpha'), trigger('beta')]}))
        expect((await adapter().list({search: 'BET'})).map((resource) => resource.name)).toEqual(['beta'])
    })

    test('inspect carries every filter, the transport and the etag', async () => {
        record(() => json(trigger('on-upload', {transport: {pubsub: {topic: 'projects/floci-local/topics/t'}}})))
        const resource = await adapter().get('on-upload')

        expect(resource?.metadata.eventFilters).toEqual([
            {attribute: 'type', value: STORAGE_FINALIZED},
            {attribute: 'bucket', value: 'uploads'},
        ])
        expect(resource?.metadata.transport).toEqual({pubsub: {topic: 'projects/floci-local/topics/t'}})
        expect(resource?.metadata.etag).toBe('bf40dbb7')
    })

    test('a missing trigger is null', async () => {
        record(() => json({error: {code: 404, message: 'Trigger not found', status: 'NOT_FOUND'}}, 404))
        expect(await adapter().get('ghost')).toBeNull()
    })

    test('an id that is not a trigger id never reaches the runtime', async () => {
        const calls = record(() => json({}))
        await expect(adapter().get('../operations')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })
})

describe('GcpEventarcAdapter create and delete', () => {
    test('creates a Cloud Run trigger from the form values', async () => {
        const calls = record(() => json(createdOperation('on-upload')))
        const created = await adapter().create({
            values: {
                name: 'on-upload',
                eventType: STORAGE_FINALIZED,
                filters: 'bucket=uploads\n\n  ',
                destinationType: 'cloudRun',
                cloudRunService: 'hello',
                cloudRunPath: '/events',
            },
        })

        expect(calls).toHaveLength(1)
        expect(calls[0].method).toBe('POST')
        expect(calls[0].url).toBe(`${TRIGGERS_PATH}?triggerId=on-upload`)
        expect(calls[0].body).toEqual({
            eventFilters: [
                {attribute: 'type', value: STORAGE_FINALIZED},
                {attribute: 'bucket', value: 'uploads'},
            ],
            destination: {cloudRun: {service: 'hello', region: 'us-central1', path: '/events'}},
        })
        expect(created.id).toBe('on-upload')
    })

    test('creates an http endpoint trigger', async () => {
        const calls = record(() => json(createdOperation('hook', {destination: {httpEndpoint: {uri: 'http://localhost:9000'}}})))
        await adapter().create({
            values: {
                name: 'hook',
                eventType: PUBSUB_PUBLISHED,
                filters: 'topic=orders',
                destinationType: 'httpEndpoint',
                httpUri: 'http://localhost:9000',
            },
        })

        expect(calls[0].body?.destination).toEqual({httpEndpoint: {uri: 'http://localhost:9000'}})
    })

    test('reads the trigger back when the runtime answers a bare operation', async () => {
        const calls = record((sent) =>
            sent.method === 'POST' ? json({name: `${PARENT}/operations/op-1`, done: true}) : json(trigger('on-upload')),
        )
        const created = await adapter().create({
            values: {name: 'on-upload', eventType: STORAGE_FINALIZED, destinationType: 'cloudRun', cloudRunService: 'hello'},
        })

        expect(calls.map((call) => call.method)).toEqual(['POST', 'GET'])
        expect(created.id).toBe('on-upload')
    })

    test('rejects a bad filter, a bad id and a missing destination, and sends nothing', async () => {
        const calls = record(() => json({}))
        const base = {name: 'on-upload', eventType: STORAGE_FINALIZED, destinationType: 'cloudRun', cloudRunService: 'hello'}
        const rejects = (values: Record<string, unknown>) =>
            expect(adapter().create({values: {...base, ...values}})).rejects.toBeInstanceOf(ValidationError)

        await rejects({filters: 'bucket'})
        await rejects({filters: '=uploads'})
        await rejects({filters: 'bucket='})
        await rejects({filters: 'type=other'})
        await rejects({filters: 'bucket=a\nbucket=b'})
        await rejects({name: 'Bad_ID'})
        await rejects({name: ''})
        await rejects({eventType: 'custom.event'})
        await rejects({cloudRunService: ''})
        await rejects({cloudRunService: 'Hello'})
        await rejects({cloudRunPath: 'events'})
        await rejects({destinationType: 'httpEndpoint', httpUri: ''})
        await rejects({destinationType: 'httpEndpoint', httpUri: 'ftp://host'})
        await rejects({destinationType: 'workflow'})
        expect(calls).toHaveLength(0)
    })

    test('an existing trigger surfaces the runtime conflict', async () => {
        record(() => json({error: {code: 409, message: 'Trigger already exists', status: 'ALREADY_EXISTS'}}, 409))
        await expect(
            adapter().create({
                values: {name: 'on-upload', eventType: STORAGE_FINALIZED, destinationType: 'cloudRun', cloudRunService: 'hello'},
            }),
        ).rejects.toThrow('Trigger already exists')
    })

    test('deletes by trigger id', async () => {
        const calls = record(() => json({done: true}))
        await adapter().delete('on-upload')

        expect(calls[0].method).toBe('DELETE')
        expect(calls[0].url).toBe(`${TRIGGERS_PATH}/on-upload`)
    })

    test('deleting a missing trigger is not found', async () => {
        record(() => json({error: {code: 404, message: 'Trigger not found', status: 'NOT_FOUND'}}, 404))
        await expect(adapter().delete('ghost')).rejects.toBeInstanceOf(NotFoundError)
    })
})
