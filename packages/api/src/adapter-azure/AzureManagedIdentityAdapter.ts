import {azure, azureLocationIn, type AzureRuntimeClient} from '../azure'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {AZURE_IDENTITY_LOCATIONS, AZURE_IDENTITY_NAME_MESSAGE, AZURE_IDENTITY_NAME_PATTERN, azureIdentitySchema} from '../cloud-spi/iamSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for Microsoft.ManagedIdentity, verified
 * against `floci/floci-az` (msi api-version 2024-11-30):
 *
 *   list    GET    /subscriptions/{s}/providers/Microsoft.ManagedIdentity/userAssignedIdentities
 *   get     GET    /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{n}
 *   create  PUT    (same path as get)                       -> 201
 *   delete  DELETE (same path as get)                       -> 204 or 200
 *   credentials GET (identity path)/federatedIdentityCredentials
 *
 * Ids are `{resourceGroup}/{name}`: ARM cannot address an identity without its group.
 *
 * Tokens: the IMDS and App Service token endpoints, `identities/default` and its
 * `clientSecretUrl` are never called or copied, so nothing secret reaches list or inspect.
 */
const API_VERSION = '2024-11-30'
const RESOURCE_API_VERSION = '2021-04-01'

interface ArmList<T> {
    value?: T[]
}

interface ArmIdentity {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {tenantId?: string; principalId?: string; clientId?: string}
}

interface ArmFederatedCredential {
    name?: string
    properties?: {issuer?: string; subject?: string; audiences?: string[]}
}

export class AzureManagedIdentityAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'identity' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureIdentitySchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<ArmIdentity>>(
            `/subscriptions/${subscription}/providers/Microsoft.ManagedIdentity/userAssignedIdentities?api-version=${API_VERSION}`,
        )
        const resources = (body?.value ?? []).map((identity) => toResource(identity))
        const search = query.search?.trim().toLowerCase()
        return search ? resources.filter((resource) => resource.name.toLowerCase().includes(search)) : resources
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.identityPath(resourceGroup, name)
        const identity = await this.json<ArmIdentity>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        if (!identity) return null

        const credentials = await this.json<ArmList<ArmFederatedCredential>>(
            `${path}/federatedIdentityCredentials?api-version=${API_VERSION}`,
            {},
            {emptyOnNotFound: true},
        )
        return toResource(identity, (credentials?.value ?? []).map(toCredential))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(AZURE_IDENTITY_NAME_PATTERN).test(name)) {
            throw new ValidationError(`name is invalid. ${AZURE_IDENTITY_NAME_MESSAGE}`)
        }
        const location = optionalLocation(input.values.location) ?? azureLocationIn(AZURE_IDENTITY_LOCATIONS)
        const resourceGroup = await this.resolveResourceGroup(requiredString(input.values.resourceGroup, 'resourceGroup'))

        const path = await this.identityPath(resourceGroup, name)
        await this.json(`${path}?api-version=${API_VERSION}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({location}),
        })

        const created = await this.get(`${resourceGroup}/${name}`)
        if (!created) throw new RuntimeError(`${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        const {resourceGroup, name} = parseId(id)
        const path = await this.identityPath(resourceGroup, name)
        await this.client.fetch(`${path}?api-version=${API_VERSION}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    /** The runtime ignores the subscription id, but a real one keeps the emitted ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope Managed Identity requests to')

        this.subscriptionId = id
        return id
    }

    private async identityPath(resourceGroup: string, name: string): Promise<string> {
        const subscription = await this.subscription()
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${encodeURIComponent(name)}`
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

function toResource(identity: ArmIdentity, credentials?: Array<Record<string, unknown>>): CloudResource {
    const properties = identity.properties ?? {}
    const name = identity.name ?? ''
    const resourceGroup = resourceGroupOf(identity.id ?? '')

    return {
        id: `${resourceGroup}/${name}`,
        name,
        cloud: 'azure',
        service: 'identity',
        type: 'user-assigned-identity',
        region: identity.location ?? null,
        // ARM returns no creation time here, and inventing one would be fake data.
        createdAt: null,
        metadata: {
            provider: 'azure',
            resourceId: identity.id,
            resourceGroup,
            tenantId: properties.tenantId,
            principalId: properties.principalId,
            clientId: properties.clientId,
            ...(credentials ? {federatedCredentials: credentials} : {}),
            tags: identity.tags,
        },
    }
}

function toCredential(credential: ArmFederatedCredential): Record<string, unknown> {
    const properties = credential.properties ?? {}
    return {
        name: credential.name,
        issuer: properties.issuer,
        subject: properties.subject,
        audiences: properties.audiences ?? [],
    }
}

function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`id must be "resourceGroup/name", got "${id}"`)
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

function optionalLocation(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const text = requiredString(value, 'location')
    if (!(AZURE_IDENTITY_LOCATIONS as readonly string[]).includes(text)) {
        throw new ValidationError(`location must be one of: ${AZURE_IDENTITY_LOCATIONS.join(', ')}`)
    }
    return text
}
