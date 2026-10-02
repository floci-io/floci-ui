import {
    DeleteAlarmsCommand,
    DescribeAlarmsCommand,
    PutMetricAlarmCommand,
    type CloudWatchClient,
    type ComparisonOperator,
    type MetricAlarm,
    type Statistic,
} from '@aws-sdk/client-cloudwatch'
import {
    awsCloudWatchSchema,
    CLOUDWATCH_COMPARISON_OPERATORS,
    CLOUDWATCH_STATISTICS,
} from '../cloud-spi/cloudwatchSchema'
import {ConflictError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const CONDITION_SYMBOL: Record<string, string> = {
    GreaterThanOrEqualToThreshold: '>=',
    GreaterThanThreshold: '>',
    LessThanThreshold: '<',
    LessThanOrEqualToThreshold: '<=',
}

export class AwsCloudWatchAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'cloudwatch' as const

    /**
     * One adapter exists per account-scoped registry and alarms live inside the
     * account, so serializing per alarm name here is serializing per account and
     * name. PutMetricAlarm is an upsert, so without it two concurrent creates can
     * both pass the existence check and the second silently replaces the first.
     */
    private readonly createLocks = new Map<string, Promise<unknown>>()

    constructor(private readonly cloudwatch: CloudWatchClient) {}

    schema(): ServiceSchema {
        return awsCloudWatchSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const prefix = query.search?.trim()
        const alarms: CloudResource[] = []
        const seenTokens = new Set<string>()
        let nextToken: string | undefined
        do {
            const response = await this.cloudwatch.send(new DescribeAlarmsCommand({
                AlarmTypes: ['MetricAlarm'],
                NextToken: nextToken,
                ...(prefix ? {AlarmNamePrefix: prefix} : {}),
            }))
            for (const alarm of response.MetricAlarms ?? []) {
                if (alarm.AlarmName) alarms.push(alarmResource(alarm))
            }
            nextToken = response.NextToken
            if (nextToken) {
                if (seenTokens.has(nextToken)) throw new RuntimeError('CloudWatch DescribeAlarms repeated a continuation token')
                seenTokens.add(nextToken)
            }
        } while (nextToken)
        return alarms
    }

    async get(id: string): Promise<CloudResource | null> {
        const response = await this.cloudwatch.send(new DescribeAlarmsCommand({AlarmNames: [id], AlarmTypes: ['MetricAlarm']}))
        const alarm = response.MetricAlarms?.find((candidate) => candidate.AlarmName === id)
        return alarm ? alarmResource(alarm) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const values = input.values
        const name = text(values.name)
        const namespace = text(values.namespace)
        const metricName = text(values.metricName)
        if (!name || name.length > 255) throw new ValidationError('Alarm name must be 1 to 255 characters.')
        if (!namespace || !metricName) throw new ValidationError('Namespace and metric name are required.')

        const statistic = text(values.statistic)
        if (!(CLOUDWATCH_STATISTICS as readonly string[]).includes(statistic)) {
            throw new ValidationError(`Statistic must be one of ${CLOUDWATCH_STATISTICS.join(', ')}.`)
        }
        const comparison = text(values.comparisonOperator)
        if (!(CLOUDWATCH_COMPARISON_OPERATORS as readonly string[]).includes(comparison)) {
            throw new ValidationError(`Comparison must be one of ${CLOUDWATCH_COMPARISON_OPERATORS.join(', ')}.`)
        }
        const threshold = Number(text(values.threshold))
        if (text(values.threshold) === '' || !Number.isFinite(threshold)) throw new ValidationError('Threshold must be a number.')
        const period = wholeNumber(values.period, 'Period')
        const evaluationPeriods = wholeNumber(values.evaluationPeriods, 'Evaluation periods')

        return this.withCreateLock(name, async () => {
            if (await this.get(name)) throw new ConflictError(`Alarm ${name} already exists.`)

            await this.cloudwatch.send(new PutMetricAlarmCommand({
                AlarmName: name,
                Namespace: namespace,
                MetricName: metricName,
                Statistic: statistic as Statistic,
                ComparisonOperator: comparison as ComparisonOperator,
                Threshold: threshold,
                Period: period,
                EvaluationPeriods: evaluationPeriods,
            }))
            const created = await this.get(name)
            if (!created) throw new RuntimeError('PutMetricAlarm succeeded but the alarm was not returned by DescribeAlarms')
            return created
        })
    }

    /**
     * Chains callers of the same name so each runs after the last settles, and
     * drops the entry once nothing is queued behind it.
     */
    private withCreateLock<T>(key: string, action: () => Promise<T>): Promise<T> {
        const previous = this.createLocks.get(key) ?? Promise.resolve()
        const run = previous.catch(() => undefined).then(action)
        const tracked = run.catch(() => undefined)
        this.createLocks.set(key, tracked)
        void tracked.then(() => {
            if (this.createLocks.get(key) === tracked) this.createLocks.delete(key)
        })
        return run
    }

    async delete(id: string): Promise<void> {
        await this.cloudwatch.send(new DeleteAlarmsCommand({AlarmNames: [id]}))
    }

    async health(): Promise<void> {
        await this.cloudwatch.send(new DescribeAlarmsCommand({MaxRecords: 1}))
    }
}

function alarmResource(alarm: MetricAlarm): CloudResource {
    const arn = alarm.AlarmArn ?? null
    const name = alarm.AlarmName ?? ''
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'cloudwatch',
        type: 'metric-alarm',
        region: arn?.split(':')[3] || null,
        createdAt: alarm.AlarmConfigurationUpdatedTimestamp?.toISOString() ?? null,
        metadata: {
            provider: 'aws',
            arn,
            state: alarm.StateValue ?? null,
            stateReason: alarm.StateReason ?? null,
            stateUpdatedAt: alarm.StateUpdatedTimestamp?.toISOString() ?? null,
            namespace: alarm.Namespace ?? null,
            metricName: alarm.MetricName ?? null,
            dimensions: alarm.Dimensions ?? [],
            metric: alarm.Namespace && alarm.MetricName ? `${alarm.Namespace} / ${alarm.MetricName}` : null,
            statistic: alarm.Statistic ?? null,
            comparisonOperator: alarm.ComparisonOperator ?? null,
            threshold: alarm.Threshold ?? null,
            condition: condition(alarm),
            period: alarm.Period ?? null,
            evaluationPeriods: alarm.EvaluationPeriods ?? null,
            actionsEnabled: alarm.ActionsEnabled ?? null,
            alarmActions: alarm.AlarmActions ?? [],
            okActions: alarm.OKActions ?? [],
            insufficientDataActions: alarm.InsufficientDataActions ?? [],
            description: alarm.AlarmDescription ?? null,
        },
    }
}

function condition(alarm: MetricAlarm): string | null {
    const symbol = alarm.ComparisonOperator ? CONDITION_SYMBOL[alarm.ComparisonOperator] : undefined
    if (!symbol || alarm.Threshold === undefined) return null
    const statistic = alarm.Statistic ?? alarm.ExtendedStatistic ?? ''
    return `${statistic} ${symbol} ${alarm.Threshold}`.trim()
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function wholeNumber(value: unknown, label: string): number {
    const parsed = Number(text(value))
    if (!Number.isInteger(parsed) || parsed < 1) throw new ValidationError(`${label} must be a positive whole number.`)
    return parsed
}
