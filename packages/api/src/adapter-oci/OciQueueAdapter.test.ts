import {afterEach, describe, expect, test} from 'bun:test'
import {OciQueueAdapter} from './OciQueueAdapter'
import {OciRestRuntimeClient} from '../oci'
import {NotFoundError, RuntimeError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const QUEUES = `${ENDPOINT}/20210201/queues`
const QUEUE_ID = 'ocid1.queue.oc1.iad.aaaa'
const WR_ID = 'ocid1.coreservicesworkrequest.oc1..bbbb'
const LIST_URL = `${QUEUES}?compartmentId=${encodeURIComponent(TENANCY)}`

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciQueueAdapter {
    return new OciQueueAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
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

function accepted(): Response {
    return new Response(null, {status: 202, headers: {'opc-work-request-id': WR_ID}})
}

const notFound = () => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404})

const QUEUE = {
    id: QUEUE_ID,
    displayName: 'orders',
    compartmentId: TENANCY,
    timeCreated: '2026-09-29T00:00:00Z',
    lifecycleState: 'ACTIVE',
    messagesEndpoint: 'http://localhost:4599',
    retentionInSeconds: 3600,
    visibilityInSeconds: 45,
    deadLetterQueueDeliveryCount: 3,
}

const STATS = {
    queue: {visibleMessages: 2, inFlightMessages: 1, sizeInBytes: 12},
    dlq: {visibleMessages: 4, inFlightMessages: 0, sizeInBytes: 8},
}

