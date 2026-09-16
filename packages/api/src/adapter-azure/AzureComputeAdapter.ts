import {azure, type AzureRuntimeClient} from '../azure'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    AZURE_LOCATIONS,
    AZURE_VM_IMAGES,
    AZURE_VM_NAME_PATTERN,
    AZURE_VM_SIZES,
    azureComputeSchema,
} from '../cloud-spi/computeSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.Compute — verified
 * against `floci/floci-az` 0.9.0:
 *
 *   list    GET    /subscriptions/{s}/providers/Microsoft.Compute/virtualMachines
 *   get     GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{n}
 *   create  PUT    (same path as get)                                    -> 201
 *   delete  DELETE (same path as get)                                    -> 204
 *   power   GET    (get path)/instanceView                               -> statuses[]
 *   start   POST   (get path)/start        -> 202
 *   stop    POST   (get path)/powerOff     -> 202
 *   reboot  POST   (get path)/restart      -> 202
 *
 * This corrects an earlier assumption that floci-az answers 501 for everything
 * beyond blob and Cosmos. That is true of the *legacy* endpoints (`/functions`,
 * `/Tables`) but not of ARM: the provider paths are real handlers, confirmed
 * because a bogus provider 404s with `Unsupported Microsoft.Compute path`.
 *
 * Notes from probing the runtime:
 *  - It does **not** partition by subscription: any subscription id returns the
 *    same resources. The subscription is therefore discovered from
 *    `/subscriptions` and used as a fixed scope; it is never presented as a
 *    selectable scope, which would be fake data.
 *  - Lifecycle verbs genuinely change power state, so they are advertised.
 *  - `create` succeeds with 201 even when the resource group does not exist. Real
 *    Azure answers ResourceGroupNotFound, so this adapter checks first.
 *  - Resource group DELETE returns 200 and does nothing, so this adapter does not
 *    manage resource groups at all.
 */
const API_VERSION = '2023-03-01'
const RESOURCE_API_VERSION = '2021-04-01'

interface ArmList<T> {
    value?: T[]
}

interface AzureVm {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
        hardwareProfile?: {vmSize?: string}
        storageProfile?: {
            imageReference?: {publisher?: string; offer?: string; sku?: string; version?: string}
            osDisk?: Record<string, unknown>
        }
        osProfile?: {computerName?: string; adminUsername?: string}
        vmId?: string
        provisioningState?: string
        timeCreated?: string
    }
}

interface AzureInstanceView {
    computerName?: string
    osName?: string
    statuses?: Array<{code?: string; displayStatus?: string; level?: string}>
}

/** Power state plus whether the lookup failed, so the two stay distinguishable. */
type PowerLookup = {state: string | null; unavailable?: true}

