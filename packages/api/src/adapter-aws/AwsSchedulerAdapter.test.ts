import {describe, expect, test} from 'bun:test'
import {
    CreateScheduleCommand,
    DeleteScheduleCommand,
    GetScheduleCommand,
    ListSchedulesCommand,
    type SchedulerClient,
} from '@aws-sdk/client-scheduler'
import {AwsSchedulerAdapter} from './AwsSchedulerAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

describe('AwsSchedulerAdapter', () => {
    test('exposes EventBridge Scheduler through the neutral scheduler category', () => {
        const adapter = createAdapter()

        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'scheduler', displayName: 'EventBridge Scheduler'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(adapter.descriptorOverride()).toEqual({displayName: 'EventBridge Scheduler'})
    })

    test('lists every page and filters by schedule name', async () => {
        const tokens: Array<string | undefined> = []
        const detailInputs: Array<{Name?: string; GroupName?: string}> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListSchedulesCommand) {
                const token = command.input.NextToken
                tokens.push(token)
                return token
                    ? {Schedules: [{Name: 'nightly', GroupName: 'ops', Arn: 'arn:aws:scheduler:us-west-2:000000000000:schedule/ops/nightly', State: 'ENABLED'}]}
                    : {Schedules: [{Name: 'hourly', GroupName: 'ops', Arn: 'arn:aws:scheduler:us-west-2:000000000000:schedule/ops/hourly'}], NextToken: 'next'}
            }
            expect(command).toBeInstanceOf(GetScheduleCommand)
            detailInputs.push((command as GetScheduleCommand).input)
            return {
                Name: 'nightly', GroupName: 'ops',
                ScheduleExpression: 'cron(0 2 * * ? *)', ScheduleExpressionTimezone: 'America/Los_Angeles',
            }
        })

        await expect(adapter.list({search: ' NIGHT '})).resolves.toMatchObject([
            {
                id: 'schedule:ops/nightly', name: 'nightly', region: 'us-west-2', type: 'scheduler-job',
                metadata: {schedule: 'cron(0 2 * * ? *)', timeZone: 'America/Los_Angeles'},
            },
        ])
        expect(tokens).toEqual([undefined, 'next'])
        expect(detailInputs).toEqual([{Name: 'nightly', GroupName: 'ops'}])
    })

    test('bounds detail requests and preserves list order', async () => {
        let active = 0
        let peak = 0
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListSchedulesCommand) {
                return {Schedules: Array.from({length: 11}, (_, index) => ({Name: `job-${index}`, GroupName: 'ops'}))}
            }
            expect(command).toBeInstanceOf(GetScheduleCommand)
            active++
            peak = Math.max(peak, active)
            await Promise.resolve()
            active--
            return {ScheduleExpression: `rate(${(command as GetScheduleCommand).input.Name})`}
        })

        const resources = await adapter.list()
        expect(resources.map(({name}) => name)).toEqual(Array.from({length: 11}, (_, index) => `job-${index}`))
        expect(resources[10]?.metadata.schedule).toBe('rate(job-10)')
        expect(peak).toBe(5)
    })

    test('omits schedules deleted between list and get but propagates other detail failures', async () => {
        const missing = Object.assign(new Error('deleted'), {name: 'ResourceNotFoundException'})
        const failure = Object.assign(new Error('access denied'), {name: 'AccessDeniedException'})
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListSchedulesCommand) {
                return {Schedules: [{Name: 'deleted', GroupName: 'ops'}, {Name: 'live', GroupName: 'ops'}]}
            }
            if ((command as GetScheduleCommand).input.Name === 'deleted') throw missing
            return {ScheduleExpression: 'rate(1 day)'}
        })
        await expect(adapter.list()).resolves.toMatchObject([{
            id: 'schedule:ops/live', metadata: {schedule: 'rate(1 day)'},
        }])

        const failing = createAdapter(async (command) => {
            if (command instanceof ListSchedulesCommand) return {Schedules: [{Name: 'blocked', GroupName: 'ops'}]}
            throw failure
        })
        await expect(failing.list()).rejects.toBe(failure)
    })

    test('gets a schedule by group and name and handles not found', async () => {
        const adapter = createAdapter(async (command) => {
            expect(command).toBeInstanceOf(GetScheduleCommand)
            expect((command as GetScheduleCommand).input).toEqual({Name: 'nightly', GroupName: 'ops'})
            return {
                Name: 'nightly', GroupName: 'ops',
                Arn: 'arn:aws:scheduler:eu-west-1:000000000000:schedule/ops/nightly',
                ScheduleExpression: 'cron(0 2 * * ? *)', ScheduleExpressionTimezone: 'UTC',
                State: 'DISABLED', Target: {Arn: 'arn:aws:lambda:eu-west-1:000000000000:function:backup'},
            }
        })

        await expect(adapter.get('schedule:ops/nightly')).resolves.toMatchObject({
            id: 'schedule:ops/nightly', name: 'nightly', status: 'DISABLED', region: 'eu-west-1',
            metadata: {scheduleExpression: 'cron(0 2 * * ? *)', targetArn: 'arn:aws:lambda:eu-west-1:000000000000:function:backup'},
        })

        const missing = createAdapter(async () => {
            throw Object.assign(new Error('missing'), {name: 'ResourceNotFoundException'})
        })
        await expect(missing.get('schedule:ops/missing')).resolves.toBeNull()
    })

    test('includes complete target and flexible window only in inspect metadata', async () => {
        const target = {
            Arn: 'arn:aws:lambda:us-east-1:000000000000:function:backup',
            RoleArn: 'arn:aws:iam::000000000000:role/scheduler',
            Input: '{"backup":"nightly"}',
            RetryPolicy: {MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600},
            DeadLetterConfig: {Arn: 'arn:aws:sqs:us-east-1:000000000000:failed-jobs'},
        }
        const flexibleTimeWindow = {Mode: 'FLEXIBLE', MaximumWindowInMinutes: 15}
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListSchedulesCommand) {
                return {Schedules: [{Name: 'nightly', GroupName: 'ops'}]}
            }
            expect(command).toBeInstanceOf(GetScheduleCommand)
            return {Name: 'nightly', GroupName: 'ops', Target: target, FlexibleTimeWindow: flexibleTimeWindow}
        })

        const [listed] = await adapter.list()
        expect(listed.metadata.target).toBe(target.Arn)
        expect(listed.metadata).not.toHaveProperty('targetDetails')
        expect(listed.metadata).not.toHaveProperty('flexibleTimeWindow')

        const inspected = await adapter.get('schedule:ops/nightly')
        expect(inspected?.metadata.target).toBe(target.Arn)
        expect(inspected?.metadata.targetDetails).toEqual(target)
        expect(inspected?.metadata.flexibleTimeWindow).toEqual(flexibleTimeWindow)
    })

    test('creates and deletes a schedule with normalized defaults', async () => {
        const commands: unknown[] = []
        const adapter = createAdapter(async (command) => {
            commands.push(command)
            return {ScheduleArn: 'arn:aws:scheduler:us-east-1:000000000000:schedule/ops/nightly'}
        })

        await expect(adapter.create({values: {
            name: 'nightly', groupName: 'ops', scheduleExpression: 'rate(1 day)',
            targetArn: 'arn:aws:lambda:us-east-1:000000000000:function:backup', roleArn: 'arn:aws:iam::000000000000:role/scheduler',
        }})).resolves.toMatchObject({
            id: 'schedule:ops/nightly', status: 'ENABLED',
            metadata: {arn: 'arn:aws:scheduler:us-east-1:000000000000:schedule/ops/nightly', flexibleTimeWindowMode: 'OFF'},
        })
        await adapter.delete('schedule:ops/nightly')

        expect(commands[0]).toBeInstanceOf(CreateScheduleCommand)
        expect((commands[0] as CreateScheduleCommand).input).toEqual({
            Name: 'nightly', GroupName: 'ops', ScheduleExpression: 'rate(1 day)', State: 'ENABLED',
            FlexibleTimeWindow: {Mode: 'OFF'},
            Target: {Arn: 'arn:aws:lambda:us-east-1:000000000000:function:backup', RoleArn: 'arn:aws:iam::000000000000:role/scheduler'},
        })
        expect(commands[1]).toBeInstanceOf(DeleteScheduleCommand)
        expect((commands[1] as DeleteScheduleCommand).input).toEqual({Name: 'nightly', GroupName: 'ops'})
    })

    test('rejects missing required values and invalid enum values', async () => {
        const adapter = createAdapter()
        await expect(adapter.create({values: {name: 'nightly'}})).rejects.toThrow('scheduleExpression is required')
        await expect(adapter.create({values: {
            name: 'nightly', scheduleExpression: 'rate(1 day)', targetArn: 'arn:target', roleArn: 'arn:role', state: 'paused',
        }})).rejects.toThrow('state must be ENABLED or DISABLED')
        await expect(adapter.create({values: {
            name: 'nightly', scheduleExpression: 'rate(1 day)', targetArn: 'arn:target', roleArn: 'arn:role',
            flexibleTimeWindowMode: 'FLEXIBLE',
        }})).rejects.toThrow('flexibleTimeWindowMode must be OFF')
    })

    test('propagates invalid schedule expressions from the AWS endpoint', async () => {
        const invalidExpression = Object.assign(new Error('Invalid ScheduleExpression'), {name: 'ValidationException'})
        const adapter = createAdapter(async (command) => {
            expect(command).toBeInstanceOf(CreateScheduleCommand)
            throw invalidExpression
        })
        await expect(adapter.create({values: {
            name: 'nightly', scheduleExpression: 'invalid', targetArn: 'arn:target', roleArn: 'arn:role',
        }})).rejects.toBe(invalidExpression)
    })

    test('health probes a single list page without loading schedule details', async () => {
        const commands: unknown[] = []
        const adapter = createAdapter(async (command) => {
            commands.push(command)
            return {Schedules: [{Name: 'nightly'}], NextToken: 'next'}
        })

        await adapter.health()

        expect(commands).toHaveLength(1)
        expect(commands[0]).toBeInstanceOf(ListSchedulesCommand)
        expect((commands[0] as ListSchedulesCommand).input).toEqual({MaxResults: 1})
    })

    test('health propagates Scheduler list failures', async () => {
        const failure = Object.assign(new Error('service unavailable'), {name: 'ServiceUnavailableException'})
        const adapter = createAdapter(async (command) => {
            expect(command).toBeInstanceOf(ListSchedulesCommand)
            throw failure
        })

        await expect(adapter.health()).rejects.toBe(failure)
    })
})

function createAdapter(handler: SendHandler = async () => ({Schedules: []})): AwsSchedulerAdapter {
    return new AwsSchedulerAdapter({send: handler} as unknown as SchedulerClient)
}
