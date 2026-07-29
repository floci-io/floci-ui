import {azure, type AzureRuntimeClient} from '../azure'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    AZURE_VNET_LOCATIONS,
    AZURE_VNET_NAME_PATTERN,
    CIDR_PATTERN,
    azureNetworkingSchema,
} from '../cloud-spi/networkingSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.Network — verified
 * against `floci/floci-az` 0.9.0:
 *
 *   list   GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks
 *                 (per group, aggregated — the subscription-scoped path answers
 *                  200 with an empty value and never reports a real VNet)
 *   get    GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/{n}
 *   create PUT    (same path as get) -> 200, provisioningState Succeeded
 *   delete DELETE (same path as get) -> 200, and the VNet is gone
 *
 * Unlike the AWS side of this category, create and delete are advertised as
 * available. A VNet needs only a name, a location and an address prefix, which a
 * flat form expresses fine — there are none of the dependent selectors that pushed
 * VPC creation into the AWS Networking panel. Both verbs were verified end to end
 * rather than assumed from the AWS shape.
 */
const API_VERSION = '2023-09-01'
const RESOURCE_API_VERSION = '2021-04-01'

interface ArmList<T> {
    value?: T[]
}

interface AzureSubnet {
    name?: string
    properties?: {addressPrefix?: string}
}

interface AzureVnet {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
        addressSpace?: {addressPrefixes?: string[]}
        subnets?: AzureSubnet[]
        provisioningState?: string
    }
}