export class AzureComputeAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'compute' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureComputeSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<AzureVm>>(
            `/subscriptions/${subscription}/providers/Microsoft.Compute/virtualMachines?api-version=${API_VERSION}`,
        )

        const resources = await Promise.all(
            (body?.value ?? []).map(async (machine) => toResource(machine, await this.powerState(machine.id ?? ''))),
        )
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.vmPath(resourceGroup, name)
        const machine = await this.json<AzureVm>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        if (!machine) return null
        return toResource(machine, await this.powerState(machine.id ?? ''))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(AZURE_VM_NAME_PATTERN).test(name)) {
            throw new ValidationError(
                'name must start with a letter or digit and contain only letters, digits, hyphens, underscores and periods',
            )
        }
        const requestedGroup = requiredString(input.values.resourceGroup, 'resourceGroup')
        const vmSize = requiredOneOf(input.values.vmSize, AZURE_VM_SIZES, 'vmSize')
        const imageLabel = requiredOneOf(
            input.values.image,
            Object.keys(AZURE_VM_IMAGES) as Array<keyof typeof AZURE_VM_IMAGES>,
            'image',
        )
        const location = optionalOneOf(input.values.location, AZURE_LOCATIONS, 'location') ?? 'eastus'
        const adminUsername = optionalString(input.values.adminUsername, 'adminUsername') ?? 'azureuser'

        const resourceGroup = await this.resolveResourceGroup(requestedGroup)

        const path = await this.vmPath(resourceGroup, name)
        await this.json(`${path}?api-version=${API_VERSION}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                location,
                properties: {
                    hardwareProfile: {vmSize},
                    storageProfile: {imageReference: AZURE_VM_IMAGES[imageLabel]},
                    osProfile: {computerName: name, adminUsername},
                },
            }),
        })

        const created = await this.get(`${resourceGroup}/${name}`)
        if (!created) throw new RuntimeError(`VM ${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.vmPath(resourceGroup, name)
        await this.client.fetch(`${path}?api-version=${API_VERSION}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    async start(id: string): Promise<void> {
        await this.power(id, 'start')
    }

    /** ARM calls it powerOff; `deallocate` also exists but releases the compute. */
    async stop(id: string): Promise<void> {
        await this.power(id, 'powerOff')
    }

    async reboot(id: string): Promise<void> {
        await this.power(id, 'restart')
    }

    private async power(id: string, action: 'start' | 'powerOff' | 'restart'): Promise<void> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.vmPath(resourceGroup, name)
        await this.client.fetch(`${path}/${action}?api-version=${API_VERSION}`, {method: 'POST'})
    }

    /**
     * The runtime ignores the subscription id, but a real one keeps the emitted
     * resource ids honest, so it is discovered once rather than hardcoded.
     */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope compute requests to')

        this.subscriptionId = id
        return id
    }

    private async vmPath(resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(name)}`
    }

    /**
     * Resolve a caller-supplied resource group to the spelling the runtime uses,
     * failing if it does not exist.
     *
     * Two reasons this is not a plain equality check. The runtime creates a VM in a
     * nonexistent resource group and returns 201 while real Azure answers
     * ResourceGroupNotFound, so the existence check has to live here. And Azure
     * treats these names case-insensitively, so `RG-App` must match `rg-app` — but
     * the *runtime's* casing is what gets used, because the resource id is
     * `resourceGroup/name` and echoing the caller's casing would emit an id that
     * does not match the one `list()` reports.
     */
    private async resolveResourceGroup(resourceGroup: string): Promise<string> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<{name?: string}>>(
            `/subscriptions/${subscription}/resourceGroups?api-version=${RESOURCE_API_VERSION}`,
        )
        const match = (body?.value ?? []).find(
            (group) => group.name?.toLowerCase() === resourceGroup.toLowerCase(),
        )
        if (!match?.name) {
            throw new ValidationError(`resource group ${resourceGroup} does not exist; create it before adding a VM`)
        }
        return match.name
    }

    /**
     * Power state comes from a per-VM instanceView call, so a failure degrades the
     * row rather than the request — `list` fans these out through `Promise.all`.
     */
    private async powerState(resourceId: string): Promise<PowerLookup> {
        if (!resourceId) return {state: null}

        try {
            const view = await this.json<AzureInstanceView>(`${resourceId}/instanceView?api-version=${API_VERSION}`)
            const power = (view?.statuses ?? []).find((status) => status.code?.startsWith('PowerState/'))
            return {state: power?.code?.slice('PowerState/'.length) ?? null}
        } catch {
            return {state: null, unavailable: true}
        }
    }

    private async json<T>(path: string, init: RequestInit = {}, options = {}): Promise<T | null> {
        const res = await this.client.fetch(path, init, options)
        if (!res) return null

        const text = await res.text()
        if (!text) return null
        return JSON.parse(text) as T
    }
}

function toResource(machine: AzureVm, power: PowerLookup): CloudResource {
    const properties = machine.properties ?? {}
    const name = machine.name ?? ''
    const resourceGroup = resourceGroupOf(machine.id ?? '')
    const image = properties.storageProfile?.imageReference

    return {
        id: resourceGroup ? `${resourceGroup}/${name}` : name,
        name,
        cloud: 'azure',
        service: 'compute',
        type: 'instance',
        region: machine.location ?? null,
        createdAt: properties.timeCreated ?? null,
        status: power.state,
        instanceClass: properties.hardwareProfile?.vmSize ?? null,
        metadata: {
            provider: 'azure',
            resourceId: machine.id,
            resourceGroup,
            vmId: properties.vmId,
            provisioningState: properties.provisioningState,
            computerName: properties.osProfile?.computerName,
            adminUsername: properties.osProfile?.adminUsername,
            image: image ? `${image.publisher}:${image.offer}:${image.sku}` : undefined,
            imageVersion: image?.version,
            osDisk: properties.storageProfile?.osDisk,
            tags: machine.tags,
            ...(power.unavailable ? {powerStateUnavailable: true} : {}),
        },
    }
}

/** ARM cannot address a VM without its resource group, so the id carries both. */
function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`VM id must be "resourceGroup/name", got "${id}"`)
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
    const raw = optionalString(value, field)
    if (raw === undefined) throw new ValidationError(`${field} is required`)
    return raw
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value.trim() || undefined
}

function requiredOneOf<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
    const raw = requiredString(value, field)
    if (!allowed.includes(raw)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
    return raw as T[number]
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
