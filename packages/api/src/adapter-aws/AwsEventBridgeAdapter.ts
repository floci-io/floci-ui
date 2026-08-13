import {
    CreateEventBusCommand,
    DeleteEventBusCommand,
    DescribeEventBusCommand,
    ListEventBusesCommand,
    type EventBridgeClient,
    type EventBus,
} from '@aws-sdk/client-eventbridge'
import {
    CreateScheduleCommand,
    DeleteScheduleCommand,
    GetScheduleCommand,
    ListSchedulesCommand,
    type GetScheduleOutput,
    type ScheduleSummary,
    type SchedulerClient,
} from '@aws-sdk/client-scheduler'
import {
    awsEventbridgeSchema,
    RESOURCE_TYPE_MESSAGE,
    SCHEDULE_NAME_LENGTH_MESSAGE,
    SCHEDULE_NAME_MAX_LENGTH,
} from '../cloud-spi/eventbridgeSchema'
import {NotImplementedByRuntimeError, ValidationError} from '../cloud-spi/errors'
import {mapAwsSdkError} from './awsErrors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CloudServiceDescriptorOverride,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const EVENT_BUS_PREFIX = 'event-bus:'
const SCHEDULE_PREFIX = 'schedule:'
const DEFAULT_SCHEDULE_GROUP = 'default'

