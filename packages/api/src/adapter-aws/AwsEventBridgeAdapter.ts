import {
    CreateEventBusCommand,
    DeleteEventBusCommand,
    DescribeEventBusCommand,
    ListEventBusesCommand,
    type EventBridgeClient,
    type EventBus,
} from '@aws-sdk/client-eventbridge'
import {awsEventBridgeSchema} from '../cloud-spi/eventbridgeSchema'
import {ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CloudServiceDescriptorOverride,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const EVENT_BUS_PREFIX = 'event-bus:'

/** AWS EventBridge event buses through the provider-neutral Events category. */
export class AwsEventBridgeAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'events' as const

    constructor(private readonly eventbridge: EventBridgeClient) {}

    schema(): ServiceSchema {
        return awsEventBridgeSchema()
    }

    descriptorOverride(): CloudServiceDescriptorOverride {
        return {displayName: 'EventBridge'}
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const eventBuses: EventBus[] = []
        let nextToken: string | undefined
        do {
            const response = await this.eventbridge.send(new ListEventBusesCommand({NextToken: nextToken}))
            eventBuses.push(...(response.EventBuses ?? []))
            nextToken = response.NextToken
        } while (nextToken)

        return filterBySearch(eventBuses.map(eventBusResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const name = eventBusName(id)
        try {
            return eventBusResource(await this.eventbridge.send(new DescribeEventBusCommand({Name: name})))
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredValue(input.values.name, 'name')
        const description = stringValue(input.values.description) || undefined
        const response = await this.eventbridge.send(new CreateEventBusCommand({Name: name, Description: description}))

        return eventBusResource({Name: name, Arn: response.EventBusArn, Description: description})
    }

    async delete(id: string): Promise<void> {
        await this.eventbridge.send(new DeleteEventBusCommand({Name: eventBusName(id)}))
    }
}

function eventBusResource(eventBus: EventBus): CloudResource {
    const name = eventBus.Name ?? ''
    return {
        id: `${EVENT_BUS_PREFIX}${name}`,
        name,
        cloud: 'aws',
        service: 'events',
        type: 'event-bus',
        region: regionFromArn(eventBus.Arn),
        createdAt: eventBus.CreationTime?.toISOString() ?? null,
        status: null,
        metadata: {
            provider: 'aws',
            eventsService: 'eventbridge',
            arn: eventBus.Arn,
            description: eventBus.Description,
            policy: eventBus.Policy,
            lastModifiedAt: eventBus.LastModifiedTime?.toISOString() ?? null,
        },
    }
}

function eventBusName(id: string): string {
    const name = id.startsWith(EVENT_BUS_PREFIX) ? id.slice(EVENT_BUS_PREFIX.length) : ''
    if (!name) throw new ValidationError(`Unknown EventBridge event bus id: ${id}`)
    return name
}

function requiredValue(value: unknown, field: string): string {
    const result = stringValue(value)
    if (!result) throw new ValidationError(`${field} is required`)
    return result
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return value.name === 'ResourceNotFoundException' || value.$metadata?.httpStatusCode === 404
}
