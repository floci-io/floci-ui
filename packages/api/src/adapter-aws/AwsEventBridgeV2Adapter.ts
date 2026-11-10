import {
    CreateEventBusCommand,
    CreateSubscriberCommand,
    DeleteEventBusCommand,
    DeleteSubscriberCommand,
    DescribeEventBusCommand,
    DescribeSubscriberCommand,
    ListEventBusesCommand,
    ListSubscribersCommand,
    type DescribeEventBusResponse,
    type DescribeSubscriberResponse,
    type EventBridgeV2Client,
    type EventBusSummary,
    type FilterConfiguration,
    type SubscriberSummary,
} from '@aws-sdk/client-eventbridgev2'
import {
    awsEventBridgeV2Schema,
    EVENTBRIDGE_V2_KINDS,
    EVENTBRIDGE_V2_NAME_MAX_LENGTH,
    EVENTBRIDGE_V2_NAME_PATTERN,
    type EventBridgeV2Kind,
} from '../cloud-spi/eventbridgeV2Schema'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const ID_PREFIX: Record<EventBridgeV2Kind, string> = {buses: 'bus:', subscribers: 'subscriber:'}
const RESOURCE_TYPE: Record<EventBridgeV2Kind, string> = {buses: 'event-bus-v2', subscribers: 'subscriber'}

type EventBus = EventBusSummary | DescribeEventBusResponse
type Subscriber = SubscriberSummary | DescribeSubscriberResponse

/**
 * AWS EventBridge V2 event buses and their subscribers. Ids are
 * `bus:{arn}` and `subscriber:{arn}`: V2 addresses both by ARN, and the ARN
 * carries a generated suffix a name alone cannot reproduce.
 */
export class AwsEventBridgeV2Adapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'eventsv2' as const

    constructor(private readonly eventbridge: EventBridgeV2Client) {}

    schema(): ServiceSchema {
        return awsEventBridgeV2Schema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const resources: CloudResource[] = []
        if (!kind || kind === 'buses') resources.push(...(await this.listEventBuses()).map(eventBusResource))
        if (!kind || kind === 'subscribers') resources.push(...(await this.listSubscribers()).map(subscriberResource))
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {kind, arn} = parseId(id)
        try {
            if (kind === 'buses') {
                return eventBusResource(await this.eventbridge.send(new DescribeEventBusCommand({EventBusArn: arn})))
            }
            return subscriberResource(await this.eventbridge.send(new DescribeSubscriberCommand({SubscriberArn: arn})))
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const kind = requiredKind(input.values.kind)
        const name = requiredName(input.values.name)
        const description = stringValue(input.values.description) || undefined

        if (kind === 'buses') {
            const response = await this.eventbridge.send(new CreateEventBusCommand({Name: name, Description: description}))
            if (!response.EventBusArn) throw new RuntimeError('CreateEventBus did not return an EventBusArn')
            return eventBusResource({...response, Name: response.Name ?? name})
        }

        const targetArn = requiredValue(input.values.targetArn, 'targetArn')
        const roleArn = requiredValue(input.values.roleArn, 'roleArn')
        const filterConfiguration = filterConfigurationFrom(input.values.filterPattern)
        const eventBusArn = await this.resolveEventBusArn(requiredValue(input.values.eventBus, 'eventBus'))
        const response = await this.eventbridge.send(new CreateSubscriberCommand({
            Name: name,
            EventBusArn: eventBusArn,
            Description: description,
            InvokeConfiguration: {TargetArn: targetArn, RoleArn: roleArn},
            FilterConfiguration: filterConfiguration,
        }))
        if (!response.SubscriberArn) throw new RuntimeError('CreateSubscriber did not return a SubscriberArn')
        return subscriberResource({
            ...response,
            Name: response.Name ?? name,
            EventBusArn: response.EventBusArn ?? eventBusArn,
            InvokeConfiguration: {TargetArn: targetArn, RoleArn: roleArn},
            FilterConfiguration: filterConfiguration,
        })
    }

    async delete(id: string): Promise<void> {
        const {kind, arn} = parseId(id)
        if (kind === 'buses') {
            await this.eventbridge.send(new DeleteEventBusCommand({EventBusArn: arn}))
        } else {
            await this.eventbridge.send(new DeleteSubscriberCommand({SubscriberArn: arn}))
        }
    }

    async health(): Promise<void> {
        await this.eventbridge.send(new ListEventBusesCommand({MaxResults: 1}))
    }

    private async listEventBuses(namePrefix?: string): Promise<EventBusSummary[]> {
        const eventBuses: EventBusSummary[] = []
        const seenTokens = new Set<string>()
        let nextToken: string | undefined
        do {
            const response = await this.eventbridge.send(new ListEventBusesCommand({NamePrefix: namePrefix, NextToken: nextToken}))
            eventBuses.push(...(response.EventBuses ?? []))
            nextToken = nextPageToken(response.NextToken, seenTokens, 'ListEventBuses')
        } while (nextToken)
        return eventBuses
    }

    private async listSubscribers(): Promise<SubscriberSummary[]> {
        const subscribers: SubscriberSummary[] = []
        const seenTokens = new Set<string>()
        let nextToken: string | undefined
        do {
            const response = await this.eventbridge.send(new ListSubscribersCommand({NextToken: nextToken}))
            subscribers.push(...(response.Subscribers ?? []))
            nextToken = nextPageToken(response.NextToken, seenTokens, 'ListSubscribers')
        } while (nextToken)
        return subscribers
    }

    /** The form takes a bus name for convenience; the API only takes its ARN. */
    private async resolveEventBusArn(nameOrArn: string): Promise<string> {
        if (nameOrArn.startsWith('arn:')) return nameOrArn
        const match = (await this.listEventBuses(nameOrArn)).find((eventBus) => eventBus.Name === nameOrArn)
        if (!match?.EventBusArn) throw new NotFoundError(`EventBridge V2 event bus not found: ${nameOrArn}`)
        return match.EventBusArn
    }
}

