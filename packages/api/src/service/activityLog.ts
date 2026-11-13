import {DEFAULT_PAGE_LIMIT, type CollectionPage} from '../cloud-spi/childCollections'
import {ValidationError} from '../cloud-spi/errors'
import type {CloudProvider} from '../cloud-spi/types'

export type ActivityStatus = 'success' | 'failed'

export interface ActivityEntry {
    id: string
    timestamp: string
    cloud: CloudProvider | null
    service: string | null
    /** What happened, in console words: Create, Delete, Start, Invoke, ... */
    operation: string
    resourceType: string | null
    resourceName: string | null
    status: ActivityStatus
    /** Who performed it: Floci UI, AWS CLI, Terraform/OpenTofu, API client. */
    source: string
    httpMethod: string
    path: string
    statusCode: number
    /** Raw failure text from the API response, when the operation failed. */
    detail: string | null
}

export interface ActivityFilter {
    cloud?: string
    service?: string
    operation?: string
    status?: ActivityStatus
    resourceType?: string
    search?: string
    /** Epoch milliseconds, inclusive. */
    from?: number
    to?: number
    cursor?: string
    limit?: number
}

export interface ActivityFacets {
    clouds: string[]
    services: string[]
    operations: string[]
    statuses: string[]
    resourceTypes: string[]
}

export interface ActivityPage extends CollectionPage<ActivityEntry> {
    /**
     * Distinct values each filter can offer, recomputed from the entries the
     * *other* filters already admit, so a select never offers a value that
     * would empty the list.
     */
    facets: ActivityFacets
}

/**
 * In-memory and bounded: the console is a local dev tool, so the feed is
 * best-effort visibility into the running session rather than a durable audit
 * trail. CloudTrail's delivered S3 objects remain the durable record; entries
 * age out oldest-first once the buffer is full.
 */
export const ACTIVITY_CAPACITY = 1000

export type ActivityDraft = Omit<ActivityEntry, 'id' | 'timestamp'> & {timestamp?: string}

export class ActivityLog {
    /** Newest first, so a query is a slice from the head and recording is a prepend. */
    private readonly entries: ActivityEntry[] = []
    private sequence = 0

    constructor(private readonly capacity: number = ACTIVITY_CAPACITY) {}

    record(draft: ActivityDraft): ActivityEntry {
        const entry: ActivityEntry = {
            ...draft,
            id: `activity-${++this.sequence}`,
            timestamp: draft.timestamp ?? new Date().toISOString(),
        }
        this.entries.unshift(entry)
        if (this.entries.length > this.capacity) this.entries.length = this.capacity
        return entry
    }

    query(filter: ActivityFilter = {}): ActivityPage {
        const facets = this.facets(filter)
        const matching = this.entries.filter((entry) => matches(entry, filter))
        const limit = filter.limit ?? DEFAULT_PAGE_LIMIT
        const start = filter.cursor ? this.startAfter(matching, filter.cursor) : 0
        const items = matching.slice(start, start + limit)
        const nextCursor = items.length > 0 && start + items.length < matching.length
            ? encodeCursor(items[items.length - 1])
            : null
        return {items, nextCursor, facets}
    }

    /**
     * Resume point after the entry a cursor names. The cursor's own entry is
     * normally still in the buffer; when it has aged out, resume at the first
     * entry at or before its timestamp (skipping it rather than repeating it,
     * so the same entry can never surface twice on one cursor chain).
     */
    private startAfter(entries: ActivityEntry[], cursor: string): number {
        const decoded = decodeCursor(cursor)
        const index = entries.findIndex((entry) => entry.id === decoded.id)
        if (index >= 0) return index + 1
        const older = entries.findIndex((entry) => entry.timestamp <= decoded.timestamp)
        return older < 0 ? entries.length : older + 1
    }

    private facets(filter: ActivityFilter): ActivityFacets {
        const distinct = (
            omitted: keyof ActivityFilter,
            value: (entry: ActivityEntry) => string | null,
        ): string[] => {
            const without: ActivityFilter = {...filter, [omitted]: undefined}
            const seen = new Set<string>()
            for (const entry of this.entries) {
                if (!matches(entry, without)) continue
                const candidate = value(entry)
                if (candidate) seen.add(candidate)
            }
            return [...seen].sort()
        }
        return {
            clouds: distinct('cloud', (entry) => entry.cloud),
            services: distinct('service', (entry) => entry.service),
            operations: distinct('operation', (entry) => entry.operation),
            statuses: distinct('status', (entry) => entry.status),
            resourceTypes: distinct('resourceType', (entry) => entry.resourceType),
        }
    }
}

/** The feed every request through the console API records into. */
export const activityLog = new ActivityLog()

function matches(entry: ActivityEntry, filter: ActivityFilter): boolean {
    if (filter.cloud && entry.cloud !== filter.cloud) return false
    if (filter.service && entry.service !== filter.service) return false
    if (filter.operation && entry.operation !== filter.operation) return false
    if (filter.status && entry.status !== filter.status) return false
    if (filter.resourceType && entry.resourceType !== filter.resourceType) return false

    if (filter.from !== undefined || filter.to !== undefined) {
        const at = Date.parse(entry.timestamp)
        if (Number.isNaN(at)) return false
        if (filter.from !== undefined && at < filter.from) return false
        if (filter.to !== undefined && at > filter.to) return false
    }

    if (filter.search) {
        const needle = filter.search.trim().toLowerCase()
        if (needle) {
            const haystack = [entry.resourceName, entry.service, entry.operation, entry.path]
                .filter((value): value is string => typeof value === 'string')
                .join(' ')
                .toLowerCase()
            if (!haystack.includes(needle)) return false
        }
    }
    return true
}

/** Opaque to clients: the shape may change and cursors never travel across queries. */
function encodeCursor(entry: ActivityEntry): string {
    return Buffer.from(JSON.stringify({t: entry.timestamp, i: entry.id})).toString('base64url')
}

function decodeCursor(cursor: string): {timestamp: string; id: string} {
    let parsed: unknown
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
        throw new ValidationError('cursor is not a valid activity cursor.')
    }
    if (!parsed || typeof parsed !== 'object') throw new ValidationError('cursor is not a valid activity cursor.')
    const {t, i} = parsed as {t?: unknown; i?: unknown}
    if (typeof t !== 'string' || typeof i !== 'string') throw new ValidationError('cursor is not a valid activity cursor.')
    return {timestamp: t, id: i}
}
