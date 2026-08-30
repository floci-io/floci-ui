import {afterEach, describe, expect, test} from 'bun:test'
import {GcpPubSubAdapter} from './GcpPubSubAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const TOPICS_PATH = '/v1/projects/floci-local/topics'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpPubSubAdapter {
    return new GcpPubSubAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function topic(name: string) {
    return {name: `projects/floci-local/topics/${name}`}
}

describe('GcpPubSubAdapter', () => {
    test('identifies itself as the GCP messaging adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('gcp')
        expect(instance.service).toBe('messaging')
        expect(instance.schema().displayName).toBe('Cloud Pub/Sub')
    })

    test('lists topics and reduces the resource path to a short id', async () => {
        const calls = stubFetch(() => new Response(JSON.stringify({topics: [topic('events')]}), {status: 200}))
        const [resource] = await adapter().list()

        expect(calls[0]?.url).toBe(`${ENDPOINT}${TOPICS_PATH}`)
        expect(resource).toMatchObject({
            id: 'events',
            name: 'events',
            cloud: 'gcp',
            service: 'messaging',
            type: 'topic',
        })
        // The full path stays available for anyone who needs to address it.
        expect(resource?.metadata.resourcePath).toBe('projects/floci-local/topics/events')
    })

    test('normalizes an empty list payload', async () => {
        stubFetch(() => new Response('{}', {status: 200}))
        await expect(adapter().list()).resolves.toEqual([])
    })

    test('filters the list by search term', async () => {
        stubFetch(() => new Response(JSON.stringify({topics: [topic('events'), topic('audit')]}), {status: 200}))

        await expect(adapter().list({search: 'even'})).resolves.toHaveLength(1)
        await expect(adapter().list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a single topic', async () => {
        const calls = stubFetch(() => new Response(JSON.stringify(topic('events')), {status: 200}))
        const resource = await adapter().get('events')

        expect(calls[0]?.url).toBe(`${ENDPOINT}${TOPICS_PATH}/events`)
        expect(resource?.id).toBe('events')
    })

    test('returns null when the topic does not exist', async () => {
        stubFetch(() => new Response(JSON.stringify({error: {code: 404, message: 'Topic not found'}}), {status: 404}))
        await expect(adapter().get('nope')).resolves.toBeNull()
    })

    test('creates with PUT on the resource path, not POST to the collection', async () => {
        // Pub/Sub's create verb is PUT; POSTing to /topics would 404 or 405.
        const calls = stubFetch(() => new Response(JSON.stringify(topic('events')), {status: 200}))
        const resource = await adapter().create({values: {topicName: 'events'}})

        expect(calls[0]?.init?.method).toBe('PUT')
        expect(calls[0]?.url).toBe(`${ENDPOINT}${TOPICS_PATH}/events`)
        expect(resource.id).toBe('events')
    })

    test('requires a topic name', async () => {
        stubFetch(() => new Response('{}', {status: 200}))
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('rejects a name Pub/Sub would refuse', async () => {
        stubFetch(() => new Response('{}', {status: 200}))
        for (const name of ['1starts-with-digit', 'ab', 'has space', 'has/slash']) {
            await expect(adapter().create({values: {topicName: name}})).rejects.toBeInstanceOf(ValidationError)
        }
    })

    test('accepts the punctuation Pub/Sub allows', async () => {
        stubFetch(() => new Response(JSON.stringify(topic('a.b-c_d~e')), {status: 200}))
        await expect(adapter().create({values: {topicName: 'a.b-c_d~e'}})).resolves.toBeDefined()
    })

    test('deletes a topic', async () => {
        const calls = stubFetch(() => new Response('{}', {status: 200}))
        await adapter().delete('events')

        expect(calls[0]?.url).toBe(`${ENDPOINT}${TOPICS_PATH}/events`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })

    test('surfaces a missing topic on delete', async () => {
        stubFetch(() => new Response(JSON.stringify({error: {code: 404, message: 'Topic not found'}}), {status: 404}))
        await expect(adapter().delete('nope')).rejects.toBeInstanceOf(NotFoundError)
    })
})