function eventBusResource(eventBus: EventBus): CloudResource {
    return {
        id: `${ID_PREFIX.buses}${eventBus.EventBusArn ?? ''}`,
        name: eventBus.Name ?? '',
        cloud: 'aws',
        service: 'eventsv2',
        type: RESOURCE_TYPE.buses,
        region: regionFromArn(eventBus.EventBusArn),
        createdAt: eventBus.CreationTime?.toISOString() ?? null,
        status: eventBus.State ?? null,
        metadata: {
            provider: 'aws',
            arn: eventBus.EventBusArn,
            description: eventBus.Description,
            stateReason: eventBus.StateReason,
            lastModifiedAt: eventBus.LastModifiedTime?.toISOString() ?? null,
            ...('StorageConfiguration' in eventBus ? {storageConfiguration: eventBus.StorageConfiguration} : {}),
            ...('EncryptionConfiguration' in eventBus ? {encryptionConfiguration: eventBus.EncryptionConfiguration} : {}),
        },
    }
}

function subscriberResource(subscriber: Subscriber): CloudResource {
    const detail = 'InvokeConfiguration' in subscriber ? subscriber : null
    const targetArn = detail?.InvokeConfiguration?.TargetArn ?? ('TargetArn' in subscriber ? subscriber.TargetArn : undefined)
    return {
        id: `${ID_PREFIX.subscribers}${subscriber.SubscriberArn ?? ''}`,
        name: subscriber.Name ?? '',
        cloud: 'aws',
        service: 'eventsv2',
        type: RESOURCE_TYPE.subscribers,
        region: regionFromArn(subscriber.SubscriberArn),
        createdAt: subscriber.CreationTime?.toISOString() ?? null,
        status: subscriber.State ?? null,
        metadata: {
            provider: 'aws',
            arn: subscriber.SubscriberArn,
            eventBusArn: subscriber.EventBusArn,
            eventBusName: eventBusNameFromArn(subscriber.EventBusArn),
            targetArn,
            orderingType: subscriber.Type,
            lastModifiedAt: subscriber.LastModifiedTime?.toISOString() ?? null,
            ...(detail ? {
                description: detail.Description,
                roleArn: detail.InvokeConfiguration?.RoleArn,
                filterConfiguration: detail.FilterConfiguration,
                transformer: detail.Transformer,
                retryPolicy: detail.RetryPolicy,
            } : {}),
        },
    }
}

function nextPageToken(token: string | undefined, seenTokens: Set<string>, operation: string): string | undefined {
    if (!token) return undefined
    if (seenTokens.has(token)) throw new RuntimeError(`EventBridge V2 ${operation} repeated a continuation token`)
    seenTokens.add(token)
    return token
}

function filterConfigurationFrom(value: unknown): FilterConfiguration | undefined {
    const pattern = stringValue(value)
    if (!pattern) return undefined
    try {
        JSON.parse(pattern)
    } catch {
        throw new ValidationError('filterPattern must be a JSON event pattern')
    }
    return {Filters: [{Scope: 'DATA', Pattern: pattern}]}
}

function parseId(id: string): {kind: EventBridgeV2Kind; arn: string} {
    for (const kind of EVENTBRIDGE_V2_KINDS) {
        const prefix = ID_PREFIX[kind]
        if (id.startsWith(prefix) && id.length > prefix.length) return {kind, arn: id.slice(prefix.length)}
    }
    throw new ValidationError(`Unknown EventBridge V2 resource id: ${id}`)
}

function optionalKind(value: unknown): EventBridgeV2Kind | null {
    const kind = stringValue(value)
    if (!kind) return null
    return requiredKind(kind)
}

function requiredKind(value: unknown): EventBridgeV2Kind {
    const kind = stringValue(value)
    if ((EVENTBRIDGE_V2_KINDS as readonly string[]).includes(kind)) return kind as EventBridgeV2Kind
    throw new ValidationError(`kind must be one of ${EVENTBRIDGE_V2_KINDS.join(', ')}`)
}

function requiredName(value: unknown): string {
    const name = requiredValue(value, 'name')
    if (name.length > EVENTBRIDGE_V2_NAME_MAX_LENGTH || !new RegExp(EVENTBRIDGE_V2_NAME_PATTERN).test(name)) {
        throw new ValidationError('name must start with a letter or number and use only letters, numbers, periods, hyphens, or underscores')
    }
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

/** `arn:aws:events:{region}:{account}:event-busv2/{name}/{id}` */
function eventBusNameFromArn(arn?: string): string | null {
    return arn?.split(':')[5]?.split('/')[1] || null
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return value.name === 'ResourceNotFoundException' || value.$metadata?.httpStatusCode === 404
}
