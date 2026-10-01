import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {ociMessagingSchema} from '../cloud-spi/messagingSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * OCI Queue (`/20210201/queues`) as `messaging` resources.
 *
 * Display names are not unique on OCI, so the resource id is the queue OCID.
 * Every control-plane mutation is work-request driven: `202`, an
 * `opc-work-request-id` header and no body.
 */

const API = '/20210201'

/** `Queue` from GetQueue, or the slimmer `QueueSummary` from ListQueues. */
interface OciQueue {
    id?: string
    displayName?: string
    compartmentId?: string
    timeCreated?: string
    timeUpdated?: string
    lifecycleState?: string
    lifecycleDetails?: string
    messagesEndpoint?: string
    retentionInSeconds?: number
    visibilityInSeconds?: number
    timeoutInSeconds?: number
    deadLetterQueueDeliveryCount?: number
    channelConsumptionLimit?: number
    freeformTags?: Record<string, string>
}

interface OciQueueStats {
    queue?: {visibleMessages?: number; inFlightMessages?: number; sizeInBytes?: number}
    dlq?: {visibleMessages?: number; inFlightMessages?: number; sizeInBytes?: number}
}

/** Work request states that mean the operation will never complete. */
const FAILED_STATES = new Set(['FAILED', 'CANCELED'])

interface OciWorkRequest {
    id?: string
    status?: string
    resources?: Array<{entityType?: string; actionType?: string; identifier?: string}>
}

interface OciCollection<T> {
    items?: T[]
}