export class AwsEventBridgeAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'messaging' as const

    constructor(
        private readonly eventbridge: EventBridgeClient,
        private readonly scheduler: SchedulerClient,
    ) {}

    schema(): ServiceSchema {
        return awsEventbridgeSchema()
    }

    // The catalog category is the cloud-neutral 'Messaging'; on AWS it is EventBridge.
    descriptorOverride(): CloudServiceDescriptorOverride {
        return {displayName: 'EventBridge'}
    }

    // Event buses and schedules come from two independent services. A runtime that has
    // not implemented one of them should not blank out the other, but any other failure
    // still has to reach the caller rather than showing up as a short list.
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const [eventBuses, schedules] = await Promise.allSettled([
            this.listEventBuses(),
            this.listSchedules(),
        ])

        const resources = [
            ...settledValue(eventBuses, []).map(eventBusResource),
            ...settledValue(schedules, []).map(scheduleResource),
        ]
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const resource = parseResourceId(id)
        try {
            if (resource.type === 'event-bus') {
                const eventBus = await this.eventbridge.send(new DescribeEventBusCommand({Name: resource.name}))
                return eventBusResource(eventBus)
            }

            const schedule = await this.scheduler.send(new GetScheduleCommand({
                Name: resource.name,
                GroupName: resource.groupName,
            }))
            return detailedScheduleResource(schedule)
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = stringValue(input.values.resourceType)
        const name = requiredValue(input.values.name, 'name')
        const description = stringValue(input.values.description) || undefined

        if (resourceType === 'event-bus') {
            const response = await this.eventbridge.send(new CreateEventBusCommand({Name: name, Description: description}))
            return {
                id: eventBusId(name),
                name,
                cloud: 'aws',
                service: 'messaging',
                type: 'event-bus',
                region: regionFromArn(response.EventBusArn),
                createdAt: null,
                status: null,
                metadata: {
                    provider: 'aws',
                    messagingService: 'eventbridge',
                    arn: response.EventBusArn,
                    description,
                },
            }
        }

        if (resourceType !== 'schedule') throw new ValidationError(RESOURCE_TYPE_MESSAGE)
        if (name.length > SCHEDULE_NAME_MAX_LENGTH) throw new ValidationError(SCHEDULE_NAME_LENGTH_MESSAGE)

        const scheduleExpression = requiredValue(input.values.scheduleExpression, 'scheduleExpression')
        const targetArn = requiredValue(input.values.targetArn, 'targetArn')
        const roleArn = requiredValue(input.values.roleArn, 'roleArn')
        const groupName = stringValue(input.values.groupName) || DEFAULT_SCHEDULE_GROUP
        const state = scheduleState(input.values.state)
        const scheduleExpressionTimezone = stringValue(input.values.scheduleExpressionTimezone) || undefined
        const targetInput = stringValue(input.values.targetInput) || undefined
        const response = await this.scheduler.send(new CreateScheduleCommand({
            Name: name,
            GroupName: groupName,
            Description: description,
            ScheduleExpression: scheduleExpression,
            ScheduleExpressionTimezone: scheduleExpressionTimezone,
            State: state,
            FlexibleTimeWindow: {Mode: 'OFF'},
            Target: {Arn: targetArn, RoleArn: roleArn, Input: targetInput},
        }))

        return {
            id: scheduleId(groupName, name),
            name,
            cloud: 'aws',
            service: 'messaging',
            type: 'schedule',
            region: regionFromArn(response.ScheduleArn),
            createdAt: null,
            status: state,
            metadata: {
                provider: 'aws',
                messagingService: 'scheduler',
                arn: response.ScheduleArn,
                groupName,
                description,
                scheduleExpression,
                scheduleExpressionTimezone: scheduleExpressionTimezone ?? 'UTC',
                targetArn,
                roleArn,
                targetInput,
            },
        }
    }

    async delete(id: string): Promise<void> {
        const resource = parseResourceId(id)
        if (resource.type === 'event-bus') {
            await this.eventbridge.send(new DeleteEventBusCommand({Name: resource.name}))
            return
        }
        await this.scheduler.send(new DeleteScheduleCommand({
            Name: resource.name,
            GroupName: resource.groupName,
        }))
    }

    private async listEventBuses(): Promise<EventBus[]> {
        const eventBuses: EventBus[] = []
        let nextToken: string | undefined
        do {
            const response = await this.eventbridge.send(new ListEventBusesCommand({NextToken: nextToken}))
            eventBuses.push(...(response.EventBuses ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return eventBuses
    }

    private async listSchedules(): Promise<ScheduleSummary[]> {
        const schedules: ScheduleSummary[] = []
        let nextToken: string | undefined
        do {
            const response = await this.scheduler.send(new ListSchedulesCommand({NextToken: nextToken}))
            schedules.push(...(response.Schedules ?? []))
            nextToken = response.NextToken
        } while (nextToken)
        return schedules
    }
}

function eventBusResource(eventBus: EventBus): CloudResource {
    const name = eventBus.Name ?? ''
    return {
        id: eventBusId(name),
        name,
        cloud: 'aws',
        service: 'messaging',
        type: 'event-bus',
        region: regionFromArn(eventBus.Arn),
        createdAt: eventBus.CreationTime?.toISOString() ?? null,
        status: null,
        metadata: {
            provider: 'aws',
            messagingService: 'eventbridge',
            arn: eventBus.Arn,
            description: eventBus.Description,
            policy: eventBus.Policy,
            lastModifiedAt: eventBus.LastModifiedTime?.toISOString(),
        },
    }
}

function scheduleResource(schedule: ScheduleSummary): CloudResource {
    const name = schedule.Name ?? ''
    const groupName = schedule.GroupName ?? DEFAULT_SCHEDULE_GROUP
    return {
        id: scheduleId(groupName, name),
        name,
        cloud: 'aws',
        service: 'messaging',
        type: 'schedule',
        region: regionFromArn(schedule.Arn),
        createdAt: schedule.CreationDate?.toISOString() ?? null,
        status: schedule.State ?? null,
        metadata: {
            provider: 'aws',
            messagingService: 'scheduler',
            arn: schedule.Arn,
            groupName,
            targetArn: schedule.Target?.Arn,
            lastModifiedAt: schedule.LastModificationDate?.toISOString(),
        },
    }
}

function detailedScheduleResource(schedule: GetScheduleOutput): CloudResource {
    const resource = scheduleResource(schedule)
    return {
        ...resource,
        metadata: {
            ...resource.metadata,
            description: schedule.Description,
            scheduleExpression: schedule.ScheduleExpression,
            scheduleExpressionTimezone: schedule.ScheduleExpressionTimezone,
            startDate: schedule.StartDate?.toISOString(),
            endDate: schedule.EndDate?.toISOString(),
            target: schedule.Target,
            flexibleTimeWindow: schedule.FlexibleTimeWindow,
            actionAfterCompletion: schedule.ActionAfterCompletion,
        },
    }
}

function eventBusId(name: string): string {
    return `${EVENT_BUS_PREFIX}${name}`
}

function scheduleId(groupName: string, name: string): string {
    return `${SCHEDULE_PREFIX}${groupName}/${name}`
}

function parseResourceId(id: string):
    | {type: 'event-bus'; name: string}
    | {type: 'schedule'; groupName: string; name: string} {
    if (id.startsWith(EVENT_BUS_PREFIX)) {
        const name = id.slice(EVENT_BUS_PREFIX.length)
        if (name) return {type: 'event-bus', name}
    }
    if (id.startsWith(SCHEDULE_PREFIX)) {
        const value = id.slice(SCHEDULE_PREFIX.length)
        const separator = value.indexOf('/')
        if (separator > 0 && separator < value.length - 1) {
            return {type: 'schedule', groupName: value.slice(0, separator), name: value.slice(separator + 1)}
        }
    }
    throw new ValidationError(`Unknown EventBridge resource id: ${id}`)
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function requiredValue(value: unknown, name: string): string {
    const result = stringValue(value)
    if (!result) throw new ValidationError(`${name} is required`)
    return result
}

function scheduleState(value: unknown): 'ENABLED' | 'DISABLED' {
    return stringValue(value) === 'DISABLED' ? 'DISABLED' : 'ENABLED'
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized)
        || resource.type.toLowerCase().includes(normalized),
    )
}

function regionFromArn(arn?: string): string | null {
    if (!arn) return null
    return arn.split(':')[3] || null
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
    if (result.status === 'fulfilled') return result.value
    // Classified with the shared AWS mapper so "the runtime has no Scheduler" is told
    // apart from a real failure using the same rules the route layer applies.
    if (mapAwsSdkError(result.reason) instanceof NotImplementedByRuntimeError) return fallback
    throw result.reason
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return value.name === 'ResourceNotFoundException' || value.$metadata?.httpStatusCode === 404
}
