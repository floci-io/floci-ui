import {describe, expect, test} from 'bun:test'
import {
    DeleteAlarmsCommand,
    DescribeAlarmsCommand,
    PutMetricAlarmCommand,
    type CloudWatchClient,
    type MetricAlarm,
} from '@aws-sdk/client-cloudwatch'
import {AwsCloudWatchAdapter} from './AwsCloudWatchAdapter'
import {ConflictError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const ALARM: MetricAlarm = {
    AlarmName: 'queue-depth',
    AlarmArn: 'arn:aws:cloudwatch:us-east-1:000000000000:alarm:queue-depth',
    StateValue: 'INSUFFICIENT_DATA',
    StateReason: 'Unchecked',
    Namespace: 'AWS/SQS',
    MetricName: 'ApproximateNumberOfMessagesVisible',
    Statistic: 'Average',
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 100,
    Period: 60,
    EvaluationPeriods: 1,
    ActionsEnabled: true,
}

const VALID = {
    name: 'queue-depth',
    namespace: 'AWS/SQS',
    metricName: 'ApproximateNumberOfMessagesVisible',
    statistic: 'Average',
    comparisonOperator: 'GreaterThanThreshold',
    threshold: '100',
    period: '60',
    evaluationPeriods: '1',
}

function stubCloudWatch(options: {
    pages?: Array<{MetricAlarms?: MetricAlarm[]; NextToken?: string}>
    existing?: boolean
} = {}) {
    const sent: object[] = []
    let stored = options.existing ?? false
    const client = {
        async send(command: object) {
            sent.push(command)
            if (command instanceof PutMetricAlarmCommand) {
                stored = true
                return {}
            }
            if (command instanceof DescribeAlarmsCommand) {
                if (command.input.AlarmNames) return {MetricAlarms: stored ? [ALARM] : []}
                const index = command.input.NextToken ? Number(command.input.NextToken) : 0
                return options.pages?.[index] ?? {MetricAlarms: [ALARM]}
            }
            return {}
        },
    } as unknown as CloudWatchClient
    return {client, sent}
}

describe('AwsCloudWatchAdapter', () => {
    test('exposes an AWS CloudWatch alarms schema', () => {
        const adapter = new AwsCloudWatchAdapter(stubCloudWatch().client)
        expect(adapter.service).toBe('cloudwatch')
        expect(adapter.schema().actions).toEqual(['list', 'create', 'inspect', 'delete'])
    })

    test('lists every page of metric alarms using the alarm name as id', async () => {
        const {client, sent} = stubCloudWatch({pages: [
            {MetricAlarms: [ALARM], NextToken: '1'},
            {MetricAlarms: [{...ALARM, AlarmName: 'cpu-high'}]},
        ]})
        const alarms = await new AwsCloudWatchAdapter(client).list()

        expect(alarms.map(({id}) => id)).toEqual(['queue-depth', 'cpu-high'])
        expect((sent[0] as DescribeAlarmsCommand).input.AlarmTypes).toEqual(['MetricAlarm'])
        expect((sent[1] as DescribeAlarmsCommand).input.NextToken).toBe('1')
    })

    test('searches by name prefix on the provider side', async () => {
        const {client, sent} = stubCloudWatch()
        await new AwsCloudWatchAdapter(client).list({search: ' queue '})
        expect((sent[0] as DescribeAlarmsCommand).input.AlarmNamePrefix).toBe('queue')
    })

    test('rejects a repeated continuation token', async () => {
        const {client} = stubCloudWatch({pages: [
            {MetricAlarms: [ALARM], NextToken: '1'},
            {MetricAlarms: [ALARM], NextToken: '1'},
            {MetricAlarms: [ALARM], NextToken: '1'},
        ]})
        await expect(new AwsCloudWatchAdapter(client).list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('maps alarm fields into metadata', async () => {
        const resource = await new AwsCloudWatchAdapter(stubCloudWatch({existing: true}).client).get('queue-depth')

        expect(resource).toMatchObject({
            id: 'queue-depth',
            type: 'metric-alarm',
            region: 'us-east-1',
            metadata: {
                arn: ALARM.AlarmArn,
                state: 'INSUFFICIENT_DATA',
                metric: 'AWS/SQS / ApproximateNumberOfMessagesVisible',
                condition: 'Average > 100',
                period: 60,
            },
        })
    })

    test('returns null when the alarm does not exist', async () => {
        expect(await new AwsCloudWatchAdapter(stubCloudWatch().client).get('missing')).toBeNull()
    })

    test('creates an alarm with numeric inputs and reads it back', async () => {
        const {client, sent} = stubCloudWatch()
        const created = await new AwsCloudWatchAdapter(client).create({values: VALID})

        const put = sent.find((command) => command instanceof PutMetricAlarmCommand) as PutMetricAlarmCommand
        expect(put.input).toEqual({
            AlarmName: 'queue-depth',
            Namespace: 'AWS/SQS',
            MetricName: 'ApproximateNumberOfMessagesVisible',
            Statistic: 'Average',
            ComparisonOperator: 'GreaterThanThreshold',
            Threshold: 100,
            Period: 60,
            EvaluationPeriods: 1,
        })
        expect(created.id).toBe('queue-depth')
    })

    test('refuses to overwrite an existing alarm', async () => {
        const {client, sent} = stubCloudWatch({existing: true})
        await expect(new AwsCloudWatchAdapter(client).create({values: VALID})).rejects.toBeInstanceOf(ConflictError)
        expect(sent.some((command) => command instanceof PutMetricAlarmCommand)).toBe(false)
    })

    test.each([
        ['empty name', {name: ' '}],
        ['missing namespace', {namespace: ''}],
        ['unknown statistic', {statistic: 'Median'}],
        ['unknown comparison', {comparisonOperator: 'Equal'}],
        ['non numeric threshold', {threshold: 'high'}],
        ['empty threshold', {threshold: ''}],
        ['zero period', {period: '0'}],
        ['fractional evaluation periods', {evaluationPeriods: '1.5'}],
    ])('rejects %s before calling the runtime', async (_label, override) => {
        const {client, sent} = stubCloudWatch()
        await expect(new AwsCloudWatchAdapter(client).create({values: {...VALID, ...override}}))
            .rejects.toBeInstanceOf(ValidationError)
        expect(sent).toHaveLength(0)
    })

    test('accepts a negative or decimal threshold', async () => {
        const {client, sent} = stubCloudWatch()
        await new AwsCloudWatchAdapter(client).create({values: {...VALID, threshold: '-0.5'}})
        const put = sent.find((command) => command instanceof PutMetricAlarmCommand) as PutMetricAlarmCommand
        expect(put.input.Threshold).toBe(-0.5)
    })

    test('deletes by alarm name', async () => {
        const {client, sent} = stubCloudWatch()
        await new AwsCloudWatchAdapter(client).delete('queue-depth')
        expect((sent[0] as DeleteAlarmsCommand).input.AlarmNames).toEqual(['queue-depth'])
    })
})
