import {azure, type AzureRuntimeClient} from '../azure'
import {azureServerlessSchema} from '../cloud-spi/serverlessSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

interface AzureFunctionRecord {
    id?: string
    name?: string
    kind?: string
    location?: string
    type?: string
    properties?: {
        state?: string
        status?: string
        runtime?: string
        functionAppName?: string
        lastModifiedTimeUtc?: string
        scriptHref?: string
        invokeUrlTemplate?: string
        config?: Record<string, unknown>
        files?: Record<string, string>
    }
}

interface AzureFunctionListResponse {
    value?: AzureFunctionRecord[]
}

export class AzureServerlessAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'serverless' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureServerlessSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.azureJson<AzureFunctionListResponse | AzureFunctionRecord[]>(
            '/functions',
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        const records = Array.isArray(body) ? body : body?.value ?? []
        return filterBySearch(records.map(toFunctionResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const body = await this.azureJson<AzureFunctionRecord>(
            `/functions/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        return body ? toFunctionResource(body) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new Error('Azure Functions create is not implemented yet')
    }

    async delete(_id: string): Promise<void> {
        throw new Error('Azure Functions delete is not implemented yet')
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

function toFunctionResource(record: AzureFunctionRecord): CloudResource {
    const name = stringValue(record.name ?? record.id)
    const props = record.properties ?? {}

    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'serverless',
        type: 'azure-function',
        region: record.location ?? null,
        createdAt: props.lastModifiedTimeUtc ?? null,
        status: props.state ?? props.status ?? null,
        metadata: {
            provider: 'azure',
            serverlessService: 'functions',
            kind: record.kind,
            resourceType: record.type,
            runtime: props.runtime,
            functionAppName: props.functionAppName,
            scriptHref: props.scriptHref,
            invokeUrlTemplate: props.invokeUrlTemplate,
            config: props.config,
            files: props.files,
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