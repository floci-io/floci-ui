import {describe, expect, test} from 'bun:test'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'
import {ConflictError, toHttpError, ValidationError} from '../cloud-spi/errors'
import {AzureEventHubsAdapter} from './AzureEventHubsAdapter'

interface RecordedCall {
    path: string
    init: RequestInit
    options?: AzureRuntimeFetchOptions
}

describe('AzureEventHubsAdapter', () => {
    test('lists and normalizes Event Hubs namespaces', async () => {
        const client = testClient(async () => new Response(JSON.stringify({
            namespaces: [{name: 'orders-hubs', amqpPort: 5672, amqpsPort: 5671, mocked: false}],
        })))

        await expect(new AzureEventHubsAdapter(client).list()).resolves.toEqual([{
            id: 'orders-hubs',
            name: 'orders-hubs',
            cloud: 'azure',
            service: 'streams',
            type: 'eventhubs-namespace',
            region: null,
            createdAt: null,
            status: 'Running',
            metadata: {
                provider: 'azure',
                streamingService: 'event-hubs',
                amqpPort: 5672,
                amqpsPort: 5671,
                mocked: false,
            },
        }])
    })

    test('normalizes a missing namespace list endpoint to an empty list', async () => {
        const client = testClient(async (_path, _init, options) => {
            if (options?.emptyOnNotFound) return null
            return new Response(null, {status: 404})
        })

        await expect(new AzureEventHubsAdapter(client).list()).resolves.toEqual([])
    })

    test('filters namespaces by search term and marks mocked ones', async () => {
        const client = testClient(async () => new Response(JSON.stringify({
            namespaces: [{name: 'orders-hubs', mocked: false}, {name: 'billing-hubs', mocked: true}],
        })))

        const resources = await new AzureEventHubsAdapter(client).list({search: 'bill'})

        expect(resources.map((resource) => resource.name)).toEqual(['billing-hubs'])
        expect(resources[0].status).toBe('Mocked')
    })

    test('gets a namespace by name', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            return new Response(JSON.stringify({name: 'orders-hubs', mocked: true}))
        })

        const resource = await new AzureEventHubsAdapter(client).get('orders-hubs')

        expect(calls[0].path).toBe('/devstoreaccount1-eventhub/namespaces/orders-hubs')
        expect(calls[0].init.method).toBe('GET')
        expect(calls[0].options).toEqual({emptyOnNotFound: true})
        expect(resource?.id).toBe('orders-hubs')
    })

    test('returns null for a namespace that does not exist', async () => {
        const client = testClient(async () => null)

        await expect(new AzureEventHubsAdapter(client).get('missing-hubs')).resolves.toBeNull()
    })

    test('creates a namespace through the emulator management contract', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            if (init.method === 'GET') return null
            return new Response(JSON.stringify({name: 'orders-hubs', amqpPort: 0, amqpsPort: 0, mocked: true}), {status: 201})
        })

        const resource = await new AzureEventHubsAdapter(client).create({values: {namespaceName: 'orders-hubs'}})

        const put = calls[calls.length - 1]
        expect(put.path).toBe('/devstoreaccount1-eventhub/namespaces/orders-hubs')
        expect(put.init.method).toBe('PUT')
        expect(put.init.body).toBe('{}')
        expect(put.init.headers).toEqual({accept: 'application/json', 'content-type': 'application/json'})
        expect(resource.id).toBe('orders-hubs')
        expect(resource.status).toBe('Mocked')
    })

    test('rejects creating a namespace that already exists', async () => {
        const methods: (string | undefined)[] = []
        const client = testClient(async (_path, init) => {
            methods.push(init.method)
            return new Response(JSON.stringify({name: 'orders-hubs', mocked: true}))
        })

        const failure = await new AzureEventHubsAdapter(client)
            .create({values: {namespaceName: 'orders-hubs'}})
            .catch((err: unknown) => err)
        expect(failure).toBeInstanceOf(ConflictError)
        expect((failure as ConflictError).message).toBe('Event Hubs namespace orders-hubs already exists')
        expect(toHttpError(failure).status).toBe(409)
        expect(methods).toEqual(['GET'])
    })

    test('surfaces Event Hubs create errors', async () => {
        const client = testClient(async (path, init) => {
            if (init.method === 'GET') return null
            throw new Error(`Azure runtime request failed: HTTP 500 ${path} - namespace store unavailable`)
        })

        await expect(new AzureEventHubsAdapter(client).create({values: {namespaceName: 'orders-hubs'}}))
            .rejects.toThrow('HTTP 500 /devstoreaccount1-eventhub/namespaces/orders-hubs - namespace store unavailable')
    })

    test('rejects invalid namespace names as 400s', async () => {
        const adapter = new AzureEventHubsAdapter(testClient(async () => new Response()))

        for (const namespaceName of ['', 'short', '1orders-hubs', 'orders-hubs-', 'orders_hubs']) {
            const failure = await adapter.create({values: {namespaceName}}).catch((err: unknown) => err)
            expect(failure).toBeInstanceOf(ValidationError)
            expect(toHttpError(failure).status).toBe(400)
        }
    })

    test('deletes a namespace through the emulator management contract', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            return new Response(null, {status: 204})
        })

        await new AzureEventHubsAdapter(client).delete('orders-hubs')

        expect(calls).toEqual([{
            path: '/devstoreaccount1-eventhub/namespaces/orders-hubs',
            init: {method: 'DELETE'},
            options: undefined,
        }])
    })

    test('surfaces a delete of a namespace that does not exist', async () => {
        const client = testClient(async (path) => {
            throw new Error(`Azure runtime request failed: HTTP 404 ${path}`)
        })

        await expect(new AzureEventHubsAdapter(client).delete('missing-hubs')).rejects.toThrow('HTTP 404')
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
