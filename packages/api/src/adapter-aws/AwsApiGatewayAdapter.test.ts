import {describe, expect, test} from 'bun:test'
import {
    CreateRestApiCommand,
    DeleteRestApiCommand,
    GetRestApiCommand,
    GetRestApisCommand,
    type APIGatewayClient,
} from '@aws-sdk/client-api-gateway'
import {AwsApiGatewayAdapter} from './AwsApiGatewayAdapter'

function fakeClient(handler: (command: unknown) => unknown): APIGatewayClient {
    return {
        send: async (command: unknown) => handler(command),
    } as unknown as APIGatewayClient
}

const orders = {
    id: 'a1b2c3',
    name: 'orders-api',
    description: 'Orders REST API',
    createdDate: new Date('2026-01-02T03:04:05.000Z'),
    version: '1.0',
    endpointConfiguration: {types: ['REGIONAL']},
    rootResourceId: 'root123',
}

describe('AwsApiGatewayAdapter', () => {
    test('lists every page and maps REST APIs to normalized resources', async () => {
        const adapter = new AwsApiGatewayAdapter(fakeClient((command) => {
            if (!(command instanceof GetRestApisCommand)) throw new Error('Unexpected command')
            if (!command.input.position) return {items: [orders], position: 'next'}
            return {items: [{...orders, id: 'd4e5f6', name: 'accounts-api'}]}
        }))

        const result = await adapter.list()

        expect(result).toHaveLength(2)
        expect(result[0]).toMatchObject({
            id: 'a1b2c3',
            name: 'orders-api',
            cloud: 'aws',
            service: 'apigateway',
            type: 'rest-api',
            region: null,
            createdAt: '2026-01-02T03:04:05.000Z',
        })
        expect(result[0].metadata).toMatchObject({
            apigatewayService: 'rest',
            description: 'Orders REST API',
            rootResourceId: 'root123',
        })
    })

    test('filters APIs by search term', async () => {
        const adapter = new AwsApiGatewayAdapter(fakeClient(() => ({
            items: [orders, {...orders, id: 'd4e5f6', name: 'accounts-api'}],
        })))

        const result = await adapter.list({search: 'ORDERS'})

        expect(result.map((resource) => resource.name)).toEqual(['orders-api'])
    })

    test('gets and maps one REST API', async () => {
        const adapter = new AwsApiGatewayAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(GetRestApiCommand)
            return orders
        }))

        const result = await adapter.get('a1b2c3')

        expect(result?.id).toBe('a1b2c3')
        expect(result?.metadata.rootResourceId).toBe('root123')
    })

    test('returns null when API Gateway reports a missing REST API', async () => {
        const adapter = new AwsApiGatewayAdapter(fakeClient(() => {
            throw Object.assign(new Error('NotFoundException'), {$metadata: {httpStatusCode: 404}})
        }))

        await expect(adapter.get('missing')).resolves.toBeNull()
    })

    test('creates a REST API with an optional description', async () => {
        const adapter = new AwsApiGatewayAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(CreateRestApiCommand)
            expect((command as CreateRestApiCommand).input).toEqual({name: 'orders-api', description: 'Orders REST API'})
            return orders
        }))

        const result = await adapter.create({values: {name: 'orders-api', description: 'Orders REST API'}})

        expect(result.id).toBe('a1b2c3')
    })

    test('rejects a missing name before calling API Gateway', async () => {
        let called = false
        const adapter = new AwsApiGatewayAdapter(fakeClient(() => {
            called = true
            return {}
        }))

        await expect(adapter.create({values: {}})).rejects.toThrow('name is required')
        expect(called).toBeFalse()
    })

    test('deletes the requested REST API', async () => {
        const adapter = new AwsApiGatewayAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(DeleteRestApiCommand)
            expect((command as DeleteRestApiCommand).input.restApiId).toBe('a1b2c3')
            return {}
        }))

        await adapter.delete('a1b2c3')
    })

    test('returns the AWS API Gateway schema', () => {
        const adapter = new AwsApiGatewayAdapter(fakeClient(() => ({})))

        expect(adapter.schema()).toMatchObject({
            cloud: 'aws',
            service: 'apigateway',
            displayName: 'AWS API Gateway',
            actions: ['list', 'create', 'delete', 'inspect'],
        })
    })
})
