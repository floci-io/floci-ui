import type {CloudProvider} from './cloud'

export type ActivityStatus = 'success' | 'failed'

/**
 * One recorded mutation of the console API. Mirrors the API's ActivityEntry;
 * see packages/api/src/service/activityLog.ts for how it is captured.
 */
export interface ActivityEntry {
    id: string
    timestamp: string
    cloud: CloudProvider | null
    service: string | null
    operation: string
    resourceType: string | null
    resourceName: string | null
    status: ActivityStatus
    source: string
    httpMethod: string
    path: string
    statusCode: number
    detail: string | null
}

/** Distinct values each filter offers, already narrowed by the other filters. */
export interface ActivityFacets {
    clouds: string[]
    services: string[]
    operations: string[]
    statuses: string[]
    resourceTypes: string[]
}

export interface ActivityPage {
    items: ActivityEntry[]
    nextCursor: string | null
    facets: ActivityFacets
}

/** Query params of `GET /api/activity`. Empty strings mean "no filter". */
export interface ActivityQuery {
    cloud?: string
    service?: string
    operation?: string
    status?: ActivityStatus
    resourceType?: string
    search?: string
    from?: string
    to?: string
    cursor?: string
    limit?: number
}
