import {useEffect, useState} from 'react'
import {ChevronRight, RefreshCw, ScrollText} from 'lucide-react'
import {useQueries} from '@tanstack/react-query'
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
 *
 * Both streams and events use one query per loaded cursor page (via
 * useQueries) rather than useInfiniteQuery, following the precedent set for
 * events by the original implementation this panel ported from. Refresh
 * resets the cursor array to a single page and explicitly refetches it,
 * rather than only refetching the first query: with more than one page
 * loaded, refetching in place would otherwise combine a fresh first page
 * with stale trailing pages built from the old cursor chain.
 */
export function LogsExplorerPanel({cloud, resource, runtimeReachable}: LogsExplorerPanelProps) {
    const groupId = resource?.id
    const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>()
    const [streamCursors, setStreamCursors] = useState<Array<string | undefined>>([undefined])
    const [eventCursors, setEventCursors] = useState<Array<string | undefined>>([undefined])

    useEffect(() => {
        setSelectedStreamId(undefined)
        setStreamCursors([undefined])
        setEventCursors([undefined])
    }, [cloud, groupId])

    useEffect(() => {
        setEventCursors([undefined])
    }, [selectedStreamId])

    const streamPages = useQueries({
        queries: streamCursors.map((cursor) => ({
            queryKey: ['log-streams', cloud, groupId, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) => listChildCollections(cloud, 'logs', groupId ?? '', cursor, signal),
            enabled: Boolean(groupId) && runtimeReachable,
        })),
    })
    const firstStreamPage = streamPages[0]
    const lastStreamPage = streamPages[streamPages.length - 1]
    const streams = streamPages.flatMap((page) => page.data?.items ?? [])
    const nextStreamCursor = lastStreamPage?.data?.nextCursor ?? null
    const loadingMoreStreams = streamPages.length > 1 && lastStreamPage?.isLoading

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
    const nextEventCursor = lastEventPage?.data?.nextCursor ?? null
    const loadingMoreEvents = eventPages.length > 1 && lastEventPage?.isLoading

    function refreshStreams() {
        setStreamCursors([undefined])
        void firstStreamPage?.refetch()
    }

    function refreshEvents() {
        setEventCursors([undefined])
        void firstEventPage?.refetch()
    }

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
                    <button className="button" type="button" disabled={!runtimeReachable || firstStreamPage?.isFetching} onClick={refreshStreams}>
                        <RefreshCw size={14}/>
                        Refresh
                    </button>
                </div>
                {firstStreamPage?.error instanceof Error && <div className="form-error">{firstStreamPage.error.message}</div>}
                <div className="cosmos-list">
                    {firstStreamPage?.isLoading && <div className="muted padded">Loading log streams</div>}
                    {!firstStreamPage?.isLoading && streams.length === 0 && (
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
                    {nextStreamCursor && (
                        <div style={{display: 'flex', justifyContent: 'center', padding: '12px 0'}}>
                            <button
                                className="button"
                                type="button"
                                disabled={Boolean(loadingMoreStreams)}
                                onClick={() => setStreamCursors((prev) => [...prev, nextStreamCursor])}
                            >
                                {loadingMoreStreams ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}
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
                    <button className="button" type="button" disabled={!runtimeReachable || !selectedStreamId || firstEventPage?.isFetching} onClick={refreshEvents}>
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
                            {nextEventCursor && (
                                <div style={{display: 'flex', justifyContent: 'center', padding: '12px 0'}}>
                                    <button
                                        className="button"
                                        type="button"
                                        disabled={Boolean(loadingMoreEvents)}
                                        onClick={() => setEventCursors((prev) => [...prev, nextEventCursor])}
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
