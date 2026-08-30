import {describe, expect, test} from 'bun:test'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'
import {ConflictError, toHttpError, ValidationError} from '../cloud-spi/errors'
import {AzureServiceBusAdapter} from './AzureServiceBusAdapter'

interface RecordedCall {
    path: string
    init: RequestInit
    options?: AzureRuntimeFetchOptions
}

describe('AzureServiceBusAdapter', () => {
    test('lists and normalizes Service Bus namespaces', async () => {
        const client = testClient(async () => new Response(JSON.stringify({
            namespaces: [{
                name: 'orders-bus',
                amqpPort: 5672,
                amqpsPort: 5671,
                tlsCertPem: 'certificate',
                mocked: false,
            }],
        })))

        await expect(new AzureServiceBusAdapter(client).list()).resolves.toEqual([{
            id: 'orders-bus',
            name: 'orders-bus',
            cloud: 'azure',
            service: 'messaging',
            type: 'servicebus-namespace',
            region: null,
            createdAt: null,
            status: 'Running',
            metadata: {
                provider: 'azure',
                messagingService: 'service-bus',
                amqpPort: 5672,
                amqpsPort: 5671,
                mocked: false,
                tlsEnabled: true,
            },
        }])
    })

    test('normalizes a missing namespace list endpoint to an empty list', async () => {
        const client = testClient(async (_path, _init, options) => {
            if (options?.emptyOnNotFound) return null
            return new Response(null, {status: 404})
        })

        await expect(new AzureServiceBusAdapter(client).list()).resolves.toEqual([])
    })

    test('filters namespaces by search term', async () => {
        const client = testClient(async () => new Response(JSON.stringify({
            namespaces: [{name: 'orders-bus', mocked: false}, {name: 'billing-bus', mocked: true}],
        })))

        const resources = await new AzureServiceBusAdapter(client).list({search: 'bill'})

        expect(resources.map((resource) => resource.name)).toEqual(['billing-bus'])
        expect(resources[0].status).toBe('Mocked')
    })

    test('gets a namespace by name', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            return new Response(JSON.stringify({name: 'orders-bus', mocked: false}))
        })

        const resource = await new AzureServiceBusAdapter(client).get('orders-bus')

        expect(calls[0].path).toBe('/devstoreaccount1-servicebus/namespaces/orders-bus')
        expect(calls[0].init.method).toBe('GET')
        expect(calls[0].options).toEqual({emptyOnNotFound: true})
        expect(resource?.id).toBe('orders-bus')
    })

    test('creates a namespace through the emulator management contract', async () => {
        const calls: RecordedCall[] = []
        const client = testClient(async (path, init, options) => {
            calls.push({path, init, options})
            if (init.method === 'GET') return null
            return new Response(JSON.stringify({name: 'orders-bus', amqpPort: 5672, mocked: false}), {status: 201})
        })

        const resource = await new AzureServiceBusAdapter(client).create({values: {namespaceName: 'orders-bus'}})

        const put = calls[calls.length - 1]
        expect(put.path).toBe('/devstoreaccount1-servicebus/namespaces/orders-bus')
        expect(put.init.method).toBe('PUT')
        expect(put.init.body).toBe('{}')
        expect(put.init.headers).toEqual({accept: 'application/json', 'content-type': 'application/json'})
        expect(resource.id).toBe('orders-bus')
    })

    test('rejects creating a namespace that already exists', async () => {
        const methods: (string | undefined)[] = []
        const client = testClient(async (_path, init) => {
            methods.push(init.method)
            return new Response(JSON.stringify({name: 'orders-bus', mocked: false}))
        })

        const failure = await new AzureServiceBusAdapter(client)
            .create({values: {namespaceName: 'orders-bus'}})
            .catch((err: unknown) => err)
        expect(failure).toBeInstanceOf(ConflictError)
        expect((failure as ConflictError).message).toBe('Service Bus namespace orders-bus already exists')
        expect(toHttpError(failure).status).toBe(409)
        expect(methods).toEqual(['GET'])
    })

    test('surfaces Service Bus create errors', async () => {
        const client = testClient(async (path, init) => {
            if (init.method === 'GET') return null
            throw new Error(`Azure runtime request failed: HTTP 500 ${path} - namespace store unavailable`)
        })

        await expect(new AzureServiceBusAdapter(client).create({values: {namespaceName: 'orders-bus'}}))
            .rejects.toThrow('HTTP 500 /devstoreaccount1-servicebus/namespaces/orders-bus - namespace store unavailable')
    })

    test('rejects invalid namespace names as 400s', async () => {
        const adapter = new AzureServiceBusAdapter(testClient(async () => new Response()))

        for (const namespaceName of ['', 'short', 'orders-sb']) {
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

        await new AzureServiceBusAdapter(client).delete('orders-bus')

        expect(calls).toEqual([{
            path: '/devstoreaccount1-servicebus/namespaces/orders-bus',
            init: {method: 'DELETE'},
            options: undefined,
        }])
    })

    test('surfaces a delete of a namespace that does not exist', async () => {
        const client = testClient(async (path) => {
            throw new Error(`Azure runtime request failed: HTTP 404 ${path}`)
        })

        await expect(new AzureServiceBusAdapter(client).delete('missing')).rejects.toThrow('HTTP 404')
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
