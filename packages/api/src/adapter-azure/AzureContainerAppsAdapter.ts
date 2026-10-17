import {azure, type AzureRuntimeClient} from '../azure'
import {
    CONTAINER_APP_INGRESS_MODES,
    CONTAINER_APP_LOCATIONS,
    CONTAINER_APP_NAME_MESSAGE,
    CONTAINER_APP_NAME_PATTERN,
    azureContainersSchema,
} from '../cloud-spi/containersSchema'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.App, verified against
 * `floci/floci-az` 0.15.0:
 *
 *   list    GET    /subscriptions/{s}/providers/Microsoft.App/{managedEnvironments|containerApps}
 *   get     GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.App/{kind}/{n}
 *   create  PUT    (same path as get)                       -> 201
 *   delete  DELETE (same path as get)                       -> 204
 *   revisions GET  (app path)/revisions
 *
 * Environments and apps share one resource list, so the id carries the kind:
 * `containerApps/{rg}/{name}` or `managedEnvironments/{rg}/{name}`.
 *
 * Secrets: the runtime already drops `properties.configuration.secrets[].value`
 * from every response and only returns it from the POST `listSecrets` action,
 * which this adapter never calls. The mapping below still copies secret names
 * only, so a runtime that started returning values would not leak them into
 * list or inspect.
 */
const API_VERSION = '2025-07-01'
const RESOURCE_API_VERSION = '2021-04-01'

type Kind = 'containerApps' | 'managedEnvironments'

interface ArmList<T> {
    value?: T[]
}

interface ContainerSpec {
    name?: string
    image?: string
    env?: Array<{name?: string; value?: string; secretRef?: string}>
}

interface ContainerAppTemplate {
    containers?: ContainerSpec[]
    scale?: {minReplicas?: number; maxReplicas?: number}
}

interface ContainerAppIngress {
    external?: boolean
    targetPort?: number
    fqdn?: string
}

interface ArmContainerApp {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
        environmentId?: string
        provisioningState?: string
        runningStatus?: string
        latestRevisionName?: string
        latestReadyRevisionName?: string
        configuration?: {
            activeRevisionsMode?: string
            ingress?: ContainerAppIngress | null
            secrets?: Array<{name?: string}>
        }
        template?: ContainerAppTemplate
    }
}

interface ArmManagedEnvironment {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
        provisioningState?: string
        defaultDomain?: string
        staticIp?: string
        zoneRedundant?: boolean
    }
}

interface ArmRevision {
    name?: string
    properties?: {
        active?: boolean
        createdTime?: string
        lastActiveTime?: string
        fqdn?: string
        healthState?: string
        provisioningState?: string
        runningState?: string
        replicas?: number
        trafficWeight?: number
        template?: ContainerAppTemplate
    }
}

