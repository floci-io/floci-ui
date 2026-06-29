import {gcpServerlessSchema} from '../cloud-spi/serverlessSchema'
import {gcpEndpoint, gcpLocation, gcpProject} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServerlessInvokeResult,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-GCP emulator's Cloud Functions service. The emulator
 * mirrors the public Cloud Functions Gen2 (v2) REST API — verified against
 * `floci/floci-gcp`:
 *
 *   list   GET    /v2/projects/{project}/locations/{location}/functions      -> {functions: [...]}
 *   get    GET    /v2/projects/{project}/locations/{location}/functions/{id} -> Function
 *   create POST   /v2/projects/{project}/locations/{location}/functions?functionId={id} -> Operation
 *   delete DELETE /v2/projects/{project}/locations/{location}/functions/{id} -> Operation
 *
 * Notes from probing the emulator:
 *  - The `locations/-` wildcard is NOT supported (returns `{}`), so list is
 *    scoped to the configured location (FLOCI_GCP_LOCATION, default us-central1).
 *  - create/delete return a long-running Operation envelope with `done: true`;
 *    the function resource lives under `operation.response`.
 *  - A function's resource `name` is the fully-qualified path
 *    `projects/{project}/locations/{location}/functions/{shortName}`; we expose
 *    the short name as the resource id.
 *  - Gen2 nests runtime/entryPoint under `buildConfig` and the trigger/uri under
 *    `serviceConfig`; the deploy state is `state` (not `status`).
 */
interface GcpFunction {
    name?: string
    state?: string
    environment?: string
    url?: string
    createTime?: string
    updateTime?: string
    labels?: Record<string, string>
    buildConfig?: {
        runtime?: string
        entryPoint?: string
        source?: Record<string, unknown>
    }
    serviceConfig?: {
        uri?: string
        availableMemory?: string
        timeoutSeconds?: number
        service?: string
        revision?: string
        allTrafficOnLatestRevision?: boolean
    }
}

interface GcpFunctionList {
    functions?: GcpFunction[]
    nextPageToken?: string
}

interface GcpOperation {
    done?: boolean
    response?: GcpFunction
}

export class GcpCloudFunctionsAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'serverless' as const

    constructor(
        private readonly endpoint: string = gcpEndpoint(),
        private readonly project: string = gcpProject(),
        private readonly location: string = gcpLocation(),
    ) {}

    schema(): ServiceSchema {
        return gcpServerlessSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.fetchJson<GcpFunctionList>(this.functionsPath())
        return filterBySearch((body.functions ?? []).map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const res = await this.fetch(`${this.functionsPath()}/${encodeURIComponent(id)}`, {method: 'GET'}, true)
        if (res.status === 404) return null
        return toResource(await res.json() as GcpFunction)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const functionName = stringValue(input.values.functionName ?? input.values.name)
        const runtime = stringValue(input.values.runtime)
        const entryPoint = stringValue(input.values.entryPoint)
        const code = stringValue(input.values.code)

        if (!functionName) throw new Error('functionName is required')
        if (!runtime) throw new Error('runtime is required')
        if (!entryPoint) throw new Error('entryPoint is required')

        const operation = await this.fetchJson<GcpOperation>(
            `${this.functionsPath()}?functionId=${encodeURIComponent(functionName)}`,
            {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({
                    buildConfig: {
                        runtime,
                        entryPoint,
                        ...(code ? {source: {inlineCode: code}} : {}),
                    },
                }),
            },
        )

        // create returns an Operation envelope; the function is under `response`.
        const fn = operation.response ?? (operation as unknown as GcpFunction)
        return toResource(fn)
    }

    async delete(id: string): Promise<void> {
        await this.fetch(`${this.functionsPath()}/${encodeURIComponent(id)}`, {method: 'DELETE'}, true)
    }

    async invoke(id: string, payload: string): Promise<ServerlessInvokeResult> {
        const startedAt = performance.now()

        const body = await this.fetchJson<{
            statusCode?: number
            payload?: unknown
            body?: unknown
            result?: unknown
            error?: string
            functionError?: string
            logResult?: string
        }>(
            `${this.functionsPath()}/${encodeURIComponent(id)}:call`,
            {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({
                    data: payload?.trim() ? payload : '{}',
                }),
            },
        )

        return {
            statusCode: body.statusCode ?? 200,
            payload: stringifyPayload(body.payload ?? body.body ?? body.result ?? ''),
            functionError: body.functionError ?? body.error,
            logResult: body.logResult,
            executionDuration: Math.round(performance.now() - startedAt),
        }
    }

    private functionsPath(): string {
        return `/v2/projects/${encodeURIComponent(this.project)}/locations/${encodeURIComponent(this.location)}/functions`
    }

    private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
        const res = await this.fetch(path, init)
        return res.json() as Promise<T>
    }

    private async fetch(path: string, init: RequestInit, emptyOnNotFound = false): Promise<Response> {
        let res: Response
        try {
            res = await globalThis.fetch(`${this.endpoint}${path}`, init)
        } catch (error) {
            throw new Error(`Cannot reach Floci-GCP at ${this.endpoint}: ${errorMessage(error)}`)
        }
        if (emptyOnNotFound && res.status === 404) return res
        if (!res.ok) {
            throw new Error(`GCP Cloud Functions request failed: HTTP ${res.status}`)
        }
        return res
    }
}

function toResource(fn: GcpFunction): CloudResource {
    const name = shortName(fn.name ?? '')
    const build = fn.buildConfig ?? {}
    const serviceConfig = fn.serviceConfig ?? {}
    return {
        id: name,
        name,
        cloud: 'gcp',
        service: 'serverless',
        type: 'gcp-function',
        region: locationOf(fn.name ?? ''),
        createdAt: fn.createTime ?? fn.updateTime ?? null,
        status: fn.state ?? null,
        metadata: {
            provider: 'gcp',
            serverlessService: 'cloud-functions',
            resourceName: fn.name,
            environment: fn.environment,
            runtime: build.runtime,
            entryPoint: build.entryPoint,
            availableMemory: serviceConfig.availableMemory,
            timeoutSeconds: serviceConfig.timeoutSeconds,
            uri: serviceConfig.uri ?? fn.url,
            service: serviceConfig.service,
            revision: serviceConfig.revision,
            allTrafficOnLatestRevision: serviceConfig.allTrafficOnLatestRevision,
            updateTime: fn.updateTime,
            labels: fn.labels,
        },
    }
}

function shortName(resourceName: string): string {
    const match = resourceName.match(/functions\/([^/]+)$/)
    return match ? match[1] : resourceName
}

function locationOf(resourceName: string): string | null {
    const match = resourceName.match(/locations\/([^/]+)/)
    return match ? match[1] : null
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
