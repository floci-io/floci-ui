import {azure, type AzureRuntimeClient} from '../azure'
import {azureApiManagementSchema} from '../cloud-spi/azureApiManagementSchema'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT} from '../cloud-spi/childCollections'
import {NotFoundError, NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.ApiManagement,
 * verified against the published `floci/floci-az` image:
 *
 *   list     GET /subscriptions/{s}/providers/Microsoft.ApiManagement/service
 *   get      GET /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{n}
 *   children GET {service}/apis | products | backends | namedValues | subscriptions
 *   ops      GET {service}/apis/{api}/operations
 *
 * Read only. Two bodies carry secrets and are mapped by named fields so they
 * never reach list or inspect: a subscription embeds `primaryKey` and
 * `secondaryKey`, and a secret named value has its `value` withheld. The
 * `listSecrets` actions are never called.
 *
 * The runtime answers children of a service that does not exist with an empty
 * list, so the service is read first. It also ignores `$top` and `$skip`, so
 * paging is applied here over the full list.
 *
 * The id is `resourceGroup/name`: ARM cannot address a service without its group.
 */
const API_VERSION = '2022-08-01'
const MAX_LINKS = 50

export const API_MANAGEMENT_COLLECTIONS = [
    {id: 'apis', name: 'APIs'},
    {id: 'products', name: 'Products'},
    {id: 'backends', name: 'Backends'},
    {id: 'namedValues', name: 'Named values'},
    {id: 'subscriptions', name: 'Subscriptions'},
] as const
type CollectionId = (typeof API_MANAGEMENT_COLLECTIONS)[number]['id']

interface ArmList<T> {
    value?: T[]
    nextLink?: string
}

interface ArmEntity {
    id?: string
    name?: string
    type?: string
    properties?: Record<string, unknown>
}

interface ArmService extends ArmEntity {
    location?: string
    tags?: Record<string, string>
    sku?: {name?: string; capacity?: number}
}

export class AzureApiManagementAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'apigateway' as const

    readonly documents: DocumentStoreAdapter

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {
        this.documents = new ApiManagementStore(
            (id) => this.requireService(id),
            (path) => this.collect<ArmEntity>(path),
        )
    }

    schema(): ServiceSchema {
        return azureApiManagementSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const services = await this.collect<ArmService>(
            `/subscriptions/${subscription}/providers/Microsoft.ApiManagement/service?api-version=${API_VERSION}`,
        )
        const search = query.search?.trim().toLowerCase()
        const resources = services.map(toResource)
        return search ? resources.filter((resource) => resource.name.toLowerCase().includes(search)) : resources
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.servicePath(resourceGroup, name)
        const service = await this.json<ArmService>(`${path}?api-version=${API_VERSION}`, {emptyOnNotFound: true})
        return service ? toResource(service) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('API Management service creation is not supported from the Cloud Explorer.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('API Management service deletion is not supported from the Cloud Explorer.')
    }

    /** The service path for an id, or a not-found error so children never read an empty list for a missing parent. */
    private async requireService(id: string): Promise<string> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.servicePath(resourceGroup, name)
        const service = await this.json<ArmService>(`${path}?api-version=${API_VERSION}`, {emptyOnNotFound: true})
        if (!service) throw new NotFoundError(`API Management service not found: ${id}`)
        return path
    }

    private async servicePath(resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ApiManagement/service/${encodeURIComponent(name)}`
    }

    /** The runtime ignores the subscription id, but a real one keeps the emitted ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope API Management requests to')

        this.subscriptionId = id
        return id
    }

    /** Every item of an ARM list, following `nextLink` the way a real service pages. */
    private async collect<T>(path: string): Promise<T[]> {
        const items: T[] = []
        const seen = new Set<string>()
        let next: string | undefined = path

        for (let links = 0; next; links++) {
            if (links >= MAX_LINKS || seen.has(next)) throw new RuntimeError('API Management returned a repeating or endless nextLink')
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

    private async json<T>(path: string, options: {emptyOnNotFound?: boolean} = {}): Promise<T | null> {
        const res = await this.client.fetch(path, {headers: {accept: 'application/json'}}, options)
        if (!res || res.status === 204) return null

        const text = await res.text()
        return text ? (JSON.parse(text) as T) : null
    }
}

/**
 * A service holds five fixed collections, so the store has no create or delete.
 * Operations are summarised on each API, since an API has no item route of its own.
 */
class ApiManagementStore implements DocumentStoreAdapter {
    constructor(
        private readonly requireService: (id: string) => Promise<string>,
        private readonly collect: (path: string) => Promise<ArmEntity[]>,
    ) {}

    async listCollections(serviceId: string): Promise<CollectionPage<ChildCollection>> {
        await this.requireService(serviceId)
        return {
            items: API_MANAGEMENT_COLLECTIONS.map(({id, name}) => ({
                id,
                name,
                parentId: serviceId,
                createdAt: null,
                metadata: {},
            })),
            nextCursor: null,
        }
    }

    async listItems(serviceId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const kind = assertCollection(collectionId)
        const servicePath = await this.requireService(serviceId)
        const entities = await this.collect(`${servicePath}/${kind}?api-version=${API_VERSION}`)

        const offset = decodeOffset(page.cursor)
        const limit = Math.min(page.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
        const slice = entities.slice(offset, offset + limit)

        const items = await Promise.all(slice.map((entity) => this.toItem(kind, servicePath, entity)))
        const end = offset + slice.length
        return {items, nextCursor: end < entities.length ? String(end) : null}
    }

    private async toItem(kind: CollectionId, servicePath: string, entity: ArmEntity): Promise<ChildItem> {
        const name = entity.name ?? ''
        const body = bodyFor(kind, entity)
        if (kind === 'apis') {
            const operations = await this.collect(
                `${servicePath}/apis/${encodeURIComponent(name)}/operations?api-version=${API_VERSION}`,
            )
            body.operations = operations.map(toOperation)
        }
        return {id: name, collectionId: kind, timestamp: null, body, metadata: {resourceId: entity.id}}
    }
}

function assertCollection(collectionId: string): CollectionId {
    const match = API_MANAGEMENT_COLLECTIONS.find(({id}) => id === collectionId)
    if (!match) {
        throw new NotFoundError(
            `Unknown API Management collection ${collectionId}; use ${API_MANAGEMENT_COLLECTIONS.map(({id}) => id).join(', ')}`,
        )
    }
    return match.id
}

function decodeOffset(cursor: string | undefined): number {
    if (cursor === undefined || cursor === '') return 0
    if (!/^\d+$/.test(cursor)) throw new ValidationError('cursor is not valid for this collection')
    return Number(cursor)
}

/** Named fields only: a subscription's keys and a secret named value never leave the adapter. */
function bodyFor(kind: CollectionId, entity: ArmEntity): Record<string, unknown> {
    const p = entity.properties ?? {}
    switch (kind) {
        case 'apis':
            return {
                name: entity.name,
                displayName: p.displayName,
                path: p.path,
                protocols: p.protocols,
                serviceUrl: p.serviceUrl,
                apiVersion: p.apiVersion,
                subscriptionRequired: p.subscriptionRequired,
            }
        case 'products':
            return {
                name: entity.name,
                displayName: p.displayName,
                state: p.state,
                subscriptionRequired: p.subscriptionRequired,
                approvalRequired: p.approvalRequired,
            }
        case 'backends':
            return {name: entity.name, title: p.title, url: p.url, protocol: p.protocol, description: p.description}
        case 'namedValues': {
            const secret = p.secret === true
            return {name: entity.name, displayName: p.displayName, secret, ...(secret ? {} : {value: p.value})}
        }
        case 'subscriptions':
            return {name: entity.name, displayName: p.displayName, scope: p.scope, state: p.state}
    }
}

function toOperation(entity: ArmEntity): Record<string, unknown> {
    const p = entity.properties ?? {}
    return {name: entity.name, displayName: p.displayName, method: p.method, urlTemplate: p.urlTemplate}
}

function toResource(service: ArmService): CloudResource {
    const p = service.properties ?? {}
    const name = service.name ?? ''
    const resourceGroup = resourceGroupOf(service.id ?? '')

    return {
        id: resourceGroup ? `${resourceGroup}/${name}` : name,
        name,
        cloud: 'azure',
        service: 'apigateway',
        type: 'api-management',
        region: service.location ?? null,
        createdAt: null,
        status: typeof p.provisioningState === 'string' ? p.provisioningState : null,
        metadata: {
            provider: 'azure',
            resourceId: service.id,
            resourceGroup,
            sku: service.sku?.name,
            skuCapacity: service.sku?.capacity,
            gatewayUrl: p.gatewayUrl,
            managementApiUrl: p.managementApiUrl,
            publisherName: p.publisherName,
            publisherEmail: p.publisherEmail,
            tags: service.tags,
        },
    }
}

function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`API Management service id must be "resourceGroup/name", got "${id}"`)
    }
    return {resourceGroup, name}
}

function resourceGroupOf(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i)
    return match ? match[1] : ''
}
