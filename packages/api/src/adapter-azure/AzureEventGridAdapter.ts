import {azure, azureLocationIn, type AzureRuntimeClient} from '../azure'
import {
    AZURE_EVENT_GRID_INPUT_SCHEMAS,
    AZURE_EVENT_GRID_LOCATIONS,
    AZURE_EVENT_GRID_TOPIC_NAME_MESSAGE,
    AZURE_EVENT_GRID_TOPIC_NAME_PATTERN,
    azureEventGridSchema,
} from '../cloud-spi/azureEventGridSchema'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT} from '../cloud-spi/childCollections'
import {ConflictError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.EventGrid custom topics,
 * verified against `floci-az` (docs/services/event-grid.md and EventGridService):
 *
 *   list     GET    /subscriptions/{s}/providers/Microsoft.EventGrid/topics
 *   get      GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.EventGrid/topics/{n}
 *   create   PUT    (same path as get), an upsert that answers 200 either way
 *   delete   DELETE (same path as get), answers 200 even for a missing topic
 *   children GET    {topic}/providers/Microsoft.EventGrid/eventSubscriptions
 *
 * The id is `resourceGroup/name`: ARM cannot address a topic without its group.
 *
 * Secrets: `listKeys` and `regenerateKey` are never called, so topic keys cannot reach list
 * or inspect. A webhook URL can carry a credential in its query string (a function key, a
 * SAS token), so event subscriptions show the URL without its query and without user info.
 */
const API_VERSION = '2025-02-15'
const RESOURCE_API_VERSION = '2021-04-01'
const MAX_LINKS = 50
const SUBSCRIPTIONS_COLLECTION = 'eventSubscriptions'

interface ArmList<T> {
    value?: T[]
    nextLink?: string
}

interface ArmTopic {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
        provisioningState?: string
        endpoint?: string
        inputSchema?: string
        publicNetworkAccess?: string
    }
}

interface ArmEventSubscription {
    id?: string
    name?: string
    properties?: {
        provisioningState?: string
        destination?: {endpointType?: string; properties?: {endpointUrl?: string}}
        filter?: {
            subjectBeginsWith?: string | null
            subjectEndsWith?: string | null
            includedEventTypes?: string[] | null
            isSubjectCaseSensitive?: boolean
        }
        retryPolicy?: {maxDeliveryAttempts?: number; eventTimeToLiveInMinutes?: number}
        eventDeliverySchema?: string
        deadLetterDestination?: {endpointType?: string}
    }
}

