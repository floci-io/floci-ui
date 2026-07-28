import {ValidationError} from '../cloud-spi/errors'
import {gcpServerlessSchema} from '../cloud-spi/serverlessSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
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

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpServerlessSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.client.json<GcpFunctionList>(this.functionsPath())
        return filterBySearch((body?.functions ?? []).map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const fn = await this.client.json<GcpFunction>(
            `${this.functionsPath()}/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return fn ? toResource(fn) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const functionName = stringValue(input.values.functionName ?? input.values.name)
        const runtime = stringValue(input.values.runtime)
        const entryPoint = stringValue(input.values.entryPoint)
        const code = stringValue(input.values.code)

        if (!functionName) throw new ValidationError('functionName is required')
        if (!runtime) throw new ValidationError('runtime is required')
        if (!entryPoint) throw new ValidationError('entryPoint is required')

        const operation = await this.client.json<GcpOperation>(
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
        const fn = operation?.response ?? (operation as unknown as GcpFunction | null)
        return toResource(fn ?? {name: functionName})
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(`${this.functionsPath()}/${encodeURIComponent(id)}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    private functionsPath(): string {
        return `/v2/projects/${encodeURIComponent(this.client.project)}/locations/${encodeURIComponent(this.client.location)}/functions`
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
            // Shared key so the serverless schema can surface one column for all clouds.
            lastModified: fn.updateTime,
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

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
