import {azure, type AzureRuntimeClient} from '../azure'
import {
    azureCacheSchema,
    REDIS_CACHE_NAME_MESSAGE,
    REDIS_CACHE_NAME_PATTERN,
    REDIS_LOCATIONS,
    REDIS_SKUS,
} from '../cloud-spi/azureCacheSchema'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.Cache/redis,
 * verified against the published `floci/floci-az` image:
 *
 *   list   GET    /subscriptions/{s}/providers/Microsoft.Cache/redis
 *   get    GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Cache/redis/{n}
 *   create PUT    (same path as get)                                  -> 201
 *   delete DELETE (same path as get)                                  -> 202
 *   name   POST   /subscriptions/{s}/providers/Microsoft.Cache/checkNameAvailability
 *          200 when free, 409 NameNotAvailable when taken
 *
 * Access keys: every ARM body the runtime returns embeds `properties.accessKeys`,
 * and `listKeys` and `regenerateKey` return them too. This adapter never calls
 * those two actions, and the resource mapping copies named fields only, so the
 * embedded keys never reach list or inspect.
 *
 * The id is `resourceGroup/name`: ARM cannot address a cache without its group.
 */
const API_VERSION = '2024-11-01'
const RESOURCE_API_VERSION = '2021-04-01'

interface ArmList<T> {
    value?: T[]
}

interface ArmCache {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
        provisioningState?: string
        redisVersion?: string
        sku?: {name?: string; family?: string; capacity?: number}
        enableNonSslPort?: boolean
        minimumTlsVersion?: string
        hostName?: string
        port?: number
        sslPort?: number
        publicNetworkAccess?: string
    }
}

export class AzureCacheAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'cache' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureCacheSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<ArmCache>>(
            `/subscriptions/${subscription}/providers/Microsoft.Cache/redis?api-version=${API_VERSION}`,
        )
        return filterBySearch((body?.value ?? []).map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.cachePath(resourceGroup, name)
        const cache = await this.json<ArmCache>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        return cache ? toResource(cache) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(REDIS_CACHE_NAME_PATTERN).test(name)) {
            throw new ValidationError(`name is invalid. ${REDIS_CACHE_NAME_MESSAGE}`)
        }
        const sku = optionalOneOf(input.values.sku, REDIS_SKUS, 'sku') ?? 'Basic'
        const location = optionalOneOf(input.values.location, REDIS_LOCATIONS, 'location') ?? 'eastus'
        const resourceGroup = await this.resolveResourceGroup(requiredString(input.values.resourceGroup, 'resourceGroup'))

        await this.assertNameAvailable(name)

        const path = await this.cachePath(resourceGroup, name)
        await this.json(`${path}?api-version=${API_VERSION}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({location, properties: {sku: skuBody(sku)}}),
        })

        const created = await this.get(`${resourceGroup}/${name}`)
        if (!created) throw new RuntimeError(`${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.cachePath(resourceGroup, name)
        await this.client.fetch(`${path}?api-version=${API_VERSION}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    /**
     * Cache names are global, and a PUT on a taken name in the same group would
     * silently update it instead of failing. The runtime answers a taken name with
     * a 409, which is surfaced as a validation error rather than a runtime failure.
     */
    private async assertNameAvailable(name: string): Promise<void> {
        const subscription = await this.subscription()
        const res = await this.client.fetch(
            `/subscriptions/${subscription}/providers/Microsoft.Cache/checkNameAvailability?api-version=${API_VERSION}`,
            {
                method: 'POST',
                headers: {accept: 'application/json', 'content-type': 'application/json'},
                body: JSON.stringify({name, type: 'Microsoft.Cache/redis'}),
            },
            {allowErrorStatus: true},
        )
        if (res?.status === 409) {
            throw new ValidationError(`The cache name ${name} is not available. Choose a different name.`)
        }
        if (res && !res.ok) throw new RuntimeError(`Floci-AZ could not check the cache name ${name}: HTTP ${res.status}`)
    }

    /** The runtime ignores the subscription id, but a real one keeps the emitted ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope Azure Cache for Redis requests to')

        this.subscriptionId = id
        return id
    }

    private async cachePath(resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Cache/redis/${encodeURIComponent(name)}`
    }

    /**
     * The runtime accepts a resource group that does not exist, while real Azure
     * answers ResourceGroupNotFound, so the check lives here. The runtime's own
     * spelling is returned so the id matches the one `list()` reports.
     */
    private async resolveResourceGroup(resourceGroup: string): Promise<string> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<{name?: string}>>(
            `/subscriptions/${subscription}/resourceGroups?api-version=${RESOURCE_API_VERSION}`,
        )
        const match = (body?.value ?? []).find((group) => group.name?.toLowerCase() === resourceGroup.toLowerCase())
        if (!match?.name) {
            throw new ValidationError(`resource group ${resourceGroup} does not exist; create it first`)
        }
        return match.name
    }

    private async json<T>(path: string, init: RequestInit = {}, options = {}): Promise<T | null> {
        const res = await this.client.fetch(path, {...init, headers: {accept: 'application/json', ...(init.headers ?? {})}}, options)
        if (!res || res.status === 204) return null

        const text = await res.text()
        if (!text) return null
        return JSON.parse(text) as T
    }
}

/** Premium is the only tier of the P family, and it starts at capacity 1. */
function skuBody(sku: (typeof REDIS_SKUS)[number]): {name: string; family: string; capacity: number} {
    return sku === 'Premium' ? {name: sku, family: 'P', capacity: 1} : {name: sku, family: 'C', capacity: 0}
}

function toResource(cache: ArmCache): CloudResource {
    const properties = cache.properties ?? {}
    const name = cache.name ?? ''
    const resourceGroup = resourceGroupOf(cache.id ?? '')

    return {
        id: resourceGroup ? `${resourceGroup}/${name}` : name,
        name,
        cloud: 'azure',
        service: 'cache',
        type: 'cache',
        region: cache.location ?? null,
        createdAt: null,
        status: properties.provisioningState ?? null,
        metadata: {
            provider: 'azure',
            resourceId: cache.id,
            resourceGroup,
            hostName: properties.hostName,
            port: properties.port,
            sslPort: properties.sslPort,
            sku: properties.sku?.name,
            skuFamily: properties.sku?.family,
            skuCapacity: properties.sku?.capacity,
            redisVersion: properties.redisVersion,
            enableNonSslPort: properties.enableNonSslPort,
            minimumTlsVersion: properties.minimumTlsVersion,
            publicNetworkAccess: properties.publicNetworkAccess,
            tags: cache.tags,
        },
    }
}

function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`cache id must be "resourceGroup/name", got "${id}"`)
    }
    return {resourceGroup, name}
}

function resourceGroupOf(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i)
    return match ? match[1] : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
    return value.trim()
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const text = requiredString(value, field)
    if (!allowed.includes(text as T)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
    return text as T
}
