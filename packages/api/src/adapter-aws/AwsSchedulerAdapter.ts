import {
    CreateScheduleCommand,
    DeleteScheduleCommand,
    GetScheduleCommand,
    ListSchedulesCommand,
    type GetScheduleOutput,
    type ScheduleSummary,
    type SchedulerClient,
} from '@aws-sdk/client-scheduler'
import {awsSchedulerSchema} from '../cloud-spi/schedulerSchema'
import {ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const SCHEDULE_PREFIX = 'schedule:'
const DEFAULT_GROUP = 'default'
const DETAIL_BATCH_SIZE = 5

type SchedulerRecord = Omit<GetScheduleOutput, 'Target'> & {
    Target?: GetScheduleOutput['Target'] | ScheduleSummary['Target']
}

/** AWS EventBridge Scheduler schedules through the neutral Scheduler category. */
export class AwsSchedulerAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'scheduler' as const

    constructor(private readonly scheduler: SchedulerClient) {}

    schema(): ServiceSchema {
        return awsSchedulerSchema()
    }

    descriptorOverride(): {displayName: string} {
        return {displayName: 'EventBridge Scheduler'}
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const schedules: ScheduleSummary[] = []
        let nextToken: string | undefined
        do {
            const response = await this.scheduler.send(new ListSchedulesCommand({NextToken: nextToken}))
            schedules.push(...(response.Schedules ?? []))
            nextToken = response.NextToken
        } while (nextToken)

        const search = query.search?.trim().toLowerCase()
        const matching = schedules.filter((schedule): schedule is ScheduleSummary & {Name: string} => {
            const name = schedule.Name
            return !!name && (!search || name.toLowerCase().includes(search))
        })
        const resources: CloudResource[] = []
        for (let offset = 0; offset < matching.length; offset += DETAIL_BATCH_SIZE) {
            const batch = await Promise.all(matching.slice(offset, offset + DETAIL_BATCH_SIZE).map(async (schedule) => {
                const detail = await this.loadSchedule(schedule.Name, schedule.GroupName ?? DEFAULT_GROUP)
                return detail ? scheduleResource({...schedule, ...detail}) : null
            }))
            resources.push(...batch.filter((resource): resource is CloudResource => resource !== null))
        }
        return resources
    }

    async get(id: string): Promise<CloudResource | null> {
        const {groupName, name} = parseScheduleId(id)
        const schedule = await this.loadSchedule(name, groupName)
        return schedule ? scheduleResource(schedule, true) : null
    }

    private async loadSchedule(name: string, groupName: string): Promise<GetScheduleOutput | null> {
        try {
            return await this.scheduler.send(new GetScheduleCommand({Name: name, GroupName: groupName}))
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredValue(input.values.name, 'name')
        const scheduleExpression = requiredValue(input.values.scheduleExpression, 'scheduleExpression')
        const targetArn = requiredValue(input.values.targetArn, 'targetArn')
        const groupName = stringValue(input.values.groupName) || DEFAULT_GROUP
        const roleArn = requiredValue(input.values.roleArn, 'roleArn')
        const description = stringValue(input.values.description)
        const state = stringValue(input.values.state) || 'ENABLED'
        if (state !== 'ENABLED' && state !== 'DISABLED') throw new ValidationError('state must be ENABLED or DISABLED')
        if (input.values.flexibleTimeWindowMode !== undefined && input.values.flexibleTimeWindowMode !== 'OFF') {
            throw new ValidationError('flexibleTimeWindowMode must be OFF')
        }

        const scheduleExpressionTimezone = stringValue(input.values.scheduleExpressionTimezone)
        const response = await this.scheduler.send(new CreateScheduleCommand({
            Name: name,
            GroupName: groupName,
            ScheduleExpression: scheduleExpression,
            ScheduleExpressionTimezone: scheduleExpressionTimezone || undefined,
            State: state,
            Description: description || undefined,
            FlexibleTimeWindow: {Mode: 'OFF'},
            Target: {
                Arn: targetArn,
                RoleArn: roleArn,
            },
        }))

        return scheduleResource({
            Arn: response.ScheduleArn,
            Name: name,
            GroupName: groupName,
            ScheduleExpression: scheduleExpression,
            ScheduleExpressionTimezone: scheduleExpressionTimezone || undefined,
            State: state,
            Description: description || undefined,
            FlexibleTimeWindow: {Mode: 'OFF'},
            Target: {Arn: targetArn, RoleArn: roleArn},
        })
    }

    async delete(id: string): Promise<void> {
        const {groupName, name} = parseScheduleId(id)
        await this.scheduler.send(new DeleteScheduleCommand({Name: name, GroupName: groupName}))
    }

    async health(): Promise<void> {
        await this.scheduler.send(new ListSchedulesCommand({MaxResults: 1}))
    }
}

function scheduleResource(schedule: SchedulerRecord, includeDetails = false): CloudResource {
    const name = schedule.Name ?? ''
    const groupName = schedule.GroupName ?? DEFAULT_GROUP
    const roleArn = schedule.Target && 'RoleArn' in schedule.Target ? schedule.Target.RoleArn : undefined
    return {
        id: scheduleId(groupName, name),
        name,
        cloud: 'aws',
        service: 'scheduler',
        type: 'scheduler-job',
        region: regionFromArn(schedule.Arn),
        createdAt: schedule.CreationDate?.toISOString() ?? null,
        status: schedule.State ?? null,
        metadata: {
            provider: 'aws',
            schedulerService: 'eventbridge-scheduler',
            arn: schedule.Arn,
            groupName,
            schedule: schedule.ScheduleExpression,
            timeZone: schedule.ScheduleExpressionTimezone,
            target: schedule.Target?.Arn,
            scheduleExpression: schedule.ScheduleExpression,
            scheduleExpressionTimezone: schedule.ScheduleExpressionTimezone,
            targetArn: schedule.Target?.Arn,
            roleArn,
            flexibleTimeWindowMode: schedule.FlexibleTimeWindow?.Mode,
            ...(includeDetails ? {
                targetDetails: schedule.Target,
                flexibleTimeWindow: schedule.FlexibleTimeWindow,
            } : {}),
            description: schedule.Description,
            lastModificationDate: schedule.LastModificationDate?.toISOString(),
        },
    }
}

function scheduleId(groupName: string, name: string): string {
    return `${SCHEDULE_PREFIX}${groupName}/${name}`
}

function parseScheduleId(id: string): {groupName: string; name: string} {
    if (!id.startsWith(SCHEDULE_PREFIX)) throw new ValidationError(`Unknown EventBridge Scheduler id: ${id}`)
    const value = id.slice(SCHEDULE_PREFIX.length)
    const slash = value.indexOf('/')
    const groupName = slash >= 0 ? value.slice(0, slash) : DEFAULT_GROUP
    const name = slash >= 0 ? value.slice(slash + 1) : value
    if (!groupName || !name) throw new ValidationError(`Unknown EventBridge Scheduler id: ${id}`)
    return {groupName, name}
}

function requiredValue(value: unknown, field: string): string {
    const result = stringValue(value)
    if (!result) throw new ValidationError(`${field} is required`)
    return result
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return value.name === 'ResourceNotFoundException' || value.$metadata?.httpStatusCode === 404
}
