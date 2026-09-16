import {azure, type AzureRuntimeClient} from '../azure'
import {ConflictError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {azureServiceBusSchema} from '../cloud-spi/servicebusSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CloudServiceDescriptorOverride,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

interface ServiceBusNamespaceRecord {
    name?: string
    amqpPort?: number
    amqpsPort?: number
    tlsCertPem?: string
    mocked?: boolean
}

interface ServiceBusNamespaceListResponse {
    namespaces?: ServiceBusNamespaceRecord[]
}

export class AzureServiceBusAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'messaging' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureServiceBusSchema()
    }

    // The catalog category is the cloud-neutral 'Messaging'; on Azure it is Service Bus.
    descriptorOverride(): CloudServiceDescriptorOverride {
        return {displayName: 'Service Bus'}
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.azureJson<ServiceBusNamespaceListResponse>(
            namespacePath(this.client),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        const resources = (body?.namespaces ?? [])
            .map(toNamespaceResource)
            .filter((resource): resource is CloudResource => resource !== null)
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const body = await this.azureJson<ServiceBusNamespaceRecord>(
            namespaceResourcePath(this.client, id),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        return body ? toNamespaceResource(body) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const namespaceName = stringValue(input.values.namespaceName)
        if (!namespaceName) throw new ValidationError('namespaceName is required')
        if (!isValidNamespaceName(namespaceName)) {
            throw new ValidationError('Use a valid Service Bus namespace: 6-50 letters, numbers, or hyphens; start with a letter, end with a letter or number, and do not end with -sb or -mgmt.')
        }

        // The runtime treats PUT as idempotent and answers 200 for a namespace that already
        // exists, so a duplicate would otherwise be reported to the user as a fresh create.
        if (await this.get(namespaceName)) {
            throw new ConflictError(`Service Bus namespace ${namespaceName} already exists`)
        }

        const body = await this.azureJson<ServiceBusNamespaceRecord>(
            namespaceResourcePath(this.client, namespaceName),
            {method: 'PUT', body: '{}'},
        )
        if (!body) throw new RuntimeError('Azure Service Bus create returned an empty response')
        const resource = toNamespaceResource(body)
        if (!resource) throw new RuntimeError('Azure Service Bus create returned a namespace without a name')
        return resource
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(namespaceResourcePath(this.client, id), {method: 'DELETE'})
    }

    private async azureJson<T>(
        path: string,
        init: RequestInit,
        options?: {emptyOnNotFound?: boolean},
    ): Promise<T | null> {
        const res = await this.client.fetch(
            path,
            {
                ...init,
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    ...(init.headers ?? {}),
                },
            },
            options,
        )

        if (!res || res.status === 204) return null
        return await res.json() as T
    }
}

function namespacePath(client: AzureRuntimeClient): string {
    return `/${encodeURIComponent(client.accountName)}-servicebus/namespaces`
}

function namespaceResourcePath(client: AzureRuntimeClient, namespaceName: string): string {
    return `${namespacePath(client)}/${encodeURIComponent(namespaceName)}`
}

function toNamespaceResource(record: ServiceBusNamespaceRecord): CloudResource | null {
    const name = stringValue(record.name)
    if (!name) return null

    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'messaging',
        type: 'servicebus-namespace',
        region: null,
        createdAt: null,
        status: record.mocked ? 'Mocked' : 'Running',
        metadata: {
            provider: 'azure',
            messagingService: 'service-bus',
            amqpPort: record.amqpPort,
            amqpsPort: record.amqpsPort,
            mocked: record.mocked,
            tlsEnabled: Boolean(record.tlsCertPem),
        },
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isValidNamespaceName(value: string): boolean {
    return /^[A-Za-z][A-Za-z0-9-]{4,48}[A-Za-z0-9]$/.test(value)
        && !value.toLowerCase().endsWith('-sb')
        && !value.toLowerCase().endsWith('-mgmt')
}
