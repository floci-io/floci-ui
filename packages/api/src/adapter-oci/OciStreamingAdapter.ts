import {ValidationError} from '../cloud-spi/errors'
import {ociStreamingSchema} from '../cloud-spi/kinesisSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const API_VERSION = '/20180418'
const STREAMS_PATH = `${API_VERSION}/streams`

/** OCI's documented bounds for a stream's retention period. */
const MIN_RETENTION_HOURS = 24
const MAX_RETENTION_HOURS = 168
const MAX_NAME_LENGTH = 255

/** `StreamSummary` from ListStreams, or the fuller `Stream` from GetStream/CreateStream. */
interface OciStream {
    id?: string
    name?: string
    partitions?: number
    retentionInHours?: number
    compartmentId?: string
    streamPoolId?: string
    lifecycleState?: string
    lifecycleStateDetails?: string
    timeCreated?: string
    messagesEndpoint?: string
    freeformTags?: Record<string, string>
}

/** OCI Streaming through the provider-neutral Streams category. */
export class OciStreamingAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'streams' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociStreamingSchema()
    }

    /**
     * ListStreams returns `StreamSummary`, which omits `retentionInHours`; the
     * inspector's GetStream fills it in rather than fanning out a Get per row.
     */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const streams = await this.client.listAll<OciStream>(`${STREAMS_PATH}?${qs}`)
        return filterBySearch(
            streams.filter((stream) => stream.lifecycleState !== 'DELETED').map((stream) => this.toResource(stream)),
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const stream = await this.client.json<OciStream>(streamPath(id), {method: 'GET'}, {emptyOnNotFound: true})
        if (!stream || stream.lifecycleState === 'DELETED') return null
        return this.toResource(stream)
    }

    /**
     * CreateStream answers with the full `Stream` body and an
     * `opc-work-request-id`. Real OCI returns it `CREATING`; the body is used
     * as-is rather than polling the work request.
     */
    async create(input: CreateResourceInput): Promise<CloudResource> {
        const body: Record<string, unknown> = {
            name: streamName(input.values.name),
            partitions: positiveInteger(input.values.partitions, 'partitions', 1),
            compartmentId: this.client.tenancyId,
        }
        const retention = retentionInHours(input.values.retentionInHours)
        if (retention !== undefined) body.retentionInHours = retention

        const res = await this.client.fetch(STREAMS_PATH, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(body),
        })
        const stream = (await res?.json()) as OciStream | undefined
        const resource = this.toResource(stream ?? {name: body.name as string, lifecycleState: 'CREATING'})
        const workRequestId = res?.headers.get('opc-work-request-id')
        if (workRequestId) resource.metadata.workRequestId = workRequestId
        return resource
    }

    /** DeleteStream is asynchronous on OCI: 202 plus a work request id. */
    async delete(id: string): Promise<void> {
        await this.client.fetch(streamPath(id), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    async health(): Promise<void> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId, limit: '1'})
        await this.client.fetch(`${STREAMS_PATH}?${qs}`)
    }

    private toResource(stream: OciStream): CloudResource {
        const name = stream.name ?? ''
        return {
            id: stream.id ?? name,
            name,
            cloud: 'oci',
            service: 'streams',
            type: 'stream',
            region: this.client.region,
            createdAt: stream.timeCreated ?? null,
            status: stream.lifecycleState ?? null,
            metadata: {
                provider: 'oci',
                streamsService: 'streaming',
                ocid: stream.id,
                partitions: stream.partitions,
                retentionInHours: stream.retentionInHours,
                compartmentId: stream.compartmentId,
                streamPoolId: stream.streamPoolId,
                lifecycleStateDetails: stream.lifecycleStateDetails,
                messagesEndpoint: stream.messagesEndpoint,
                freeformTags: stream.freeformTags,
            },
        }
    }
}

function streamPath(id: string): string {
    return `${STREAMS_PATH}/${encodeURIComponent(id)}`
}

function streamName(value: unknown): string {
    const name = stringValue(value)
    if (!name) throw new ValidationError('name is required')
    if (name.length > MAX_NAME_LENGTH) {
        throw new ValidationError(`name must be at most ${MAX_NAME_LENGTH} characters`)
    }
    return name
}

function positiveInteger(value: unknown, field: string, defaultValue: number): number {
    if (value === undefined || value === null || value === '') return defaultValue
    const parsed = typeof value === 'number' ? value : Number(stringValue(value))
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ValidationError(`${field} must be a positive whole number`)
    }
    return parsed
}

function retentionInHours(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = typeof value === 'number' ? value : Number(stringValue(value))
    if (!Number.isSafeInteger(parsed) || parsed < MIN_RETENTION_HOURS || parsed > MAX_RETENTION_HOURS) {
        throw new ValidationError(
            `retentionInHours must be a whole number between ${MIN_RETENTION_HOURS} and ${MAX_RETENTION_HOURS}`,
        )
    }
    return parsed
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
