import {describe, expect, test} from 'bun:test'
import {
    CreateEventBusCommand,
    DeleteEventBusCommand,
    DescribeEventBusCommand,
    ListEventBusesCommand,
    type EventBridgeClient,
} from '@aws-sdk/client-eventbridge'
import {
    CreateScheduleCommand,
    DeleteScheduleCommand,
    GetScheduleCommand,
    ListSchedulesCommand,
    type SchedulerClient,
} from '@aws-sdk/client-scheduler'
import {AwsEventBridgeAdapter} from './AwsEventBridgeAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

describe('AwsEventBridgeAdapter', () => {
    test('schema exposes EventBridge event buses and Scheduler schedules', () => {
        const adapter = createAdapter()
        const schema = adapter.schema()

        expect(schema.cloud).toBe('aws')
        expect(schema.service).toBe('messaging')
        expect(schema.displayName).toBe('EventBridge')
        expect(schema.fields.find((field) => field.name === 'resourceType')?.options).toEqual([
            {label: 'Event bus', value: 'event-bus'},
            {label: 'Scheduler schedule', value: 'schedule'},
        ])
        expect(schema.fields.find((field) => field.name === 'name')?.validation).toMatchObject({
            maxLength: 256,
            maxLengthWhen: {
                field: 'resourceType',
                equals: 'schedule',
                value: 64,
            },
        })
        expect(schema.actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('list still returns event buses when Scheduler is not implemented', async () => {
        const adapter = createAdapter(
            async () => ({EventBuses: [{Name: 'orders', Arn: 'arn:aws:events:us-east-1:000000000000:event-bus/orders'}]}),
            async () => {
                throw Object.assign(new Error('Scheduler is unavailable'), {$metadata: {httpStatusCode: 501}})
            },
        )

        const resources = await adapter.list()

        expect(resources.map((resource) => resource.id)).toEqual(['event-bus:orders'])
    })

    test('list surfaces a Scheduler failure that is not a missing implementation', async () => {
        const adapter = createAdapter(
            async () => ({EventBuses: [{Name: 'orders', Arn: 'arn:aws:events:us-east-1:000000000000:event-bus/orders'}]}),
            async () => {
                throw new Error('Scheduler request failed')
            },
        )

        await expect(adapter.list()).rejects.toThrow('Scheduler request failed')
    })

    test('list combines event buses and schedules as normalized resources', async () => {
        const adapter = createAdapter(
            async (command) => {
                expect(command).toBeInstanceOf(ListEventBusesCommand)
                return {EventBuses: [{
                    Name: 'orders',
                    Arn: 'arn:aws:events:us-east-1:000000000000:event-bus/orders',
                    Description: 'Order events',
                    CreationTime: new Date('2026-07-01T10:00:00Z'),
                }]}
            },
            async (command) => {
                expect(command).toBeInstanceOf(ListSchedulesCommand)
                return {Schedules: [{
                    Name: 'hourly-report',
                    GroupName: 'reports',
                    Arn: 'arn:aws:scheduler:us-east-1:000000000000:schedule/reports/hourly-report',
                    State: 'ENABLED',
                    CreationDate: new Date('2026-07-02T10:00:00Z'),
                    Target: {Arn: 'arn:aws:lambda:us-east-1:000000000000:function:report'},
                }]}
            },
        )

        const resources = await adapter.list()

        expect(resources).toHaveLength(2)
        expect(resources[0]).toMatchObject({
            id: 'event-bus:orders',
            name: 'orders',
            service: 'messaging',
            type: 'event-bus',
            region: 'us-east-1',
            createdAt: '2026-07-01T10:00:00.000Z',
        })
        expect(resources[1]).toMatchObject({
            id: 'schedule:reports/hourly-report',
            name: 'hourly-report',
            service: 'messaging',
            type: 'schedule',
            status: 'ENABLED',
            metadata: {groupName: 'reports'},
        })
    })

    test('list follows pagination tokens for event buses and schedules', async () => {
        const eventbridgeTokens: (string | undefined)[] = []
        const schedulerTokens: (string | undefined)[] = []
        const adapter = createAdapter(
            async (command) => {
                expect(command).toBeInstanceOf(ListEventBusesCommand)
                const token = (command as ListEventBusesCommand).input.NextToken
                eventbridgeTokens.push(token)
                return token
                    ? {EventBuses: [{Name: 'billing'}]}
                    : {EventBuses: [{Name: 'orders'}], NextToken: 'event-buses-page-2'}
            },
            async (command) => {
                expect(command).toBeInstanceOf(ListSchedulesCommand)
                const token = (command as ListSchedulesCommand).input.NextToken
                schedulerTokens.push(token)
                return token
                    ? {Schedules: [{Name: 'weekly', GroupName: 'reports'}]}
                    : {Schedules: [{Name: 'nightly', GroupName: 'default'}], NextToken: 'schedules-page-2'}
            },
        )

        const resources = await adapter.list()

        expect(eventbridgeTokens).toEqual([undefined, 'event-buses-page-2'])
        expect(schedulerTokens).toEqual([undefined, 'schedules-page-2'])
        expect(resources.map((resource) => resource.id)).toEqual([
            'event-bus:orders',
            'event-bus:billing',
            'schedule:default/nightly',
            'schedule:reports/weekly',
        ])
    })

    test('list filters both resource kinds by name or type', async () => {
        const adapter = createAdapter(
            async () => ({EventBuses: [{Name: 'orders'}]}),
            async () => ({Schedules: [{Name: 'nightly', GroupName: 'default'}]}),
        )

        await expect(adapter.list({search: 'night'})).resolves.toMatchObject([{name: 'nightly'}])
        await expect(adapter.list({search: 'event-bus'})).resolves.toMatchObject([{name: 'orders'}])
    })

    test('get inspects detailed event bus and schedule resources', async () => {
        const adapter = createAdapter(
            async (command) => {
                expect(command).toBeInstanceOf(DescribeEventBusCommand)
                expect((command as DescribeEventBusCommand).input.Name).toBe('orders')
                return {
                    Name: 'orders',
                    Arn: 'arn:aws:events:eu-west-2:000000000000:event-bus/orders',
                    Description: 'Order events',
                }
            },
            async (command) => {
                expect(command).toBeInstanceOf(GetScheduleCommand)
                expect((command as GetScheduleCommand).input).toMatchObject({Name: 'nightly', GroupName: 'reports'})
                return {
                    Name: 'nightly',
                    GroupName: 'reports',
                    Arn: 'arn:aws:scheduler:eu-west-2:000000000000:schedule/reports/nightly',
                    State: 'DISABLED',
                    ScheduleExpression: 'rate(1 day)',
                    ScheduleExpressionTimezone: 'Europe/London',
                    FlexibleTimeWindow: {Mode: 'OFF'},
                    Target: {
                        Arn: 'arn:aws:lambda:eu-west-2:000000000000:function:report',
                        RoleArn: 'arn:aws:iam::000000000000:role/scheduler',
                    },
                }
            },
        )

        await expect(adapter.get('event-bus:orders')).resolves.toMatchObject({
            type: 'event-bus',
            region: 'eu-west-2',
            metadata: {description: 'Order events'},
        })
        await expect(adapter.get('schedule:reports/nightly')).resolves.toMatchObject({
            type: 'schedule',
            status: 'DISABLED',
            metadata: {
                groupName: 'reports',
                scheduleExpression: 'rate(1 day)',
                scheduleExpressionTimezone: 'Europe/London',
            },
        })
    })

    test('create dispatches event buses and schedules to their AWS clients', async () => {
        const eventbridgeCommands: unknown[] = []
        const schedulerCommands: unknown[] = []
        const adapter = createAdapter(
            async (command) => {
                eventbridgeCommands.push(command)
                return {EventBusArn: 'arn:aws:events:us-east-1:000000000000:event-bus/orders'}
            },
            async (command) => {
                schedulerCommands.push(command)
                return {ScheduleArn: 'arn:aws:scheduler:us-east-1:000000000000:schedule/reports/hourly-report'}
            },
        )

        const eventBus = await adapter.create({values: {
            resourceType: 'event-bus',
            name: 'orders',
            description: 'Order events',
        }})
        const schedule = await adapter.create({values: {
            resourceType: 'schedule',
            name: 'hourly-report',
            groupName: 'reports',
            description: 'Generate reports',
            scheduleExpression: 'rate(1 hour)',
            scheduleExpressionTimezone: 'Europe/London',
            state: 'DISABLED',
            targetArn: 'arn:aws:lambda:us-east-1:000000000000:function:report',
            roleArn: 'arn:aws:iam::000000000000:role/scheduler',
            targetInput: '{"source":"scheduler"}',
        }})

        expect(eventbridgeCommands[0]).toBeInstanceOf(CreateEventBusCommand)
        expect((eventbridgeCommands[0] as CreateEventBusCommand).input).toEqual({
            Name: 'orders',
            Description: 'Order events',
        })
        expect(schedulerCommands[0]).toBeInstanceOf(CreateScheduleCommand)
        expect((schedulerCommands[0] as CreateScheduleCommand).input).toMatchObject({
            Name: 'hourly-report',
            GroupName: 'reports',
            ScheduleExpression: 'rate(1 hour)',
            ScheduleExpressionTimezone: 'Europe/London',
            State: 'DISABLED',
            FlexibleTimeWindow: {Mode: 'OFF'},
            Target: {
                Arn: 'arn:aws:lambda:us-east-1:000000000000:function:report',
                RoleArn: 'arn:aws:iam::000000000000:role/scheduler',
                Input: '{"source":"scheduler"}',
            },
        })
        expect(eventBus.id).toBe('event-bus:orders')
        expect(schedule.id).toBe('schedule:reports/hourly-report')
    })

    test('create validates schedule-only required fields', async () => {
        const adapter = createAdapter()

        await expect(adapter.create({values: {
            resourceType: 'schedule',
            name: 'nightly',
        }})).rejects.toThrow('scheduleExpression is required')
    })

    test('delete dispatches by normalized resource id', async () => {
        const eventbridgeCommands: unknown[] = []
        const schedulerCommands: unknown[] = []
        const adapter = createAdapter(
            async (command) => { eventbridgeCommands.push(command); return {} },
            async (command) => { schedulerCommands.push(command); return {} },
        )

        await adapter.delete('event-bus:orders')
        await adapter.delete('schedule:reports/nightly')

        expect(eventbridgeCommands[0]).toBeInstanceOf(DeleteEventBusCommand)
        expect((eventbridgeCommands[0] as DeleteEventBusCommand).input.Name).toBe('orders')
        expect(schedulerCommands[0]).toBeInstanceOf(DeleteScheduleCommand)
        expect((schedulerCommands[0] as DeleteScheduleCommand).input).toMatchObject({Name: 'nightly', GroupName: 'reports'})
    })

    test('get returns null for missing AWS resources', async () => {
        const missing = Object.assign(new Error('missing'), {name: 'ResourceNotFoundException'})
        const adapter = createAdapter(async () => { throw missing }, async () => { throw missing })

        await expect(adapter.get('event-bus:missing')).resolves.toBeNull()
        await expect(adapter.get('schedule:default/missing')).resolves.toBeNull()
    })
})

function createAdapter(
    eventbridgeHandler: SendHandler = async () => ({EventBuses: []}),
    schedulerHandler: SendHandler = async () => ({Schedules: []}),
): AwsEventBridgeAdapter {
    const eventbridge = {send: eventbridgeHandler} as unknown as EventBridgeClient
    const scheduler = {send: schedulerHandler} as unknown as SchedulerClient
    return new AwsEventBridgeAdapter(eventbridge, scheduler)
}
