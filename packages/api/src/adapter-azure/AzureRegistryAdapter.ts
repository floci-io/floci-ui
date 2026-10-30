import {azure, type AzureRuntimeClient} from '../azure'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {ACR_LOCATIONS, ACR_NAME_MESSAGE, ACR_NAME_PATTERN, ACR_SKUS, azureRegistrySchema} from '../cloud-spi/registrySchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.ContainerRegistry,
 * verified against `floci/floci-az` (AcrHandler):
 *
 *   list   GET    /subscriptions/{s}/providers/Microsoft.ContainerRegistry/registries
 *   get    GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.ContainerRegistry/registries/{n}
 *   create PUT    (same path as get)                                  -> 201
 *   delete DELETE (same path as get)                                  -> 202
 *   name   POST   /subscriptions/{s}/providers/Microsoft.ContainerRegistry/checkNameAvailability
 *
 * Credentials: the runtime also serves `listCredentials` and `regenerateCredential`,
 * which return the admin passwords. This adapter never calls them, and the
 * resource mapping copies named fields only, so a runtime that started echoing a
 * password on the registry itself would not leak it into list or inspect.
 *
 * The id is `resourceGroup/name`: ARM cannot address a registry without its group.
 */
const API_VERSION = '2023-07-01'
const RESOURCE_API_VERSION = '2021-04-01'

interface ArmList<T> {
    value?: T[]
}

interface ArmRegistry {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    sku?: {name?: string; tier?: string}
    properties?: {
        loginServer?: string
        creationDate?: string
        provisioningState?: string
        adminUserEnabled?: boolean
        publicNetworkAccess?: string
        anonymousPullEnabled?: boolean
        zoneRedundancy?: string
        dataEndpointEnabled?: boolean
        networkRuleBypassOptions?: string
    }
}

interface NameAvailability {
    nameAvailable?: boolean
    reason?: string
    message?: string
}

export class AzureRegistryAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'registry' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureRegistrySchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<ArmRegistry>>(
            `/subscriptions/${subscription}/providers/Microsoft.ContainerRegistry/registries?api-version=${API_VERSION}`,
        )
        return filterBySearch((body?.value ?? []).map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.registryPath(resourceGroup, name)
        const registry = await this.json<ArmRegistry>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        return registry ? toResource(registry) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(ACR_NAME_PATTERN).test(name)) {
            throw new ValidationError(`name is invalid. ${ACR_NAME_MESSAGE}`)
        }
        const sku = optionalOneOf(input.values.sku, ACR_SKUS, 'sku') ?? 'Basic'
        const location = optionalOneOf(input.values.location, ACR_LOCATIONS, 'location') ?? 'eastus'
        const adminUserEnabled = optionalBoolean(input.values.adminUserEnabled, 'adminUserEnabled')
        const resourceGroup = await this.resolveResourceGroup(requiredString(input.values.resourceGroup, 'resourceGroup'))

        await this.assertNameAvailable(name)

        const path = await this.registryPath(resourceGroup, name)
        await this.json(`${path}?api-version=${API_VERSION}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({location, sku: {name: sku}, properties: {adminUserEnabled}}),
        })

        const created = await this.get(`${resourceGroup}/${name}`)
        if (!created) throw new RuntimeError(`${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.registryPath(resourceGroup, name)
        await this.client.fetch(`${path}?api-version=${API_VERSION}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    /** Registry names are global, and a PUT on a taken name would silently update it instead of failing. */
    private async assertNameAvailable(name: string): Promise<void> {
        const subscription = await this.subscription()
        const result = await this.json<NameAvailability>(
            `/subscriptions/${subscription}/providers/Microsoft.ContainerRegistry/checkNameAvailability?api-version=${API_VERSION}`,
            {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({name, type: 'Microsoft.ContainerRegistry/registries'}),
            },
        )
        if (result?.nameAvailable === false) {
            throw new ValidationError(result.message || `The registry name ${name} is not available.`)
        }
    }

    /** The runtime ignores the subscription id, but a real one keeps the emitted ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope Container Registry requests to')

        this.subscriptionId = id
        return id
    }

    private async registryPath(resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ContainerRegistry/registries/${encodeURIComponent(name)}`
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

function toResource(registry: ArmRegistry): CloudResource {
    const properties = registry.properties ?? {}
    const name = registry.name ?? ''
    const resourceGroup = resourceGroupOf(registry.id ?? '')

    return {
        id: resourceGroup ? `${resourceGroup}/${name}` : name,
        name,
        cloud: 'azure',
        service: 'registry',
        type: 'registry',
        region: registry.location ?? null,
        createdAt: properties.creationDate ?? null,
        status: properties.provisioningState ?? null,
        metadata: {
            provider: 'azure',
            resourceId: registry.id,
            resourceGroup,
            loginServer: properties.loginServer,
            sku: registry.sku?.name,
            adminUserEnabled: properties.adminUserEnabled,
            publicNetworkAccess: properties.publicNetworkAccess,
            anonymousPullEnabled: properties.anonymousPullEnabled,
            zoneRedundancy: properties.zoneRedundancy,
            dataEndpointEnabled: properties.dataEndpointEnabled,
            networkRuleBypassOptions: properties.networkRuleBypassOptions,
            tags: registry.tags,
        },
    }
}

function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`registry id must be "resourceGroup/name", got "${id}"`)
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

function optionalBoolean(value: unknown, field: string): boolean {
    if (value === undefined || value === null || value === '') return false
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
    throw new ValidationError(`${field} must be true or false`)
}
