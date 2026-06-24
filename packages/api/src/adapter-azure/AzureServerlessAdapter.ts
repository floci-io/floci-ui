import {azure, type AzureRuntimeClient} from '../azure'
import {azureServerlessSchema} from '../cloud-spi/serverlessSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServerlessInvokeResult,
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

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const functionName = stringValue(input.values.functionName ?? input.values.name)
        const runtime = stringValue(input.values.runtime) || 'node'
        const handler = stringValue(input.values.handler)
        const code = stringValue(input.values.code)
        const location = stringValue(input.values.location)
        const functionAppName = stringValue(input.values.functionAppName)

        if (!functionName) throw new Error('functionName is required')

        const body = await this.azureJson<AzureFunctionRecord>(
            '/functions',
            {
                method: 'POST',
                body: JSON.stringify({
                    name: functionName,
                    runtime,
                    handler: handler || undefined,
                    code: code || undefined,
                    location: location || undefined,
                    functionAppName: functionAppName || undefined,
                }),
            },
        )

        if (!body) throw new Error('Azure Functions create returned an empty response')
        return toFunctionResource(body)
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(
            `/functions/${encodeURIComponent(id)}`,
            {method: 'DELETE'},
            {emptyOnNotFound: true},
        )
    }
    async invoke(id: string, payload: string): Promise<ServerlessInvokeResult> {
        const startedAt = performance.now()

        const body = await this.azureJson<{
            statusCode?: number
            payload?: unknown
            body?: unknown
            error?: string
            functionError?: string
            logResult?: string
        }>(
            `/functions/${encodeURIComponent(id)}/invoke`,
            {
                method: 'POST',
                body: JSON.stringify({
                    payload: payload?.trim() ? payload : '{}',
                }),
            },
        )

        return {
            statusCode: body?.statusCode ?? 200,
            payload: stringifyPayload(body?.payload ?? body?.body ?? ''),
            functionError: body?.functionError ?? body?.error,
            logResult: body?.logResult,
            executionDuration: Math.round(performance.now() - startedAt),
        }
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

function stringifyPayload(value: unknown): string {
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return ''
    return JSON.stringify(value)
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}