export class OciQueueAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'messaging' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociMessagingSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const queues = (await this.listQueues()).filter((queue) => queue.lifecycleState !== 'DELETED')
        const matching = filterBySearch(queues, query.search)
        // A queue whose stats cannot be read is still a queue, so a failed
        // GetStats degrades to the bare row rather than failing the list.
        return Promise.all(
            matching.map(async (queue) => this.toResource(queue, await this.stats(queue).catch(() => null))),
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const queue = await this.client.json<OciQueue>(this.queuePath(id), {method: 'GET'}, {emptyOnNotFound: true})
        if (!queue) return null
        return this.toResource(queue, await this.stats(queue).catch(() => null))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const displayName = stringValue(input.values.displayName ?? input.values.queueName ?? input.values.name)
        if (!displayName) throw new ValidationError('displayName is required')
        if (displayName.length > 255) throw new ValidationError('displayName must be at most 255 characters.')

        // Bounds are OCI's own, so a bad value fails in the form rather than as a
        // 400 from the runtime.
        const body: Record<string, unknown> = {displayName, compartmentId: this.client.tenancyId}
        const visibility = wholeNumber(input.values.visibilityInSeconds, 'visibilityInSeconds', 0, 43_200)
        const retention = wholeNumber(input.values.retentionInSeconds, 'retentionInSeconds', 10, 604_800)
        const dlqCount = wholeNumber(input.values.deadLetterQueueDeliveryCount, 'deadLetterQueueDeliveryCount', 0, 20)
        if (visibility !== null) body.visibilityInSeconds = visibility
        if (retention !== null) body.retentionInSeconds = retention
        if (dlqCount !== null) body.deadLetterQueueDeliveryCount = dlqCount

        const res = await this.client.fetch(`${API}/queues`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(body),
        })

        // CreateQueue answers with only a work request; the queue OCID lives in
        // its resources. On real OCI the queue is still CREATING at this point.
        const workRequestId = res?.headers.get('opc-work-request-id') ?? null
        const workRequest = await this.workRequest(workRequestId)
        if (workRequest?.status && FAILED_STATES.has(workRequest.status)) {
            throw new RuntimeError(`OCI Queue did not create ${displayName}: work request ${workRequest.id ?? workRequestId} ${workRequest.status}`)
        }
        const queueId = workRequest?.resources?.find((resource) => resource.entityType === 'QUEUE')?.identifier
        // Inspect and delete address a queue by OCID, so a create without one is not reported as done.
        if (!queueId) {
            throw new RuntimeError(
                `OCI Queue accepted ${displayName} but did not report its OCID (work request ${workRequestId ?? 'missing'}); refresh the list to find it`,
            )
        }
        const created = await this.get(queueId).catch(() => null)
        if (created) return created
        return this.toResource(
            {id: queueId, displayName, compartmentId: this.client.tenancyId, lifecycleState: 'CREATING'},
            null,
            workRequest?.id,
        )
    }

    async delete(id: string): Promise<void> {
        const res = await this.client.fetch(this.queuePath(id), {method: 'DELETE'}, {emptyOnNotFound: true})
        if (!res) throw new NotFoundError(`Queue ${id} does not exist`)
    }

    async health(): Promise<void> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId, limit: '1'})
        await this.client.fetch(`${API}/queues?${qs}`)
    }

    /** ListQueues wraps its page in `{items:[...]}`, so `listAll` does not apply. */
    private async listQueues(): Promise<OciQueue[]> {
        const queues: OciQueue[] = []
        // Stops on a token seen before, so a runtime that repeats one cannot loop forever.
        const seen = new Set<string>()
        let page: string | null = null
        do {
            const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
            if (page) {
                qs.set('page', page)
                seen.add(page)
            }
            const res = await this.client.fetch(`${API}/queues?${qs}`)
            if (!res) break
            const body = (await res.json()) as OciCollection<OciQueue>
            queues.push(...(body.items ?? []))
            page = res.headers.get('opc-next-page')
        } while (page && !seen.has(page))
        return queues
    }

    /**
     * GetStats is a data-plane call. On OCI it goes to the queue's
     * `messagesEndpoint`; Floci-OCI points that back at itself, so the runtime
     * client's endpoint serves it.
     */
    private async stats(queue: OciQueue): Promise<OciQueueStats | null> {
        if (!queue.id || queue.lifecycleState !== 'ACTIVE') return null
        return this.client.json<OciQueueStats>(`${this.queuePath(queue.id)}/stats`, {method: 'GET'}, {emptyOnNotFound: true})
    }

    private async workRequest(id: string | null): Promise<OciWorkRequest | null> {
        if (!id) return null
        return this.client
            .json<OciWorkRequest>(`${API}/workRequests/${encodeURIComponent(id)}`, {method: 'GET'}, {emptyOnNotFound: true})
            .catch(() => null)
    }

    private queuePath(id: string): string {
        return `${API}/queues/${encodeURIComponent(id)}`
    }

    private toResource(queue: OciQueue, stats: OciQueueStats | null, workRequestId?: string): CloudResource {
        const name = queue.displayName ?? queue.id ?? ''
        return {
            id: queue.id ?? name,
            name,
            cloud: 'oci',
            service: 'messaging',
            type: 'queue',
            region: this.client.region,
            createdAt: queue.timeCreated ?? null,
            status: queue.lifecycleState ?? null,
            metadata: {
                provider: 'oci',
                messagingService: 'queue',
                ocid: queue.id,
                compartmentId: queue.compartmentId,
                messagesEndpoint: queue.messagesEndpoint,
                lifecycleDetails: queue.lifecycleDetails,
                approximateMessages: stats?.queue?.visibleMessages ?? null,
                messagesInFlight: stats?.queue?.inFlightMessages ?? null,
                sizeInBytes: stats?.queue?.sizeInBytes ?? null,
                deadLetterMessages: stats?.dlq?.visibleMessages ?? null,
                retentionInSeconds: queue.retentionInSeconds,
                visibilityInSeconds: queue.visibilityInSeconds,
                timeoutInSeconds: queue.timeoutInSeconds,
                deadLetterQueueDeliveryCount: queue.deadLetterQueueDeliveryCount,
                channelConsumptionLimit: queue.channelConsumptionLimit,
                timeUpdated: queue.timeUpdated,
                freeformTags: queue.freeformTags,
                workRequestId,
            },
        }
    }
}

function stringValue(value: unknown): string {
    if (typeof value === 'number') return String(value)
    return typeof value === 'string' ? value.trim() : ''
}

/** Returns null when the caller left an optional field blank. */
function wholeNumber(value: unknown, field: string, min: number, max: number): number | null {
    const raw = stringValue(value)
    if (!raw) return null
    if (!/^\d+$/.test(raw)) throw new ValidationError(`${field} must be a whole number between ${min} and ${max}.`)
    const parsed = Number(raw)
    if (parsed < min || parsed > max) throw new ValidationError(`${field} must be between ${min} and ${max}.`)
    return parsed
}

function filterBySearch(queues: OciQueue[], search?: string): OciQueue[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return queues
    return queues.filter((queue) => (queue.displayName ?? '').toLowerCase().includes(normalized))
}
