import {gcpServerlessSchema} from '../cloud-spi/serverlessSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {gcpEndpoint, gcpProject} from '../gcp'

interface GcpFunctionRecord {
    name?: string
    id?: string
    description?: string
    status?: string
    state?: string
    region?: string
    location?: string
    runtime?: string
    entryPoint?: string
    updateTime?: string
    createTime?: string
    serviceConfig?: {
        uri?: string
        service?: string
        availableMemory?: string
        timeoutSeconds?: number
        environmentVariables?: Record<string, string>
    }
    buildConfig?: {
        runtime?: string
        entryPoint?: string
        source?: Record<string, unknown>
    }
    labels?: Record<string, string>
}

interface GcpFunctionListResponse {
    functions?: GcpFunctionRecord[]
    value?: GcpFunctionRecord[]
    resources?: GcpFunctionRecord[]
}

export class GcpServerlessAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'serverless' as const

    constructor(
        private readonly endpoint: string = gcpEndpoint(),
        private readonly project: string = gcpProject(),
    ) {}

    schema(): ServiceSchema {
        return gcpServerlessSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.gcpJson<GcpFunctionListResponse | GcpFunctionRecord[]>(
            `/projects/${encodeURIComponent(this.project)}/functions`,
            {method: 'GET'},
        )

        const records = Array.isArray(body)
            ? body
            : body?.functions ?? body?.value ?? body?.resources ?? []

        return filterBySearch(records.map(toFunctionResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const body = await this.gcpJson<GcpFunctionRecord | null>(
            `/projects/${encodeURIComponent(this.project)}/functions/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        return body ? toFunctionResource(body) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new Error('GCP Cloud Functions create is not supported yet')
    }

    async delete(_id: string): Promise<void> {
        throw new Error('GCP Cloud Functions delete is not supported yet')
    }

    private async gcpJson<T>(
        path: string,
        init: RequestInit,
        options?: {emptyOnNotFound?: boolean},
    ): Promise<T | null> {
        const res = await globalThis.fetch(`${this.endpoint}${path}`, {
            ...init,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                ...(init.headers ?? {}),
            },
        })

        if (options?.emptyOnNotFound && res.status === 404) return null
        if (!res.ok) throw new Error(`GCP Cloud Functions request failed: HTTP ${res.status}`)
        if (res.status === 204) return null

        return await res.json() as T
    }
}

function toFunctionResource(record: GcpFunctionRecord): CloudResource {
    const name = functionName(record)
    const runtime = stringValue(record.runtime)
        || stringValue(record.buildConfig?.runtime)
    const entryPoint = stringValue(record.entryPoint)
        || stringValue(record.buildConfig?.entryPoint)

    return {
        id: name,
        name,
        cloud: 'gcp',
        service: 'serverless',
        type: 'gcp-function',
        region: stringValue(record.region) || stringValue(record.location) || null,
        createdAt: stringValue(record.createTime) || stringValue(record.updateTime) || null,
        status: stringValue(record.status) || stringValue(record.state) || null,
        metadata: {
            provider: 'gcp',
            serverlessService: 'cloud-functions',
            description: record.description,
            runtime,
            entryPoint,
            updateTime: record.updateTime,
            createTime: record.createTime,
            serviceUri: record.serviceConfig?.uri,
            serviceName: record.serviceConfig?.service,
            availableMemory: record.serviceConfig?.availableMemory,
            timeoutSeconds: record.serviceConfig?.timeoutSeconds,
            environmentVariables: record.serviceConfig?.environmentVariables,
            labels: record.labels,
            buildConfig: record.buildConfig,
            serviceConfig: record.serviceConfig,
        },
    }
}

function functionName(record: GcpFunctionRecord): string {
    const raw = stringValue(record.name ?? record.id)
    return raw.split('/').pop() ?? raw
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}