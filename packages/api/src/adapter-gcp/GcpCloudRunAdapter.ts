import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    CLOUD_RUN_NAME_MAX_LENGTH,
    CLOUD_RUN_NAME_PATTERN,
    gcpContainersSchema,
} from '../cloud-spi/containersSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-GCP emulator's Cloud Run service. The emulator mirrors the
 * public Cloud Run Admin v2 REST API — verified against `floci/floci-gcp` 0.5.0:
 *
 *   list   GET    /v2/projects/{p}/locations/{l}/services                  -> {services: [...]}
 *   get    GET    /v2/projects/{p}/locations/{l}/services/{id}             -> Service
 *   create POST   /v2/projects/{p}/locations/{l}/services?serviceId={id}   -> Operation
 *   delete DELETE /v2/projects/{p}/locations/{l}/services/{id}             -> Operation
 *
 * Notes from probing the emulator:
 *  - An empty project returns `{}`, not `{"services": []}`.
 *  - create really does start a container: a service with `nginx:alpine` produced
 *    a `floci-cloudrun-*` container running that image.
 *  - create is asynchronous. It returns an Operation whose `metadata` holds the
 *    Service, and the service is immediately listable as `CONDITION_PENDING`, so
 *    this adapter reads the service back rather than unpacking the envelope.
 *  - Readiness is real: a container that does not listen on $PORT settles at
 *    `CONDITION_FAILED` with "did not become ready before timeout". That state is
 *    surfaced, not hidden — it is the single most common deploy mistake.
 */
interface CloudRunContainer {
    image?: string
    ports?: Array<{containerPort?: number; name?: string}>
    resources?: {limits?: Record<string, string>}
}

interface CloudRunService {
    name?: string
    uid?: string
    generation?: string
    createTime?: string
    updateTime?: string
    template?: {containers?: CloudRunContainer[]; revision?: string; serviceAccount?: string}
    traffic?: Array<{type?: string; percent?: number; revision?: string}>
    urls?: string[]
    observedGeneration?: string
    terminalCondition?: {type?: string; state?: string; message?: string; lastTransitionTime?: string}
    labels?: Record<string, string>
}

interface CloudRunServiceList {
    services?: CloudRunService[]
    nextPageToken?: string
}

export class GcpCloudRunAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'containers' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpContainersSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const services: CloudRunService[] = []
        let pageToken: string | undefined

        do {
            const path = pageToken
                ? `${this.servicesPath()}?pageToken=${encodeURIComponent(pageToken)}`
                : this.servicesPath()
            const body = await this.client.json<CloudRunServiceList>(path)
            services.push(...(body?.services ?? []))
            pageToken = body?.nextPageToken
        } while (pageToken)

        return filterBySearch(services.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const service = await this.client.json<CloudRunService>(
            `${this.servicesPath()}/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return service ? toResource(service) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (name.length > CLOUD_RUN_NAME_MAX_LENGTH || !new RegExp(CLOUD_RUN_NAME_PATTERN).test(name)) {
            throw new ValidationError(
                'name must start with a letter and contain only lowercase letters, digits and hyphens',
            )
        }
        const image = requiredString(input.values.image, 'image')
        const port = optionalPort(input.values.port)

        const container: CloudRunContainer = {image, ...(port ? {ports: [{containerPort: port}]} : {})}

        await this.client.json(this.servicesPath(`?serviceId=${encodeURIComponent(name)}`), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({template: {containers: [container]}}),
        })

        // The Operation envelope carries the Service under `metadata`, but reading
        // it back is what the runtime actually holds — including the pending
        // readiness state a fresh deploy starts in.
        const created = await this.get(name)
        if (!created) throw new RuntimeError(`Cloud Run service ${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(
            `${this.servicesPath()}/${encodeURIComponent(id)}`,
            {method: 'DELETE'},
            {emptyOnNotFound: true},
        )
    }

    private servicesPath(suffix = ''): string {
        const project = encodeURIComponent(this.client.project)
        const location = encodeURIComponent(this.client.location)
        return `/v2/projects/${project}/locations/${location}/services${suffix}`
    }
}

function toResource(service: CloudRunService): CloudResource {
    const name = shortName(service.name ?? '')
    const container = service.template?.containers?.[0] ?? {}
    const condition = service.terminalCondition ?? {}

    return {
        id: name,
        name,
        cloud: 'gcp',
        service: 'containers',
        type: 'cloud-run-service',
        region: locationOf(service.name ?? ''),
        createdAt: service.createTime ?? service.updateTime ?? null,
        // CONDITION_SUCCEEDED / CONDITION_PENDING / CONDITION_FAILED — the prefix
        // is noise in a table cell, the value itself is the runtime's.
        status: readinessState(condition.state),
        metadata: {
            provider: 'gcp',
            containerService: 'cloud-run',
            resourceName: service.name,
            uid: service.uid,
            image: container.image,
            containerPort: container.ports?.[0]?.containerPort,
            resourceLimits: container.resources?.limits,
            urls: service.urls,
            uri: service.urls?.[0],
            traffic: service.traffic,
            generation: service.generation,
            observedGeneration: service.observedGeneration,
            /** Why the service is not ready, straight from the runtime. */
            terminalMessage: condition.message,
            serviceAccount: service.template?.serviceAccount,
            updateTime: service.updateTime,
            lastModified: service.updateTime,
            labels: service.labels,
        },
    }
}

/** `CONDITION_FAILED` -> `FAILED`; anything unexpected passes through unchanged. */
function readinessState(state: string | undefined): string | null {
    if (!state) return null
    return state.startsWith('CONDITION_') ? state.slice('CONDITION_'.length) : state
}

function shortName(resourceName: string): string {
    const match = resourceName.match(/services\/([^/]+)$/)
    return match ? match[1] : resourceName
}

function locationOf(resourceName: string): string | null {
    const match = resourceName.match(/locations\/([^/]+)/)
    return match ? match[1] : null
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function requiredString(value: unknown, field: string): string {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) throw new ValidationError(`${field} is required`)
    return raw
}

function optionalPort(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ValidationError('port must be an integer between 1 and 65535')
    }
    return port
}
