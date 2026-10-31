import {afterEach, describe, expect, test} from 'bun:test'
import {GcpManagedKafkaAdapter} from './GcpManagedKafkaAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {ConflictError, NotFoundError, RuntimeError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const CLUSTERS = '/v1/projects/floci-local/locations/us-central1/clusters'
const PARENT = 'projects/floci-local/locations/us-central1/clusters'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpManagedKafkaAdapter {
    return new GcpManagedKafkaAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
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

function notFound(): Response {
    return json({error: {code: 404, message: 'Cluster not found', status: 'NOT_FOUND'}}, 404)
}

/** Shapes captured from floci/floci-gcp 0.12.0 in mock mode. */
function cluster(name = 'k1', overrides: Record<string, unknown> = {}) {
    return {
        name: `${PARENT}/${name}`,
        state: 'ACTIVE',
        createTime: '2026-10-31T20:12:48.137990011Z',
        updateTime: '2026-10-31T20:12:48.137990011Z',
        vcpuCount: 3,
        memoryBytes: 3221225472,
        bootstrapAddress: 'localhost:9092',
        volumeId: '3ceab0',
        volumeName: 'floci-gcp-kafka-3ceab0',
        ...overrides,
    }
}

function topic(name = 'orders', parent = 'k1', overrides: Record<string, unknown> = {}) {
    return {name: `${PARENT}/${parent}/topics/${name}`, partitionCount: 3, replicationFactor: 1, configs: null, ...overrides}
}

/** Routes the cluster and topic lists the way the runtime does. */
function runtime(options: {clusters?: unknown[]; topics?: Record<string, unknown[]>} = {}) {
    const clusters = options.clusters ?? []
    const topics = options.topics ?? {}
    return stubFetch((path) => {
        if (path === CLUSTERS) return json(clusters.length ? {clusters} : {})
        const match = path.match(/\/clusters\/([^/?]+)\/topics$/)
        if (match) return json({topics: topics[match[1]] ?? []})
        return notFound()
    })
}

describe('GcpManagedKafkaAdapter', () => {
    test('advertises list, create, inspect and delete for the gcp streams service', () => {
        const schema = adapter().schema()
        expect(schema.cloud).toBe('gcp')
        expect(schema.service).toBe('streams')
        expect(schema.actions).toEqual(['list', 'create', 'inspect', 'delete'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual([
            'list',
            'create',
            'inspect',
            'delete',
        ])
    })

    test('returns an empty list when there are no clusters', async () => {
        const calls = runtime()
        expect(await adapter().list()).toEqual([])
        expect(calls.map((call) => call.path)).toEqual([CLUSTERS])
    })

    test('lists clusters with state and bootstrap address, and topics under their cluster', async () => {
        runtime({
            clusters: [cluster('k1'), cluster('k2')],
            topics: {k1: [topic('orders', 'k1'), topic('events', 'k1')], k2: [topic('audit', 'k2')]},
        })

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['k1', 'k2', 'k1/orders', 'k1/events', 'k2/audit'])
        expect(resources[0]).toMatchObject({
            name: 'k1',
            type: 'cluster',
            service: 'streams',
            cloud: 'gcp',
            status: 'ACTIVE',
            region: 'us-central1',
            createdAt: '2026-10-31T20:12:48.137990011Z',
            metadata: {bootstrapAddress: 'localhost:9092', vcpuCount: 3, memoryBytes: 3221225472},
        })
        expect(resources[2]).toMatchObject({
            name: 'orders',
            type: 'topic',
            metadata: {cluster: 'k1', partitionCount: 3, replicationFactor: 1, configs: {}},
        })
    })

    test('reads capacity from the nested capacityConfig the public API uses', async () => {
        runtime({
            clusters: [
                cluster('k1', {vcpuCount: undefined, memoryBytes: undefined, capacityConfig: {vcpuCount: '6', memoryBytes: '6442450944'}}),
            ],
        })

        const [resource] = await adapter().list()

        expect(resource.metadata).toMatchObject({vcpuCount: 6, memoryBytes: 6442450944})
    })

    test('filters by search across clusters and topics, case insensitively', async () => {
        runtime({clusters: [cluster('k1')], topics: {k1: [topic('Orders', 'k1'), topic('events', 'k1')]}})

        const resources = await adapter().list({search: 'ORD'})

        expect(resources.map((resource) => resource.id)).toEqual(['k1/Orders'])
    })

    test('follows nextPageToken for clusters and topics', async () => {
        const calls = stubFetch((path) => {
            if (path === CLUSTERS) return json({clusters: [cluster('k1')], nextPageToken: 'c2'})
            if (path === `${CLUSTERS}?pageToken=c2`) return json({clusters: [cluster('k2')]})
            if (path === `${CLUSTERS}/k1/topics`) return json({topics: [topic('a', 'k1')], nextPageToken: 't2'})
            if (path === `${CLUSTERS}/k1/topics?pageToken=t2`) return json({topics: [topic('b', 'k1')]})
            if (path === `${CLUSTERS}/k2/topics`) return json({})
            return notFound()
        })

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['k1', 'k2', 'k1/a', 'k1/b'])
        expect(calls).toHaveLength(5)
    })

    test('refuses a partial list when the runtime never stops paging', async () => {
        stubFetch(() => json({clusters: [cluster('k1')], nextPageToken: 'again'}))
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('fails the whole list when one cluster cannot list its topics', async () => {
        stubFetch((path) => {
            if (path === CLUSTERS) return json({clusters: [cluster('k1'), cluster('k2')]})
            if (path === `${CLUSTERS}/k2/topics`) return json({error: {code: 500, message: 'boom'}}, 500)
            return json({topics: []})
        })

        await expect(adapter().list()).rejects.toThrow(/boom/)
    })

    test('get returns a cluster, a topic, or null', async () => {
        stubFetch((path) => {
            if (path === `${CLUSTERS}/k1`) return json(cluster('k1'))
            if (path === `${CLUSTERS}/k1/topics/orders`) return json(topic('orders', 'k1'))
            return notFound()
        })

        expect((await adapter().get('k1'))?.type).toBe('cluster')
        expect((await adapter().get('k1/orders'))).toMatchObject({id: 'k1/orders', type: 'topic'})
        expect(await adapter().get('nope')).toBeNull()
        expect(await adapter().get('k1/missing')).toBeNull()
        expect(await adapter().get('a/b/c')).toBeNull()
    })

    test('creates a cluster from the operation the runtime answers', async () => {
        const calls = stubFetch(() =>
            json({response: cluster('k1'), done: true, name: 'projects/floci-local/locations/us-central1/operations/op1'}),
        )

        const created = await adapter().create({values: {resourceType: 'cluster', clusterName: 'k1'}})

        expect(calls).toEqual([{path: `${CLUSTERS}?clusterId=k1`, method: 'POST', body: {}}])
        expect(created).toMatchObject({id: 'k1', type: 'cluster', status: 'ACTIVE'})
    })

    test('reads a cluster back when the operation does not embed it', async () => {
        const calls = stubFetch((path, init) => {
            if (init?.method === 'POST') return json({done: true, name: 'projects/floci-local/locations/us-central1/operations/op1'})
            return json(cluster('k1'))
        })

        const created = await adapter().create({values: {resourceType: 'cluster', clusterName: 'k1'}})

        expect(created.id).toBe('k1')
        expect(calls.map((call) => call.method)).toEqual(['POST', 'GET'])
    })

    test('creates a topic with partitions and replication factor, sending only what was given', async () => {
        const calls = stubFetch(() => json(topic('orders', 'k1')))

        const created = await adapter().create({
            values: {resourceType: 'topic', cluster: 'k1', topicName: 'orders', partitionCount: '3', replicationFactor: ''},
        })

        expect(calls).toEqual([{path: `${CLUSTERS}/k1/topics?topicId=orders`, method: 'POST', body: {partitionCount: 3}}])
        expect(created).toMatchObject({id: 'k1/orders', type: 'topic'})
    })

    test('rejects invalid input before any request', async () => {
        const calls = stubFetch(() => json({}))
        const create = (values: Record<string, unknown>) => adapter().create({values})

        await expect(create({resourceType: 'broker', topicName: 'x'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'cluster', clusterName: 'BAD_ID'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'cluster', clusterName: '1abc'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'cluster', clusterName: 'a'.repeat(64)})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'cluster'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'topic', topicName: 'orders'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'topic', cluster: 'k1', topicName: 'Bad Name'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'topic', cluster: 'k1', topicName: '..'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'topic', cluster: 'k1', topicName: 'a/b'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'topic', cluster: 'k1', topicName: 'ok', partitionCount: '0'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({resourceType: 'topic', cluster: 'k1', topicName: 'ok', replicationFactor: '1.5'})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toEqual([])
    })

    test('maps a duplicate to a conflict and an unknown cluster to not found', async () => {
        stubFetch((path) =>
            path.includes('/nope/')
                ? notFound()
                : json({error: {code: 409, message: 'Topic already exists', status: 'ALREADY_EXISTS'}}, 409),
        )

        await expect(
            adapter().create({values: {resourceType: 'topic', cluster: 'k1', topicName: 'orders'}}),
        ).rejects.toBeInstanceOf(ConflictError)
        await expect(
            adapter().create({values: {resourceType: 'topic', cluster: 'nope', topicName: 'orders'}}),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    test('deletes a topic by cluster and name, and a cluster by id', async () => {
        const calls = stubFetch(() => json({}))

        await adapter().delete('k1/orders')
        await adapter().delete('k1')

        expect(calls).toEqual([
            {path: `${CLUSTERS}/k1/topics/orders`, method: 'DELETE', body: undefined},
            {path: `${CLUSTERS}/k1`, method: 'DELETE', body: undefined},
        ])
    })

    test('delete of a missing topic is a not found', async () => {
        stubFetch(() => notFound())
        await expect(adapter().delete('k1/gone')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('an id with extra segments cannot address another path', async () => {
        const calls = stubFetch(() => json({}))

        await expect(adapter().delete('k1/orders/extra')).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter().delete('k1/..')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toEqual([])
    })

    test('reports an unreachable runtime as unavailable', async () => {
        globalThis.fetch = (async () => {
            throw new Error('connect ECONNREFUSED')
        }) as unknown as typeof fetch

        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })
})