export class AzureContainerAppsAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'containers' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureContainersSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const [environments, apps] = await Promise.all([
            this.json<ArmList<ArmManagedEnvironment>>(
                `/subscriptions/${subscription}/providers/Microsoft.App/managedEnvironments?api-version=${API_VERSION}`,
            ),
            this.json<ArmList<ArmContainerApp>>(
                `/subscriptions/${subscription}/providers/Microsoft.App/containerApps?api-version=${API_VERSION}`,
            ),
        ])

        return filterBySearch(
            [
                ...(environments?.value ?? []).map(toEnvironmentResource),
                ...(apps?.value ?? []).map((app) => toAppResource(app)),
            ],
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const {kind, resourceGroup, name} = parseId(id)
        const path = await this.resourcePath(kind, resourceGroup, name)

        if (kind === 'managedEnvironments') {
            const environment = await this.json<ArmManagedEnvironment>(
                `${path}?api-version=${API_VERSION}`,
                {},
                {emptyOnNotFound: true},
            )
            return environment ? toEnvironmentResource(environment) : null
        }

        const app = await this.json<ArmContainerApp>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        if (!app) return null

        const revisions = await this.json<ArmList<ArmRevision>>(
            `${path}/revisions?api-version=${API_VERSION}`,
            {},
            {emptyOnNotFound: true},
        )
        return toAppResource(app, (revisions?.value ?? []).map(toRevision))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = requiredOneOf(input.values.resourceType, ['containerApp', 'managedEnvironment'], 'resourceType')
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(CONTAINER_APP_NAME_PATTERN).test(name)) {
            throw new ValidationError(`name is invalid. ${CONTAINER_APP_NAME_MESSAGE}`)
        }
        const location = optionalOneOf(input.values.location, CONTAINER_APP_LOCATIONS, 'location') ?? 'eastus'
        const resourceGroup = await this.resolveResourceGroup(requiredString(input.values.resourceGroup, 'resourceGroup'))

        if (resourceType === 'managedEnvironment') {
            const path = await this.resourcePath('managedEnvironments', resourceGroup, name)
            await this.json(`${path}?api-version=${API_VERSION}`, putJson({location, properties: {}}))
            return await this.readBack(`managedEnvironments/${resourceGroup}/${name}`, name)
        }

        const environmentName = requiredString(input.values.environment, 'environment')
        const image = requiredString(input.values.image, 'image')
        const ingress = optionalOneOf(input.values.ingress, CONTAINER_APP_INGRESS_MODES, 'ingress') ?? 'none'
        const targetPort = optionalPort(input.values.targetPort)

        const environmentPath = await this.resourcePath('managedEnvironments', resourceGroup, environmentName)
        const environment = await this.json<ArmManagedEnvironment>(
            `${environmentPath}?api-version=${API_VERSION}`,
            {},
            {emptyOnNotFound: true},
        )
        if (!environment?.id) {
            throw new ValidationError(
                `managed environment ${environmentName} does not exist in resource group ${resourceGroup}; create it first`,
            )
        }

        const path = await this.resourcePath('containerApps', resourceGroup, name)
        await this.json(
            `${path}?api-version=${API_VERSION}`,
            putJson({
                location,
                properties: {
                    environmentId: environment.id,
                    configuration:
                        ingress === 'none' ? {} : {ingress: {external: ingress === 'external', targetPort: targetPort ?? 80}},
                    template: {containers: [{name, image}]},
                },
            }),
        )
        return await this.readBack(`containerApps/${resourceGroup}/${name}`, name)
    }

    async delete(id: string): Promise<void> {
        const {kind, resourceGroup, name} = parseId(id)
        const path = await this.resourcePath(kind, resourceGroup, name)
        await this.client.fetch(`${path}?api-version=${API_VERSION}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    private async readBack(id: string, name: string): Promise<CloudResource> {
        const created = await this.get(id)
        if (!created) throw new RuntimeError(`${name} was created but could not be read back`)
        return created
    }

    /** The runtime ignores the subscription id, but a real one keeps the emitted ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope Container Apps requests to')

        this.subscriptionId = id
        return id
    }

    private async resourcePath(kind: Kind, resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.App/${kind}/${encodeURIComponent(name)}`
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

function putJson(body: unknown): RequestInit {
    return {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}
}

function toEnvironmentResource(environment: ArmManagedEnvironment): CloudResource {
    const properties = environment.properties ?? {}
    const name = environment.name ?? ''
    const resourceGroup = resourceGroupOf(environment.id ?? '')

    return {
        id: `managedEnvironments/${resourceGroup}/${name}`,
        name,
        cloud: 'azure',
        service: 'containers',
        type: 'managed-environment',
        region: environment.location ?? null,
        // ARM returns no creation time here, and inventing one would be fake data.
        createdAt: null,
        status: properties.provisioningState ?? null,
        metadata: {
            provider: 'azure',
            resourceId: environment.id,
            resourceGroup,
            defaultDomain: properties.defaultDomain,
            staticIp: properties.staticIp,
            zoneRedundant: properties.zoneRedundant,
            tags: environment.tags,
        },
    }
}

function toAppResource(app: ArmContainerApp, revisions?: Array<Record<string, unknown>>): CloudResource {
    const properties = app.properties ?? {}
    const configuration = properties.configuration ?? {}
    const name = app.name ?? ''
    const resourceGroup = resourceGroupOf(app.id ?? '')
    const containers = properties.template?.containers ?? []
    const scale = properties.template?.scale

    return {
        id: `containerApps/${resourceGroup}/${name}`,
        name,
        cloud: 'azure',
        service: 'containers',
        type: 'container-app',
        region: app.location ?? null,
        createdAt: null,
        status: properties.provisioningState ?? null,
        version: properties.latestRevisionName ?? null,
        metadata: {
            provider: 'azure',
            resourceId: app.id,
            resourceGroup,
            environmentId: properties.environmentId,
            environmentName: lastSegment(properties.environmentId),
            image: containers.map((container) => container.image).filter(Boolean).join(', ') || null,
            containers: containers.map((container) => ({
                name: container.name,
                image: container.image,
                // Plain env values are left out on purpose: they are routinely used for credentials.
                env: (container.env ?? []).map((entry) => ({name: entry.name, secretRef: entry.secretRef})),
            })),
            runningStatus: properties.runningStatus,
            activeRevisionsMode: configuration.activeRevisionsMode,
            latestRevisionName: properties.latestRevisionName,
            latestReadyRevisionName: properties.latestReadyRevisionName,
            minReplicas: scale?.minReplicas,
            maxReplicas: scale?.maxReplicas,
            ingress: configuration.ingress
                ? {
                      external: configuration.ingress.external,
                      targetPort: configuration.ingress.targetPort,
                      fqdn: configuration.ingress.fqdn,
                  }
                : null,
            // Names only. The runtime strips the values and this keeps it that way.
            secretNames: (configuration.secrets ?? []).map((secret) => secret.name).filter(Boolean),
            ...(revisions ? {revisions} : {}),
            tags: app.tags,
        },
    }
}

function toRevision(revision: ArmRevision): Record<string, unknown> {
    const properties = revision.properties ?? {}
    return {
        name: revision.name,
        active: properties.active,
        createdAt: properties.createdTime ?? null,
        lastActiveAt: properties.lastActiveTime ?? null,
        provisioningState: properties.provisioningState,
        runningState: properties.runningState,
        healthState: properties.healthState,
        replicas: properties.replicas,
        trafficWeight: properties.trafficWeight,
        fqdn: properties.fqdn,
        images: (properties.template?.containers ?? []).map((container) => container.image).filter(Boolean),
    }
}

/** ARM cannot address a resource without its group, and the two kinds can share a name. */
function parseId(id: string): {kind: Kind; resourceGroup: string; name: string} {
    const [kind, resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if ((kind !== 'containerApps' && kind !== 'managedEnvironments') || !resourceGroup || !name) {
        throw new ValidationError(
            `id must be "containerApps/resourceGroup/name" or "managedEnvironments/resourceGroup/name", got "${id}"`,
        )
    }
    return {kind, resourceGroup, name}
}

function resourceGroupOf(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i)
    return match ? match[1] : ''
}

function lastSegment(resourceId?: string): string | null {
    const segment = resourceId?.split('/').filter(Boolean).pop()
    return segment ?? null
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

function requiredOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    const text = requiredString(value, field)
    if (!allowed.includes(text as T)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
    return text as T
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
    if (value === undefined || value === null || value === '') return undefined
    return requiredOneOf(value, allowed, field)
}

function optionalPort(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const port = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ValidationError('targetPort must be a whole number between 1 and 65535')
    }
    return port
}
