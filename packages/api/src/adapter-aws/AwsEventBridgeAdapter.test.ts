import {describe, expect, test} from 'bun:test'
import {
    CreateEventBusCommand,
    DeleteEventBusCommand,
    DescribeEventBusCommand,
    ListEventBusesCommand,
    type EventBridgeClient,
} from '@aws-sdk/client-eventbridge'
import {AwsEventBridgeAdapter} from './AwsEventBridgeAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

describe('AwsEventBridgeAdapter', () => {
    test('identifies EventBridge through the separate events category', () => {
        const adapter = createAdapter()

        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'events', displayName: 'EventBridge'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(adapter.descriptorOverride()).toEqual({displayName: 'EventBridge'})
    })

    test('lists every EventBridge page and filters by name', async () => {
        const tokens: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            expect(command).toBeInstanceOf(ListEventBusesCommand)
            const token = (command as ListEventBusesCommand).input.NextToken
            tokens.push(token)
            return token
                ? {EventBuses: [{Name: 'billing'}]}
                : {EventBuses: [{Name: 'orders', Arn: 'arn:aws:events:us-east-1:000000000000:event-bus/orders'}], NextToken: 'next'}
        })

        expect(tokens).toEqual([])
        await expect(adapter.list({search: 'bill'})).resolves.toMatchObject([{name: 'billing', type: 'event-bus'}])
        expect(tokens).toEqual([undefined, 'next'])
    })

    test('inspects an event bus and returns null when it does not exist', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeEventBusCommand) {
                expect(command.input.Name).toBe('orders')
                return {Name: 'orders', Arn: 'arn:aws:events:eu-west-2:000000000000:event-bus/orders', Description: 'Order events'}
            }
            return {}
        })

        await expect(adapter.get('event-bus:orders')).resolves.toMatchObject({
            name: 'orders', region: 'eu-west-2', metadata: {description: 'Order events'},
        })

        const missing = createAdapter(async () => {
            throw Object.assign(new Error('missing'), {name: 'ResourceNotFoundException'})
        })
        await expect(missing.get('event-bus:missing')).resolves.toBeNull()
    })

    test('creates and deletes an event bus with its normalized id', async () => {
        const commands: unknown[] = []
        const adapter = createAdapter(async (command) => {
            commands.push(command)
            if (command instanceof CreateEventBusCommand) {
                return {EventBusArn: 'arn:aws:events:us-east-1:000000000000:event-bus/orders'}
            }
            return {}
        })

        await expect(adapter.create({values: {name: 'orders', description: 'Order events'}})).resolves.toMatchObject({
            id: 'event-bus:orders', type: 'event-bus', metadata: {description: 'Order events'},
        })
        await adapter.delete('event-bus:orders')

        expect(commands[0]).toBeInstanceOf(CreateEventBusCommand)
        expect((commands[0] as CreateEventBusCommand).input).toEqual({Name: 'orders', Description: 'Order events'})
        expect(commands[1]).toBeInstanceOf(DeleteEventBusCommand)
        expect((commands[1] as DeleteEventBusCommand).input.Name).toBe('orders')
    })
})

function createAdapter(handler: SendHandler = async () => ({EventBuses: []})): AwsEventBridgeAdapter {
    return new AwsEventBridgeAdapter({send: handler} as unknown as EventBridgeClient)
}
