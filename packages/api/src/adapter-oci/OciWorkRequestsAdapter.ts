import {NotSupportedError} from '../cloud-spi/errors'
import {ociWorkRequestsSchema} from '../cloud-spi/workRequestsSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

/**
 * Work requests of the OCI services as one read-only `workrequests` category.
 *
 * Every OCI service serves its own `/workRequests`, and a work request is only
 * visible in the service that owns it, so a listing is one call per service.
 * Which services answer, and under which API version, is the table below; the
 * shape of a listing differs too (Identity, Object Storage and OKE answer a
 * bare array, the others wrap it in `{items}`).
 */

interface WorkRequestSource {
    service: string
    /** Path prefix: an API version, or empty for Object Storage's unversioned root. */
    base: string
}

const SOURCES: WorkRequestSource[] = [
    {service: 'Identity', base: '/20160918'},
    {service: 'Object Storage', base: ''},
    {service: 'Queue', base: '/20210201'},
    {service: 'Streaming', base: '/20180418'},
    {service: 'Functions', base: '/20260325'},
    {service: 'OKE', base: '/20180222'},
    {service: 'Database', base: '/20220915'},
]

interface OciWorkRequestResource {
    entityType?: string
    actionType?: string
    identifier?: string
    entityUri?: string
}

interface OciWorkRequestEntry {
    code?: string
    message?: string
    timestamp?: string
}

interface OciWorkRequest {
    id?: string
    operationType?: string
    status?: string
    compartmentId?: string
    resources?: OciWorkRequestResource[]
    errors?: OciWorkRequestEntry[]
    percentComplete?: number
    timeAccepted?: string
    timeStarted?: string
    timeFinished?: string
}

interface OciLogEntry {
    message?: string
    timestamp?: string
}

type Listing<T> = T[] | {items?: T[]}

export class OciWorkRequestsAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'workrequests' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociWorkRequestsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        // One failing service fails the whole list: a partial list would read as
        // "nothing else happened".
        const perService = await Promise.all(
            SOURCES.map(async (source) => (await this.listSource(source)).map((wr) => ({source, wr}))),
        )
        const rows = perService
            .flat()
            .filter(({wr}) => Boolean(wr.id))
            .sort((a, b) => (b.wr.timeAccepted ?? '').localeCompare(a.wr.timeAccepted ?? ''))
        return filterBySearch(rows.map(({source, wr}) => this.toResource(source, wr)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        // The owning service is not part of the id, so ask each one in turn.
        for (const source of SOURCES) {
            const path = `${source.base}/workRequests/${encodeURIComponent(id)}`
            const wr = await this.client.json<OciWorkRequest>(path, {method: 'GET'}, {emptyOnNotFound: true})
            if (!wr) continue
            const [errors, logs] = await Promise.all([
                this.entries<OciWorkRequestEntry>(`${path}/errors`),
                this.entries<OciLogEntry>(`${path}/logs`),
            ])
            return this.toResource(source, wr, errors.length ? errors : (wr.errors ?? []), logs)
        }
        return null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Work requests are created by the operations of other OCI services.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Work requests cannot be deleted.')
    }

    private async listSource(source: WorkRequestSource): Promise<OciWorkRequest[]> {
        const items: OciWorkRequest[] = []
        // Stops on a token seen before, so a runtime that repeats one cannot loop forever.
        const seen = new Set<string>()
        let page: string | null = null
        do {
            const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
            if (page) {
                qs.set('page', page)
                seen.add(page)
            }
            // A service the runtime does not serve is an empty source, not a failed list.
            const res = await this.client.fetch(`${source.base}/workRequests?${qs}`, {method: 'GET'}, {emptyOnNotFound: true})
            if (!res) break
            items.push(...unwrap((await res.json()) as Listing<OciWorkRequest>))
            page = res.headers.get('opc-next-page')
        } while (page && !seen.has(page))
        return items
    }

    /**
     * Errors and logs of one work request. The work request itself was just read,
     * so a 404 here means this service does not serve the endpoint (Floci-OCI
     * Identity does not), which is the same as having nothing to show.
     */
    private async entries<T>(path: string): Promise<T[]> {
        const res = await this.client.fetch(path, {method: 'GET'}, {emptyOnNotFound: true})
        if (!res) return []
        return unwrap((await res.json()) as Listing<T>)
    }

    private toResource(
        source: WorkRequestSource,
        wr: OciWorkRequest,
        errors?: OciWorkRequestEntry[],
        logs?: OciLogEntry[],
    ): CloudResource {
        return {
            id: wr.id ?? '',
            name: wr.operationType ?? wr.id ?? '',
            cloud: 'oci',
            service: 'workrequests',
            type: 'workRequest',
            region: this.client.region,
            createdAt: wr.timeAccepted ?? null,
            status: wr.status ?? null,
            metadata: {
                provider: 'oci',
                service: source.service,
                operationType: wr.operationType,
                compartmentId: wr.compartmentId,
                percentComplete: wr.percentComplete ?? null,
                timeAccepted: wr.timeAccepted,
                timeStarted: wr.timeStarted,
                timeFinished: wr.timeFinished,
                resources: wr.resources ?? [],
                ...(errors ? {errors, logs: logs ?? []} : {}),
            },
        }
    }
}

function unwrap<T>(body: Listing<T> | null): T[] {
    if (Array.isArray(body)) return body
    return body?.items ?? []
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        [resource.name, resource.id, resource.status, String(resource.metadata.service ?? '')].some((value) =>
            (value ?? '').toLowerCase().includes(normalized),
        ),
    )
}
