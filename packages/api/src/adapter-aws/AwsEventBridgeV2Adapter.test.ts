import {describe, expect, test} from 'bun:test'
import {
    CreateEventBusCommand,
    CreateSubscriberCommand,
    DeleteEventBusCommand,
    DeleteSubscriberCommand,
    DescribeEventBusCommand,
    DescribeSubscriberCommand,
    ListEventBusesCommand,
    ListSubscribersCommand,
    type EventBridgeV2Client,
} from '@aws-sdk/client-eventbridgev2'
import {RuntimeError} from '../cloud-spi/errors'
import {AwsEventBridgeV2Adapter} from './AwsEventBridgeV2Adapter'

type SendHandler = (command: unknown) => Promise<unknown>

const BUS_ARN = 'arn:aws:events:us-east-1:000000000000:event-busv2/orders/abcdefghijklmnopqrstuvwxy'
const SUBSCRIBER_ARN = 'arn:aws:events:us-east-1:000000000000:subscriber/orders/large-orders/abcdefghijklmnopqrstuvwxy'
const QUEUE_ARN = 'arn:aws:sqs:us-east-1:000000000000:large-orders'
const ROLE_ARN = 'arn:aws:iam::000000000000:role/EventBusDelivery'

describe('AwsEventBridgeV2Adapter', () => {
    test('identifies EventBridge V2 through its own eventsv2 category', () => {
        const schema = createAdapter().schema()

        expect(schema).toMatchObject({cloud: 'aws', service: 'eventsv2', displayName: 'EventBridge V2'})
        expect(schema.actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('lists every page of buses and subscribers and filters by name', async () => {
        const busTokens: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListEventBusesCommand) {
                busTokens.push(command.input.NextToken)
                return command.input.NextToken
                    ? {EventBuses: [{Name: 'orders', EventBusArn: BUS_ARN, State: 'ACTIVE'}]}
                    : {EventBuses: [{Name: 'billing'}], NextToken: 'next'}
            }
            if (command instanceof ListSubscribersCommand) {
                return {Subscribers: [{Name: 'large-orders', SubscriberArn: SUBSCRIBER_ARN, EventBusArn: BUS_ARN, TargetArn: QUEUE_ARN, State: 'RUNNING'}]}
            }
            throw new Error('unexpected command')
        })

        await expect(adapter.list({search: 'ORDERS'})).resolves.toMatchObject([
            {id: `bus:${BUS_ARN}`, name: 'orders', type: 'event-bus-v2', status: 'ACTIVE', region: 'us-east-1'},
            {
                id: `subscriber:${SUBSCRIBER_ARN}`,
                name: 'large-orders',
                type: 'subscriber',
                status: 'RUNNING',
                metadata: {eventBusName: 'orders', targetArn: QUEUE_ARN},
            },
        ])
        expect(busTokens).toEqual([undefined, 'next'])
    })

    test('rejects a repeated continuation token instead of paging forever', async () => {
        for (const [kind, page] of [
            ['buses', {EventBuses: [{Name: 'orders', EventBusArn: BUS_ARN}], NextToken: 'repeat'}],
            ['subscribers', {Subscribers: [{Name: 'large-orders', SubscriberArn: SUBSCRIBER_ARN}], NextToken: 'repeat'}],
        ] as const) {
            let requests = 0
            const adapter = createAdapter(async () => {
                requests += 1
                if (requests > 2) throw new Error('unexpected third page request')
                return page
            })

            await expect(adapter.list({filters: {kind}})).rejects.toThrow('repeated a continuation token')
            expect(requests).toBe(2)
        }
    })

    test('lists only the kind the facet names', async () => {
        const commands: unknown[] = []
        const adapter = createAdapter(async (command) => {
            commands.push(command)
            return {Subscribers: []}
        })

        await adapter.list({filters: {kind: 'subscribers'}})

        expect(commands).toHaveLength(1)
        expect(commands[0]).toBeInstanceOf(ListSubscribersCommand)
        await expect(adapter.list({filters: {kind: 'rules'}})).rejects.toThrow('kind must be one of')
    })

    test('inspects a bus or subscriber by ARN and returns null when it does not exist', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeEventBusCommand) {
                expect(command.input.EventBusArn).toBe(BUS_ARN)
                return {Name: 'orders', EventBusArn: BUS_ARN, State: 'ACTIVE', StorageConfiguration: {RetentionPeriodInDays: 7}}
            }
            if (command instanceof DescribeSubscriberCommand) {
                expect(command.input.SubscriberArn).toBe(SUBSCRIBER_ARN)
                return {
                    Name: 'large-orders',
                    SubscriberArn: SUBSCRIBER_ARN,
                    EventBusArn: BUS_ARN,
                    InvokeConfiguration: {TargetArn: QUEUE_ARN, RoleArn: ROLE_ARN},
                    FilterConfiguration: {Filters: [{Scope: 'DATA', Pattern: '{"source":["com.shop"]}'}]},
                }
            }
            throw new Error('unexpected command')
        })

        await expect(adapter.get(`bus:${BUS_ARN}`)).resolves.toMatchObject({
            name: 'orders', metadata: {storageConfiguration: {RetentionPeriodInDays: 7}},
        })
        await expect(adapter.get(`subscriber:${SUBSCRIBER_ARN}`)).resolves.toMatchObject({
            name: 'large-orders',
            metadata: {targetArn: QUEUE_ARN, roleArn: ROLE_ARN, filterConfiguration: {Filters: [{Scope: 'DATA'}]}},
        })

        const missing = createAdapter(async () => {
            throw Object.assign(new Error('missing'), {name: 'ResourceNotFoundException'})
        })
        await expect(missing.get(`bus:${BUS_ARN}`)).resolves.toBeNull()
        await expect(missing.get('rule:orders')).rejects.toThrow('Unknown EventBridge V2 resource id')
    })

    test('creates an event bus', async () => {
        const commands: unknown[] = []
        const adapter = createAdapter(async (command) => {
            commands.push(command)
            return {EventBusArn: BUS_ARN, Name: 'orders', State: 'ACTIVE'}
        })

        await expect(adapter.create({values: {kind: 'buses', name: 'orders', description: 'Order events'}})).resolves.toMatchObject({
            id: `bus:${BUS_ARN}`, type: 'event-bus-v2', status: 'ACTIVE',
        })
        expect(commands[0]).toBeInstanceOf(CreateEventBusCommand)
        expect((commands[0] as CreateEventBusCommand).input).toEqual({Name: 'orders', Description: 'Order events'})
        await expect(adapter.create({values: {kind: 'buses', name: 'not valid'}})).rejects.toThrow('name must start')
    })

    test('creates a subscriber, resolving a bus name to its ARN', async () => {
        const commands: unknown[] = []
        const adapter = createAdapter(async (command) => {
            commands.push(command)
            if (command instanceof ListEventBusesCommand) {
                return {EventBuses: [{Name: 'orders-archive', EventBusArn: 'other'}, {Name: 'orders', EventBusArn: BUS_ARN}]}
            }
            return {SubscriberArn: SUBSCRIBER_ARN, Name: 'large-orders'}
        })

        await expect(adapter.create({values: {
            kind: 'subscribers',
            name: 'large-orders',
            eventBus: 'orders',
            targetArn: QUEUE_ARN,
            roleArn: ROLE_ARN,
            filterPattern: '{"detail":{"total":[{"numeric":[">",500]}]}}',
        }})).resolves.toMatchObject({
            id: `subscriber:${SUBSCRIBER_ARN}`, type: 'subscriber', metadata: {eventBusName: 'orders', targetArn: QUEUE_ARN},
        })

        expect((commands[0] as ListEventBusesCommand).input.NamePrefix).toBe('orders')
        expect(commands[1]).toBeInstanceOf(CreateSubscriberCommand)
        expect((commands[1] as CreateSubscriberCommand).input).toEqual({
            Name: 'large-orders',
            EventBusArn: BUS_ARN,
            Description: undefined,
            InvokeConfiguration: {TargetArn: QUEUE_ARN, RoleArn: ROLE_ARN},
            FilterConfiguration: {Filters: [{Scope: 'DATA', Pattern: '{"detail":{"total":[{"numeric":[">",500]}]}}'}]},
        })
    })

    test('refuses a subscriber with a missing field, an unknown bus, or a pattern that is not JSON', async () => {
        const adapter = createAdapter(async () => ({EventBuses: []}))
        const values = {kind: 'subscribers', name: 'large-orders', eventBus: 'orders', targetArn: QUEUE_ARN, roleArn: ROLE_ARN}

        await expect(adapter.create({values: {...values, roleArn: ''}})).rejects.toThrow('roleArn is required')
        await expect(adapter.create({values})).rejects.toThrow('event bus not found: orders')
        await expect(adapter.create({values: {...values, filterPattern: '{'}})).rejects.toThrow('filterPattern must be a JSON event pattern')
    })

    test('reports a create response without an ARN as a runtime failure', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListEventBusesCommand) return {EventBuses: [{Name: 'orders', EventBusArn: BUS_ARN}]}
            return {Name: 'orders'}
        })

        await expect(adapter.create({values: {kind: 'buses', name: 'orders'}})).rejects.toBeInstanceOf(RuntimeError)
        await expect(adapter.create({values: {
            kind: 'subscribers', name: 'large-orders', eventBus: 'orders', targetArn: QUEUE_ARN, roleArn: ROLE_ARN,
        }})).rejects.toThrow('CreateSubscriber did not return a SubscriberArn')
    })

    test('deletes a bus or subscriber by ARN', async () => {
        const commands: unknown[] = []
        const adapter = createAdapter(async (command) => {
            commands.push(command)
            return {}
        })

        await adapter.delete(`subscriber:${SUBSCRIBER_ARN}`)
        await adapter.delete(`bus:${BUS_ARN}`)

        expect(commands[0]).toBeInstanceOf(DeleteSubscriberCommand)
        expect((commands[0] as DeleteSubscriberCommand).input.SubscriberArn).toBe(SUBSCRIBER_ARN)
        expect(commands[1]).toBeInstanceOf(DeleteEventBusCommand)
        expect((commands[1] as DeleteEventBusCommand).input.EventBusArn).toBe(BUS_ARN)
    })
})

function createAdapter(handler: SendHandler = async () => ({EventBuses: [], Subscribers: []})): AwsEventBridgeV2Adapter {
    return new AwsEventBridgeV2Adapter({send: handler} as unknown as EventBridgeV2Client)
}
