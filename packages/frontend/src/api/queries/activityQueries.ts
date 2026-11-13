import {keepPreviousData, useQueries, type QueryKey, type UseQueryOptions} from '@tanstack/react-query'
import {listActivity} from '@/api/cloudProxyClient'
import type {ActivityPage, ActivityQuery} from '@/types/activity'

/**
 * The feed polls, so a change made without touching the page still shows up.
 * Only the first page polls: older pages are history and re-fetching a cursor
 * chain on every tick would multiply requests for no new information.
 */
export const ACTIVITY_POLL_INTERVAL_MS = 5000

export const activityQueryKeys = {
    page: (filters: ActivityQuery, cursor?: string): QueryKey =>
        ['activity-feed', filters, cursor] as const,
}

interface ActivityPageOptions {
    filters: ActivityQuery
    cursor: string | undefined
    poll: boolean
}

function activityPageOptions({filters, cursor, poll}: ActivityPageOptions): UseQueryOptions<ActivityPage, Error, ActivityPage, QueryKey> {
    return {
        queryKey: activityQueryKeys.page(filters, cursor),
        queryFn: ({signal}) => listActivity({...filters, cursor}, signal),
        refetchInterval: poll ? ACTIVITY_POLL_INTERVAL_MS : false,
        // Filters change the key; keep the previous list on screen while the
        // next one loads rather than flashing empty.
        placeholderData: keepPreviousData,
    }
}

/** One query per cursor page, newest page first. */
export function useActivityPages(filters: ActivityQuery, cursors: Array<string | undefined>) {
    return useQueries({
        queries: cursors.map((cursor, index) =>
            activityPageOptions({filters, cursor, poll: index === 0})),
    })
}