export class AzureNetworkingAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'networking' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureNetworkingSchema()
    }

    /**
     * Enumerates resource groups and aggregates the per-group VNet lists.
     *
     * The subscription-scoped path exists in ARM and returns HTTP 200 here, but
     * floci-az only implements the resource-group-scoped list: it routes the
     * subscription path into its network service with a placeholder group, the
     * strict match fails, and the response is a clean `{"value": []}`. So the
     * call succeeds and the table stays empty even after a create that worked —
     * a silent failure rather than an error. Verified 2026-07-29: a VNet created
     * in `rg-probe` is absent from the subscription scope and present in the
     * group scope.
     */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const groups = await this.resourceGroupNames()
        const perGroup = await Promise.all(
            groups.map(async (group) => {
                const body = await this.json<ArmList<AzureVnet>>(
                    `${await this.vnetCollectionPath(group)}?api-version=${API_VERSION}`,
                    {},
                    // One unreadable group must not blank the whole table.
                    {emptyOnNotFound: true},
                )
                return body?.value ?? []
            }),
        )
        return filterBySearch(perGroup.flat().map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.vnetPath(resourceGroup, name)
        const network = await this.json<AzureVnet>(
            `${path}?api-version=${API_VERSION}`,
            {},
            {emptyOnNotFound: true},
        )
        return network ? toResource(network) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(AZURE_VNET_NAME_PATTERN).test(name)) {
            throw new ValidationError(
                'name must be 2-64 characters, start with a letter or digit and end with a letter, digit or underscore',
            )
        }
        const requestedGroup = requiredString(input.values.resourceGroup, 'resourceGroup')
        const addressPrefix = requiredCidr(input.values.addressPrefix, 'addressPrefix')
        const location = optionalOneOf(input.values.location, AZURE_VNET_LOCATIONS, 'location') ?? 'eastus'
        const subnet = optionalSubnet(input.values)

        const resourceGroup = await this.resolveResourceGroup(requestedGroup)
        const path = await this.vnetPath(resourceGroup, name)

        await this.json(`${path}?api-version=${API_VERSION}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                location,
                properties: {
                    addressSpace: {addressPrefixes: [addressPrefix]},
                    ...(subnet ? {subnets: [{name: subnet.name, properties: {addressPrefix: subnet.prefix}}]} : {}),
                },
            }),
        })

        const created = await this.get(`${resourceGroup}/${name}`)
        if (!created) throw new RuntimeError(`VNet ${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.vnetPath(resourceGroup, name)
        await this.client.fetch(`${path}?api-version=${API_VERSION}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    /** The runtime ignores the subscription id, but a real one keeps ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope network requests to')

        this.subscriptionId = id
        return id
    }

    private async vnetPath(resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Network/virtualNetworks/${encodeURIComponent(name)}`
    }

    /** Every resource group in the subscription, in the runtime's own casing. */
    private async resourceGroupNames(): Promise<string[]> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<{name?: string}>>(
            `/subscriptions/${subscription}/resourceGroups?api-version=${RESOURCE_API_VERSION}`,
        )
        return (body?.value ?? []).map((group) => group.name).filter((name): name is string => Boolean(name))
    }

    /** The group-scoped VNet collection path — the only list scope floci-az serves. */
    private async vnetCollectionPath(resourceGroup: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Network/virtualNetworks`
    }

    /**
     * Resolve the caller's resource group to the spelling the runtime uses.
     *
     * Azure treats these names case-insensitively, so `RG-App` must match `rg-app`
     * — but the runtime's casing is what gets used, because the id is
     * `resourceGroup/name` and echoing the caller's casing would emit an id that
     * does not match the one `list()` reports.
     */
    private async resolveResourceGroup(resourceGroup: string): Promise<string> {
        const match = (await this.resourceGroupNames()).find(
            (group) => group.toLowerCase() === resourceGroup.toLowerCase(),
        )
        if (!match) {
            throw new ValidationError(
                `resource group ${resourceGroup} does not exist; create it before adding a VNet`,
            )
        }
        return match
    }

    /**
     * Mirrors the `azureJson`/`cosmosJson` helpers the other Azure adapters use:
     * ARM endpoints can be Accept-sensitive, and a 204 carries no body to parse.
     *
     * Five copies of this now exist across adapter-azure/. Worth lifting onto
     * AzureRuntimeClient once the open Azure PRs have merged — doing it in three
     * parallel branches would just conflict.
     */
    private async json<T>(path: string, init: RequestInit = {}, options = {}): Promise<T | null> {
        const res = await this.client.fetch(
            path,
            {
                ...init,
                headers: {
                    accept: 'application/json',
                    ...(init.headers ?? {}),
                },
            },
            options,
        )
        if (!res || res.status === 204) return null

        const text = await res.text()
        if (!text) return null
        return JSON.parse(text) as T
    }
}

function toResource(network: AzureVnet): CloudResource {
    const properties = network.properties ?? {}
    const name = network.name ?? ''
    const resourceGroup = resourceGroupOf(network.id ?? '')
    const prefixes = properties.addressSpace?.addressPrefixes ?? []
    const subnets = (properties.subnets ?? []).map((subnet) => ({
        name: subnet.name ?? '',
        addressPrefix: subnet.properties?.addressPrefix ?? '',
    }))

    return {
        id: resourceGroup ? `${resourceGroup}/${name}` : name,
        name,
        cloud: 'azure',
        service: 'networking',
        // A VNet is Azure's VPC; reusing the existing type keeps the shared column
        // meaningful without widening the union.
        type: 'vpc',
        region: network.location ?? null,
        // ARM returns no creation time for a virtual network.
        createdAt: null,
        status: properties.provisioningState ?? null,
        metadata: {
            provider: 'azure',
            resourceId: network.id,
            resourceGroup,
            /** Shared key so the networking column renders for AWS and Azure alike. */
            cidrBlock: prefixes[0],
            addressPrefixes: prefixes,
            subnets,
            subnetCount: subnets.length,
            tags: network.tags,
        },
    }
}

/** ARM cannot address a VNet without its resource group, so the id carries both. */
function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`VNet id must be "resourceGroup/name", got "${id}"`)
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

/** Both subnet fields or neither: half a subnet is not something ARM can act on. */
function optionalSubnet(values: Record<string, unknown>): {name: string; prefix: string} | undefined {
    const name = optionalString(values.subnetName, 'subnetName')
    const prefix = optionalString(values.subnetPrefix, 'subnetPrefix')

    if (name === undefined && prefix === undefined) return undefined
    if (name === undefined) throw new ValidationError('subnetName is required when subnetPrefix is given')
    if (prefix === undefined) throw new ValidationError('subnetPrefix is required when subnetName is given')

    assertCidr(prefix, 'subnetPrefix')
    return {name, prefix}
}

function requiredCidr(value: unknown, field: string): string {
    const raw = requiredString(value, field)
    assertCidr(raw, field)
    return raw
}

function assertCidr(value: string, field: string): void {
    if (!new RegExp(CIDR_PATTERN).test(value)) {
        throw new ValidationError(`${field} must be an IPv4 CIDR such as 10.0.0.0/16`)
    }
}

function requiredString(value: unknown, field: string): string {
    const raw = optionalString(value, field)
    if (raw === undefined) throw new ValidationError(`${field} is required`)
    return raw
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value.trim() || undefined
}

function optionalOneOf<T extends readonly string[]>(
    value: unknown,
    allowed: T,
    field: string,
): T[number] | undefined {
    const raw = optionalString(value, field)
    if (raw === undefined) return undefined
    if (!allowed.includes(raw)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
    return raw as T[number]
}