export class AzureEventGridAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'events' as const

    readonly documents: DocumentStoreAdapter

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {
        this.documents = new EventGridStore(
            (id) => this.requireTopic(id),
            (path) => this.collect<ArmEventSubscription>(path),
        )
    }

    schema(): ServiceSchema {
        return azureEventGridSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const topics = await this.collect<ArmTopic>(
            `/subscriptions/${subscription}/providers/Microsoft.EventGrid/topics?api-version=${API_VERSION}`,
        )
        const search = query.search?.trim().toLowerCase()
        const resources = topics.map(toResource)
        return search ? resources.filter((resource) => resource.name.toLowerCase().includes(search)) : resources
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.topicPath(resourceGroup, name)
        const topic = await this.json<ArmTopic>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        return topic ? toResource(topic) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(AZURE_EVENT_GRID_TOPIC_NAME_PATTERN).test(name)) {
            throw new ValidationError(`name is invalid. ${AZURE_EVENT_GRID_TOPIC_NAME_MESSAGE}`)
        }
        const location = optionalOption(input.values.location, 'location', AZURE_EVENT_GRID_LOCATIONS)
            ?? azureLocationIn(AZURE_EVENT_GRID_LOCATIONS)
        const inputSchema = optionalOption(input.values.inputSchema, 'inputSchema', AZURE_EVENT_GRID_INPUT_SCHEMAS)
            ?? 'EventGridSchema'
        const resourceGroup = await this.resolveResourceGroup(requiredString(input.values.resourceGroup, 'resourceGroup'))

        // The runtime upserts: a repeated PUT answers 200 and rewrites the location and schema.
        if (await this.get(`${resourceGroup}/${name}`)) {
            throw new ConflictError(`Event Grid topic ${name} already exists in resource group ${resourceGroup}`)
        }

        const path = await this.topicPath(resourceGroup, name)
        await this.json(`${path}?api-version=${API_VERSION}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({location, properties: {inputSchema}}),
        })

        const created = await this.get(`${resourceGroup}/${name}`)
        if (!created) throw new RuntimeError(`${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.topicPath(resourceGroup, name)
        await this.client.fetch(`${path}?api-version=${API_VERSION}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    /** The topic path for an id, or a not-found error so children never read an empty list for a missing parent. */
    private async requireTopic(id: string): Promise<string> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.topicPath(resourceGroup, name)
        const topic = await this.json<ArmTopic>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        if (!topic) throw new NotFoundError(`Event Grid topic not found: ${id}`)
        return path
    }

    private async topicPath(resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.EventGrid/topics/${encodeURIComponent(name)}`
    }

    /** The runtime ignores the subscription id, but a real one keeps the emitted ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope Event Grid requests to')

        this.subscriptionId = id
        return id
    }

    /**
     * The runtime accepts a resource group that does not exist, while real Azure
     * answers ResourceGroupNotFound, so the check lives here. The runtime's own
     * spelling is returned so the id matches the one `list()` reports.
     */
    private async resolveResourceGroup(resourceGroup: string): Promise<string> {
        const subscription = await this.subscription()
        const groups = await this.collect<{name?: string}>(
            `/subscriptions/${subscription}/resourceGroups?api-version=${RESOURCE_API_VERSION}`,
        )
        const match = groups.find((group) => group.name?.toLowerCase() === resourceGroup.toLowerCase())
        if (!match?.name) {
            throw new ValidationError(`resource group ${resourceGroup} does not exist; create it first`)
        }
        return match.name
    }

    /** Every item of an ARM list, following `nextLink` the way a real service pages. */
    private async collect<T>(path: string): Promise<T[]> {
        const items: T[] = []
        const seen = new Set<string>()
        let next: string | undefined = path

        for (let links = 0; next; links++) {
            if (links >= MAX_LINKS || seen.has(next)) throw new RuntimeError('Event Grid returned a repeating or endless nextLink')
            seen.add(next)

            const body: ArmList<T> | null = await this.json<ArmList<T>>(next)
            items.push(...(body?.value ?? []))
            next = body?.nextLink ? this.relative(body.nextLink) : undefined
        }
        return items
    }

    private relative(link: string): string {
        return link.startsWith(this.client.endpoint) ? link.slice(this.client.endpoint.length) : link
    }

    private async json<T>(path: string, init: RequestInit = {}, options: {emptyOnNotFound?: boolean} = {}): Promise<T | null> {
        const res = await this.client.fetch(path, {...init, headers: {accept: 'application/json', ...(init.headers ?? {})}}, options)
        if (!res || res.status === 204) return null

        const text = await res.text()
        return text ? (JSON.parse(text) as T) : null
    }
}

/**
 * A topic holds one fixed collection, its event subscriptions, so the store has no
 * create or delete. The runtime ignores `$top`, so paging is applied over the full list.
 */
class EventGridStore implements DocumentStoreAdapter {
    constructor(
        private readonly requireTopic: (id: string) => Promise<string>,
        private readonly collect: (path: string) => Promise<ArmEventSubscription[]>,
    ) {}

    async listCollections(topicId: string): Promise<CollectionPage<ChildCollection>> {
        await this.requireTopic(topicId)
        return {
            items: [{id: SUBSCRIPTIONS_COLLECTION, name: 'Event subscriptions', parentId: topicId, createdAt: null, metadata: {}}],
            nextCursor: null,
        }
    }

    async listItems(topicId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        if (collectionId !== SUBSCRIPTIONS_COLLECTION) {
            throw new NotFoundError(`Unknown Event Grid collection ${collectionId}; use ${SUBSCRIPTIONS_COLLECTION}`)
        }
        const topicPath = await this.requireTopic(topicId)
        const subscriptions = await this.collect(
            `${topicPath}/providers/Microsoft.EventGrid/eventSubscriptions?api-version=${API_VERSION}`,
        )

        const offset = decodeOffset(page.cursor)
        const limit = Math.min(page.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
        const slice = subscriptions.slice(offset, offset + limit)
        const end = offset + slice.length
        return {items: slice.map(toSubscriptionItem), nextCursor: end < subscriptions.length ? String(end) : null}
    }
}

function decodeOffset(cursor: string | undefined): number {
    if (cursor === undefined || cursor === '') return 0
    if (!/^\d+$/.test(cursor)) throw new ValidationError('cursor is not valid for this collection')
    return Number(cursor)
}

/** Named fields only, so nothing the runtime adds later reaches the console. */
function toSubscriptionItem(subscription: ArmEventSubscription): ChildItem {
    const p = subscription.properties ?? {}
    const filter = p.filter ?? {}
    return {
        id: subscription.name ?? '',
        collectionId: SUBSCRIPTIONS_COLLECTION,
        timestamp: null,
        body: {
            name: subscription.name,
            provisioningState: p.provisioningState,
            endpointType: p.destination?.endpointType,
            endpointUrl: redactUrl(p.destination?.properties?.endpointUrl),
            subjectBeginsWith: filter.subjectBeginsWith ?? null,
            subjectEndsWith: filter.subjectEndsWith ?? null,
            includedEventTypes: filter.includedEventTypes ?? [],
            isSubjectCaseSensitive: filter.isSubjectCaseSensitive ?? false,
            eventDeliverySchema: p.eventDeliverySchema,
            maxDeliveryAttempts: p.retryPolicy?.maxDeliveryAttempts,
            eventTimeToLiveInMinutes: p.retryPolicy?.eventTimeToLiveInMinutes,
            deadLetterEndpointType: p.deadLetterDestination?.endpointType ?? null,
        },
        metadata: {resourceId: subscription.id},
    }
}

/** Drops user info and the query string, where function keys and SAS tokens live. */
function redactUrl(value: string | undefined): string | undefined {
    if (!value) return value
    try {
        const url = new URL(value)
        return `${url.protocol}//${url.host}${url.pathname}${url.search ? '?...' : ''}`
    } catch {
        return undefined
    }
}

function toResource(topic: ArmTopic): CloudResource {
    const p = topic.properties ?? {}
    const name = topic.name ?? ''
    const resourceGroup = resourceGroupOf(topic.id ?? '')

    return {
        id: resourceGroup ? `${resourceGroup}/${name}` : name,
        name,
        cloud: 'azure',
        service: 'events',
        type: 'event-grid-topic',
        region: topic.location ?? null,
        // ARM returns no creation time here, and inventing one would be fake data.
        createdAt: null,
        status: typeof p.provisioningState === 'string' ? p.provisioningState : null,
        metadata: {
            provider: 'azure',
            resourceId: topic.id,
            resourceGroup,
            endpoint: p.endpoint,
            inputSchema: p.inputSchema,
            publicNetworkAccess: p.publicNetworkAccess,
            tags: topic.tags,
        },
    }
}

function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`Event Grid topic id must be "resourceGroup/name", got "${id}"`)
    }
    return {resourceGroup, name}
}

function resourceGroupOf(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i)
    return match ? match[1] : ''
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
    return value.trim()
}

function optionalOption<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const text = requiredString(value, field)
    if (!(allowed as readonly string[]).includes(text)) {
        throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
    }
    return text as T
}
