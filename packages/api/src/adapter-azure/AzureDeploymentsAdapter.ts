import {azure, type AzureRuntimeClient} from '../azure'
import {NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {azureDeploymentsSchema} from '../cloud-spi/deploymentsSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

/**
 * Reads ARM template deployments from the Floci-AZ runtime (Microsoft.Resources,
 * api-version 2025-04-01), verified against `floci/floci-az` docs/services/deployments.md:
 *
 *   list        GET /subscriptions/{s}/resourceGroups                                  (to find the groups)
 *   list        GET /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.Resources/deployments
 *   get         GET (same path)/{name}
 *   operations  GET (same path)/{name}/operations
 *
 * Read only: create, cancel, validate and what-if are not advertised. Delete is left out as
 * well, since the runtime removes only the record and never the resources it created.
 * Ids are `{resourceGroup}/{name}`. Subscription scope deployments are not listed.
 */
const API_VERSION = '2025-04-01'
const RESOURCE_API_VERSION = '2021-04-01'

interface ArmList<T> {
    value?: T[]
}

interface ArmError {
    code?: string
    message?: string
    target?: string
    details?: ArmError[]
}

interface ArmTemplateValue {
    type?: string
    value?: unknown
}

interface ArmDeployment {
    id?: string
    name?: string
    properties?: {
        provisioningState?: string
        timestamp?: string
        duration?: string
        mode?: string
        correlationId?: string
        templateHash?: string
        parameters?: Record<string, ArmTemplateValue>
        outputs?: Record<string, ArmTemplateValue>
        outputResources?: Array<{id?: string}>
        providers?: Array<{namespace?: string}>
        error?: ArmError
    }
}

interface ArmOperation {
    operationId?: string
    properties?: {
        provisioningOperation?: string
        provisioningState?: string
        timestamp?: string
        statusCode?: string
        statusMessage?: {error?: ArmError} | string
        targetResource?: {id?: string; resourceType?: string; resourceName?: string}
    }
}

const SECURE_TYPES = new Set(['securestring', 'secureobject'])

export class AzureDeploymentsAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'iac' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureDeploymentsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const groups = await this.json<ArmList<{name?: string}>>(
            `/subscriptions/${subscription}/resourceGroups?api-version=${RESOURCE_API_VERSION}`,
        )
        const names = (groups?.value ?? []).map((group) => group.name).filter((name): name is string => Boolean(name))

        const perGroup = await Promise.all(
            names.map(async (group) => {
                const body = await this.json<ArmList<ArmDeployment>>(
                    `${this.deploymentsPath(subscription, group)}?api-version=${API_VERSION}`,
                    {},
                    {emptyOnNotFound: true},
                )
                return (body?.value ?? []).map((deployment) => toResource(deployment, group))
            }),
        )

        const resources = perGroup.flat()
        const search = query.search?.trim().toLowerCase()
        return search ? resources.filter((resource) => resource.name.toLowerCase().includes(search)) : resources
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const subscription = await this.subscription()
        const path = `${this.deploymentsPath(subscription, resourceGroup)}/${encodeURIComponent(name)}`

        const deployment = await this.json<ArmDeployment>(`${path}?api-version=${API_VERSION}`, {}, {emptyOnNotFound: true})
        if (!deployment) return null

        const operations = await this.json<ArmList<ArmOperation>>(
            `${path}/operations?api-version=${API_VERSION}`,
            {},
            {emptyOnNotFound: true},
        )
        return toResource(deployment, resourceGroup, (operations?.value ?? []).map(toOperation))
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Creating ARM deployments is not supported from the Cloud Explorer yet.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Deleting ARM deployment records is not supported from the Cloud Explorer.')
    }

    /** The runtime ignores the subscription id, but a real one keeps the emitted ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope deployment requests to')

        this.subscriptionId = id
        return id
    }

    private deploymentsPath(subscription: string, resourceGroup: string): string {
        return `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Resources/deployments`
    }

    private async json<T>(path: string, init: RequestInit = {}, options = {}): Promise<T | null> {
        const res = await this.client.fetch(path, {...init, headers: {accept: 'application/json', ...(init.headers ?? {})}}, options)
        if (!res || res.status === 204) return null

        const text = await res.text()
        if (!text) return null
        return JSON.parse(text) as T
    }
}

function toResource(deployment: ArmDeployment, resourceGroup: string, operations?: Array<Record<string, unknown>>): CloudResource {
    const properties = deployment.properties ?? {}
    const name = deployment.name ?? ''

    return {
        id: `${resourceGroup}/${name}`,
        name,
        cloud: 'azure',
        service: 'iac',
        type: 'deployment',
        region: null,
        createdAt: properties.timestamp ?? null,
        status: properties.provisioningState ?? null,
        metadata: {
            provider: 'azure',
            resourceId: deployment.id,
            resourceGroup,
            mode: properties.mode,
            duration: properties.duration,
            correlationId: properties.correlationId,
            templateHash: properties.templateHash,
            providers: (properties.providers ?? []).map((provider) => provider.namespace).filter(Boolean),
            parameters: toValues(properties.parameters),
            outputs: toValues(properties.outputs),
            outputResources: (properties.outputResources ?? []).map((resource) => resource.id).filter(Boolean),
            ...(properties.error ? {error: toError(properties.error)} : {}),
            ...(operations ? {operations} : {}),
        },
    }
}

/** A secure parameter or output keeps its name and type but never its value. */
function toValues(values: Record<string, ArmTemplateValue> | undefined): Array<Record<string, unknown>> {
    return Object.entries(values ?? {}).map(([name, entry]) => {
        const type = entry.type ?? ''
        return SECURE_TYPES.has(type.toLowerCase()) ? {name, type} : {name, type, value: entry.value}
    })
}

function toOperation(operation: ArmOperation): Record<string, unknown> {
    const properties = operation.properties ?? {}
    const message = typeof properties.statusMessage === 'string' ? properties.statusMessage : properties.statusMessage?.error?.message
    return {
        operationId: operation.operationId,
        operation: properties.provisioningOperation,
        state: properties.provisioningState,
        statusCode: properties.statusCode,
        resourceType: properties.targetResource?.resourceType,
        resourceName: properties.targetResource?.resourceName,
        timestamp: properties.timestamp,
        ...(message ? {message} : {}),
    }
}

function toError(error: ArmError): Record<string, unknown> {
    return {
        code: error.code,
        message: error.message,
        target: error.target,
        ...(error.details?.length ? {details: error.details.map(toError)} : {}),
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