describe('OciQueueAdapter', () => {
    test('identifies itself as the OCI messaging adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('messaging')
        expect(instance.schema().displayName).toBe('OCI Queue')
    })

    test('lists queues in the tenancy root compartment with their stats', async () => {
        const calls = stubFetch((url) => {
            if (url === LIST_URL) return json({items: [QUEUE]})
            if (url === `${QUEUES}/${encodeURIComponent(QUEUE_ID)}/stats`) return json(STATS)
            return notFound()
        })
        const [resource] = await adapter().list()

        expect(calls[0]?.url).toBe(LIST_URL)
        expect(resource).toMatchObject({
            id: QUEUE_ID,
            name: 'orders',
            cloud: 'oci',
            service: 'messaging',
            type: 'queue',
            region: 'us-ashburn-1',
            status: 'ACTIVE',
            createdAt: '2026-09-29T00:00:00Z',
        })
        expect(resource?.metadata).toMatchObject({
            compartmentId: TENANCY,
            approximateMessages: 2,
            messagesInFlight: 1,
            sizeInBytes: 12,
            deadLetterMessages: 4,
        })
    })

    test('follows opc-next-page across wrapped list pages', async () => {
        const calls = stubFetch((url) => {
            if (url === LIST_URL) {
                return new Response(JSON.stringify({items: [{...QUEUE, id: 'q1', displayName: 'one'}]}), {
                    status: 200,
                    headers: {'opc-next-page': 'p2'},
                })
            }
            if (url === `${LIST_URL}&page=p2`) return json({items: [{...QUEUE, id: 'q2', displayName: 'two'}]})
            if (url.endsWith('/stats')) return json(STATS)
            return notFound()
        })
        const resources = await adapter().list()

        expect(resources.map((r) => r.name)).toEqual(['one', 'two'])
        expect(calls.filter((c) => !c.url.endsWith('/stats'))).toHaveLength(2)
    })

    test('follows more than 100 list pages', async () => {
        const calls = stubFetch((url) => {
            const page = Number(new URL(url).searchParams.get('page') ?? '0')
            return new Response(JSON.stringify({items: [{...QUEUE, id: `q${page}`, lifecycleState: 'CREATING'}]}), {
                status: 200,
                headers: page < 150 ? {'opc-next-page': String(page + 1)} : {},
            })
        })

        await expect(adapter().list()).resolves.toHaveLength(151)
        expect(calls).toHaveLength(151)
    })

    test('stops when the runtime repeats a page token', async () => {
        const calls = stubFetch(() => new Response(JSON.stringify({items: [{...QUEUE, lifecycleState: 'CREATING'}]}), {
            status: 200,
            headers: {'opc-next-page': 'p2'},
        }))

        await adapter().list()
        expect(calls).toHaveLength(2)
    })

    test('keeps a queue whose stats cannot be read and skips stats for non-active queues', async () => {
        const calls = stubFetch((url) => {
            if (url === LIST_URL) {
                return json({items: [QUEUE, {...QUEUE, id: 'q-new', displayName: 'new', lifecycleState: 'CREATING'}]})
            }
            if (url.endsWith('/stats')) return json({code: 'InternalError', message: 'boom'}, {status: 500})
            return notFound()
        })
        const resources = await adapter().list()

        expect(resources.map((r) => r.name)).toEqual(['orders', 'new'])
        expect(resources[0]?.metadata.approximateMessages).toBeNull()
        expect(calls.filter((c) => c.url.includes('q-new/stats'))).toHaveLength(0)
    })

    test('hides deleted queues and filters by search term', async () => {
        stubFetch((url) => {
            if (url === LIST_URL) {
                return json({items: [
                    {...QUEUE, id: 'a', displayName: 'app-orders'},
                    {...QUEUE, id: 'b', displayName: 'logs'},
                    {...QUEUE, id: 'c', displayName: 'app-gone', lifecycleState: 'DELETED'},
                ]})
            }
            return json(STATS)
        })
        const resources = await adapter().list({search: 'APP'})
        expect(resources.map((r) => r.name)).toEqual(['app-orders'])
    })

    test('get returns a queue with settings and stats', async () => {
        const calls = stubFetch((url) => (url.endsWith('/stats') ? json(STATS) : json(QUEUE)))
        const resource = await adapter().get(QUEUE_ID)

        expect(calls[0]?.url).toBe(`${QUEUES}/${encodeURIComponent(QUEUE_ID)}`)
        expect(resource?.metadata).toMatchObject({
            retentionInSeconds: 3600,
            visibilityInSeconds: 45,
            deadLetterQueueDeliveryCount: 3,
            approximateMessages: 2,
        })
    })

    test('get returns null for a missing queue', async () => {
        stubFetch(notFound)
        await expect(adapter().get('missing')).resolves.toBeNull()
    })

    test('creates a queue in the root compartment and resolves it through the work request', async () => {
        const calls = stubFetch((url, init) => {
            if (url === QUEUES && init?.method === 'POST') return accepted()
            if (url === `${ENDPOINT}/20210201/workRequests/${encodeURIComponent(WR_ID)}`) {
                return json({id: WR_ID, status: 'SUCCEEDED', resources: [{entityType: 'QUEUE', actionType: 'CREATED', identifier: QUEUE_ID}]})
            }
            if (url === `${QUEUES}/${encodeURIComponent(QUEUE_ID)}`) return json(QUEUE)
            if (url.endsWith('/stats')) return json(STATS)
            return notFound()
        })
        const resource = await adapter().create({
            values: {displayName: ' orders ', visibilityInSeconds: '45', retentionInSeconds: '3600', deadLetterQueueDeliveryCount: '3'},
        })

        expect(calls[0]?.init?.method).toBe('POST')
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            displayName: 'orders',
            compartmentId: TENANCY,
            visibilityInSeconds: 45,
            retentionInSeconds: 3600,
            deadLetterQueueDeliveryCount: 3,
        })
        expect(resource).toMatchObject({id: QUEUE_ID, name: 'orders', status: 'ACTIVE'})
    })

    test('omits blank optional settings from the create body', async () => {
        const calls = stubFetch((url, init) => {
            if (init?.method === 'POST') return accepted()
            if (url.includes('/workRequests/')) return json({id: WR_ID, status: 'SUCCEEDED', resources: [{entityType: 'QUEUE', identifier: QUEUE_ID}]})
            return url.endsWith('/stats') ? json(STATS) : json({...QUEUE, displayName: 'bare'})
        })
        await adapter().create({values: {displayName: 'bare', visibilityInSeconds: '', retentionInSeconds: ' '}})
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({displayName: 'bare', compartmentId: TENANCY})
    })

    test('reports a failed work request instead of a created queue', async () => {
        stubFetch((url, init) => {
            if (init?.method === 'POST') return accepted()
            if (url.includes('/workRequests/')) {
                return json({id: WR_ID, status: 'FAILED', resources: [{entityType: 'QUEUE', identifier: QUEUE_ID}]})
            }
            return notFound()
        })
        const error = await adapter().create({values: {displayName: 'orders'}}).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(RuntimeError)
        expect((error as Error).message).toContain('FAILED')
    })

    test('does not report a queue as created without its OCID', async () => {
        stubFetch((url, init) => {
            if (init?.method === 'POST') return accepted()
            if (url.includes('/workRequests/')) return json({id: WR_ID, status: 'IN_PROGRESS', resources: []})
            return notFound()
        })
        await expect(adapter().create({values: {displayName: 'orders'}})).rejects.toBeInstanceOf(RuntimeError)
    })

    test('reports a still-creating queue when it cannot be read back yet', async () => {
        stubFetch((url, init) => {
            if (init?.method === 'POST') return accepted()
            if (url.includes('/workRequests/')) {
                return json({id: WR_ID, status: 'IN_PROGRESS', resources: [{entityType: 'QUEUE', identifier: QUEUE_ID}]})
            }
            return notFound()
        })
        const resource = await adapter().create({values: {displayName: 'orders'}})

        expect(resource).toMatchObject({id: QUEUE_ID, name: 'orders', status: 'CREATING'})
        expect(resource.metadata.workRequestId).toBe(WR_ID)
    })

    test('rejects a missing or invalid create input before calling the runtime', async () => {
        const calls = stubFetch(() => accepted())
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {displayName: 'x'.repeat(256)}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {displayName: 'q', retentionInSeconds: '5'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {displayName: 'q', visibilityInSeconds: '43201'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {displayName: 'q', deadLetterQueueDeliveryCount: '1.5'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('deletes a queue by OCID', async () => {
        const calls = stubFetch(() => accepted())
        await adapter().delete(QUEUE_ID)
        expect(calls[0]?.url).toBe(`${QUEUES}/${encodeURIComponent(QUEUE_ID)}`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })

    test('delete throws NotFoundError for a missing queue', async () => {
        stubFetch(notFound)
        await expect(adapter().delete('missing')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('maps an unreachable runtime to RuntimeUnavailableError', async () => {
        globalThis.fetch = (async () => {
            throw new TypeError('connection refused')
        }) as unknown as typeof fetch
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })

    test('health lists one queue in the root compartment', async () => {
        const calls = stubFetch(() => json({items: []}))
        await adapter().health()
        expect(calls[0]?.url).toBe(`${LIST_URL}&limit=1`)
    })
})
