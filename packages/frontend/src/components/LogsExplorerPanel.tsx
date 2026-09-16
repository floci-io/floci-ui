import {useEffect, useState} from 'react'
import {ChevronRight, RefreshCw, ScrollText} from 'lucide-react'
import {useQueries, useQuery} from '@tanstack/react-query'
import {listChildCollections, listCollectionItems} from '@/api/cloudProxyClient'
import {EmptyState} from '@/components/EmptyState'
import {formatBytes, formatDateTime} from '@/lib/format'
import {timeAgo} from '@/lib/utils'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource} from '@/types/resource'

interface LogsExplorerPanelProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

/**
 * Log groups are the generic resource list (rendered above by
 * DynamicResourceView / ResourceTable, like any other service). This panel is
 * the two-level drill-in beneath a selected group: streams (a child
 * collection) and events (the leaf item), both served by the generic
 * child-collections SPI that AwsLogsAdapter implements.
 */
export function LogsExplorerPanel({cloud, resource, runtimeReachable}: LogsExplorerPanelProps) {
    const groupId = resource?.id
    const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>()
    const [eventCursors, setEventCursors] = useState<Array<string | undefined>>([undefined])

    useEffect(() => {
        setSelectedStreamId(undefined)
        setEventCursors([undefined])
    }, [cloud, groupId])

    useEffect(() => {
        setEventCursors([undefined])
    }, [selectedStreamId])

    const streamsQuery = useQuery({
        queryKey: ['log-streams', cloud, groupId],
        queryFn: ({signal}) => listChildCollections(cloud, 'logs', groupId ?? '', undefined, signal),
        enabled: Boolean(groupId) && runtimeReachable,
    })

    const streams = streamsQuery.data?.items ?? []

    const eventPages = useQueries({
        queries: eventCursors.map((cursor) => ({
            queryKey: ['log-events', cloud, groupId, selectedStreamId, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) => listCollectionItems(cloud, 'logs', groupId ?? '', selectedStreamId ?? '', cursor, signal),
            enabled: Boolean(groupId && selectedStreamId) && runtimeReachable,
        })),
    })
    const firstEventPage = eventPages[0]
    const lastEventPage = eventPages[eventPages.length - 1]
    const events = eventPages.flatMap((page) => page.data?.items ?? [])
    const nextCursor = lastEventPage?.data?.nextCursor ?? null
    const loadingMoreEvents = eventPages.length > 1 && lastEventPage?.isLoading

    if (!groupId) {
        return (
            <section className="cosmos-panel">
                <div className="empty compact">
                    <h3>Select a log group</h3>
                    <p>Streams and events are loaded after a log group is selected.</p>
                </div>
            </section>
        )
    }

    return (
        <section className="cosmos-panel">
            <div className="cosmos-column">
                <div className="cosmos-panel-header">
                    <ScrollText size={15}/>
                    <span>
                        <small>Streams</small>
                        <strong>{groupId}</strong>
                        <em>{streams.length} log streams</em>
                    </span>
                </div>
                <div className="cosmos-toolbar">
                    <button className="button" type="button" disabled={streamsQuery.isFetching} onClick={() => streamsQuery.refetch()}>
                        <RefreshCw size={14}/>
                        Refresh
                    </button>
                </div>
                {streamsQuery.error instanceof Error && <div className="form-error">{streamsQuery.error.message}</div>}
                <div className="cosmos-list">
                    {streamsQuery.isLoading && <div className="muted padded">Loading log streams</div>}
                    {!streamsQuery.isLoading && streams.length === 0 && (
                        <EmptyState
                            icon={ScrollText}
                            title="No log streams"
                            description="Log streams created in this group will appear here."
                        />
                    )}
                    {streams.map((stream) => (
                        <button
                            key={stream.id}
                            className={`cosmos-list-row ${selectedStreamId === stream.id ? 'selected' : ''}`}
                            type="button"
                            onClick={() => setSelectedStreamId(stream.id)}
                        >
                            <span>
                                <strong>{stream.name}</strong>
                                <small>Last event {timeAgo(typeof stream.metadata.lastEventTimestamp === 'string' ? stream.metadata.lastEventTimestamp : undefined)}</small>
                            </span>
                            <em>{typeof stream.metadata.storedBytes === 'number' ? formatBytes(stream.metadata.storedBytes) : '-'}</em>
                            <ChevronRight size={13}/>
                        </button>
                    ))}
                </div>
            </div>

            <div className="cosmos-column cosmos-column--wide">
                <div className="cosmos-panel-header">
                    <ScrollText size={15}/>
                    <span>
                        <small>Events</small>
                        <strong>{selectedStreamId ?? 'Select a stream'}</strong>
                        <em>{events.length} events loaded</em>
                    </span>
                </div>
                <div className="cosmos-toolbar">
                    <button className="button" type="button" disabled={!selectedStreamId || firstEventPage?.isFetching} onClick={() => firstEventPage?.refetch()}>
                        <RefreshCw size={14}/>
                        Refresh
                    </button>
                </div>
                {firstEventPage?.error instanceof Error && <div className="form-error">{firstEventPage.error.message}</div>}
                <div className="cosmos-items-table">
                    {!selectedStreamId && (
                        <div className="empty compact"><h3>Select a stream</h3><p>Events are scoped to a log stream.</p></div>
                    )}
                    {selectedStreamId && !firstEventPage?.isLoading && events.length === 0 && (
                        <EmptyState
                            icon={ScrollText}
                            title="No log events"
                            description="Events written to this stream will appear here."
                        />
                    )}
                    {selectedStreamId && (firstEventPage?.isLoading ? (
                        <div className="muted padded">Loading log events</div>
                    ) : events.length > 0 && (
                        <>
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Timestamp</th>
                                        <th>Message</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {events.map((event) => (
                                        <tr key={event.id}>
                                            <td className="mono" style={{color: '#8d9cad', whiteSpace: 'nowrap'}}>
                                                {formatDateTime(event.timestamp) ?? '-'}
                                            </td>
                                            <td className="mono">{String(event.body.message ?? '')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {nextCursor && (
                                <div style={{display: 'flex', justifyContent: 'center', padding: '12px 0'}}>
                                    <button
                                        className="button"
                                        type="button"
                                        disabled={Boolean(loadingMoreEvents)}
                                        onClick={() => setEventCursors((prev) => [...prev, nextCursor])}
                                    >
                                        {loadingMoreEvents ? 'Loading…' : 'Load more'}
                                    </button>
                                </div>
                            )}
                        </>
                    ))}
                </div>
            </div>
        </section>
    )
}
