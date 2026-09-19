import {Fragment, useEffect, useState} from 'react'
import {ChevronDown, ChevronRight, History, Play, RefreshCw} from 'lucide-react'
import {useQueries} from '@tanstack/react-query'
import {listChildCollections, listCollectionItems} from '@/api/cloudProxyClient'
import {EmptyState} from '@/components/EmptyState'
import {formatDateTime} from '@/lib/format'
import {expandJsonStrings, formatDuration, summarizeDetails} from '@/lib/workflowHistory'
import {timeAgo} from '@/lib/utils'
import type {CloudProvider} from '@/types/cloud'
import type {ChildCollection, ChildItem, CloudResource} from '@/types/resource'

interface WorkflowExecutionsPanelProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

/**
 * State machines are the generic resource list (rendered above by
 * DynamicResourceView / ResourceTable). This panel is the execution history
 * viewer beneath a selected machine: executions (a child collection) and the
 * history events of one execution (the leaf item), both served by the generic
 * child-collections SPI that AwsStepFunctionsAdapter implements.
 *
 * Paging follows LogsExplorerPanel: one query per loaded cursor page via
 * useQueries, and Refresh resets the cursor chain to a single page before
 * refetching so a fresh first page is never combined with stale trailing pages.
 */
export function WorkflowExecutionsPanel({cloud, resource, runtimeReachable}: WorkflowExecutionsPanelProps) {
    const machineId = resource?.id
    const [selectedExecutionId, setSelectedExecutionId] = useState<string | undefined>()
    const [executionCursors, setExecutionCursors] = useState<Array<string | undefined>>([undefined])
    const [eventCursors, setEventCursors] = useState<Array<string | undefined>>([undefined])
    const [expandedEventId, setExpandedEventId] = useState<string | undefined>()

    useEffect(() => {
        setSelectedExecutionId(undefined)
        setExecutionCursors([undefined])
        setEventCursors([undefined])
        setExpandedEventId(undefined)
    }, [cloud, machineId])

    useEffect(() => {
        setEventCursors([undefined])
        setExpandedEventId(undefined)
    }, [selectedExecutionId])

    const executionPages = useQueries({
        queries: executionCursors.map((cursor) => ({
            queryKey: ['workflow-executions', cloud, machineId, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) =>
                listChildCollections(cloud, 'workflows', machineId ?? '', cursor, signal),
            enabled: Boolean(machineId) && runtimeReachable,
        })),
    })
    const firstExecutionPage = executionPages[0]
    const lastExecutionPage = executionPages[executionPages.length - 1]
    const executions = executionPages.flatMap((page) => page.data?.items ?? [])
    const nextExecutionCursor = lastExecutionPage?.data?.nextCursor ?? null
    const loadingMoreExecutions = executionPages.length > 1 && lastExecutionPage?.isLoading

    const eventPages = useQueries({
        queries: eventCursors.map((cursor) => ({
            queryKey: ['workflow-execution-history', cloud, machineId, selectedExecutionId, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) =>
                listCollectionItems(cloud, 'workflows', machineId ?? '', selectedExecutionId ?? '', cursor, signal),
            enabled: Boolean(machineId && selectedExecutionId) && runtimeReachable,
        })),
    })
    const firstEventPage = eventPages[0]
    const lastEventPage = eventPages[eventPages.length - 1]
    const events = eventPages.flatMap((page) => page.data?.items ?? [])
    const nextEventCursor = lastEventPage?.data?.nextCursor ?? null
    const loadingMoreEvents = eventPages.length > 1 && lastEventPage?.isLoading

    const selectedExecution = executions.find((execution) => execution.id === selectedExecutionId)

    function refreshExecutions() {
        setExecutionCursors([undefined])
        void firstExecutionPage?.refetch()
    }

    function refreshEvents() {
        setEventCursors([undefined])
        setExpandedEventId(undefined)
        void firstEventPage?.refetch()
    }

    if (!machineId) {
        return (
            <section className="cosmos-panel">
                <div className="empty compact">
                    <h3>Select a state machine</h3>
                    <p>Executions and their history are loaded after a state machine is selected.</p>
                </div>
            </section>
        )
    }

    return (
        <section className="cosmos-panel">
            <div className="cosmos-column">
                <div className="cosmos-panel-header">
                    <Play size={15}/>
                    <span>
                        <small>Executions</small>
                        <strong>{resource?.name ?? machineId}</strong>
                        <em>{executions.length} executions loaded</em>
                    </span>
                </div>
                <div className="cosmos-toolbar">
                    <button
                        className="button"
                        type="button"
                        disabled={!runtimeReachable || firstExecutionPage?.isFetching}
                        onClick={refreshExecutions}
                    >
                        <RefreshCw size={14}/>
                        Refresh
                    </button>
                </div>
                {firstExecutionPage?.error instanceof Error && (
                    <div className="form-error">{firstExecutionPage.error.message}</div>
                )}
                <div className="cosmos-list">
                    {firstExecutionPage?.isLoading && <div className="muted padded">Loading executions</div>}
                    {!firstExecutionPage?.isLoading && executions.length === 0 && (
                        <EmptyState
                            icon={Play}
                            title="No executions"
                            description="Executions started on this state machine will appear here."
                        />
                    )}
                    {executions.map((execution) => (
                        <button
                            key={execution.id}
                            className={`cosmos-list-row ${selectedExecutionId === execution.id ? 'selected' : ''}`}
                            type="button"
                            onClick={() => setSelectedExecutionId(execution.id)}
                        >
                            <span>
                                <strong>{execution.name}</strong>
                                <small>
                                    Started {timeAgo(stringMetadata(execution, 'startedAt'))}
                                    {' · '}
                                    {formatDuration(numberMetadata(execution, 'durationMs'))}
                                </small>
                            </span>
                            <ExecutionStatusBadge status={stringMetadata(execution, 'status')}/>
                            <ChevronRight size={13}/>
                        </button>
                    ))}
                    {nextExecutionCursor && (
                        <div style={{display: 'flex', justifyContent: 'center', padding: '12px 0'}}>
                            <button
                                className="button"
                                type="button"
                                disabled={Boolean(loadingMoreExecutions)}
                                onClick={() => setExecutionCursors((prev) => [...prev, nextExecutionCursor])}
                            >
                                {loadingMoreExecutions ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="cosmos-column cosmos-column--wide">
                <div className="cosmos-panel-header">
                    <History size={15}/>
                    <span>
                        <small>Execution history</small>
                        <strong>{selectedExecution?.name ?? selectedExecutionId ?? 'Select an execution'}</strong>
                        <em>{events.length} events loaded</em>
                    </span>
                </div>
                <div className="cosmos-toolbar">
                    <button
                        className="button"
                        type="button"
                        disabled={!runtimeReachable || !selectedExecutionId || firstEventPage?.isFetching}
                        onClick={refreshEvents}
                    >
                        <RefreshCw size={14}/>
                        Refresh
                    </button>
                </div>
                {firstEventPage?.error instanceof Error && <div className="form-error">{firstEventPage.error.message}</div>}
                <div className="cosmos-items-table">
                    {!selectedExecutionId && (
                        <div className="empty compact">
                            <h3>Select an execution</h3>
                            <p>History events are scoped to one execution.</p>
                        </div>
                    )}
                    {selectedExecutionId && !firstEventPage?.isLoading && events.length === 0 && (
                        <EmptyState
                            icon={History}
                            title="No history events"
                            description="Events recorded for this execution will appear here."
                        />
                    )}
                    {selectedExecutionId && (firstEventPage?.isLoading ? (
                        <div className="muted padded">Loading execution history</div>
                    ) : events.length > 0 && (
                        <>
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th style={{width: 32}}/>
                                        <th>#</th>
                                        <th>Timestamp</th>
                                        <th>Type</th>
                                        <th>Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {events.map((event) => {
                                        const expanded = expandedEventId === event.id
                                        return (
                                            <Fragment key={event.id}>
                                                <tr
                                                    className={expanded ? 'selected' : undefined}
                                                    style={{cursor: 'pointer'}}
                                                    onClick={() => setExpandedEventId(expanded ? undefined : event.id)}
                                                >
                                                    <td>
                                                        <button
                                                            className="button compact"
                                                            type="button"
                                                            aria-expanded={expanded}
                                                            aria-label={expanded ? 'Collapse event details' : 'Expand event details'}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setExpandedEventId(expanded ? undefined : event.id)
                                                            }}
                                                        >
                                                            {expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                                                        </button>
                                                    </td>
                                                    <td className="mono" style={{color: '#8d9cad'}}>{event.id}</td>
                                                    <td className="mono" style={{color: '#8d9cad', whiteSpace: 'nowrap'}}>
                                                        {formatDateTime(event.timestamp) ?? '-'}
                                                    </td>
                                                    <td className="mono">{eventType(event)}</td>
                                                    <td className="mono">{summarizeDetails(eventDetails(event))}</td>
                                                </tr>
                                                {expanded && (
                                                    <tr className="selected">
                                                        <td colSpan={5}>
                                                            <pre className="mono" style={{margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>
                                                                {JSON.stringify(expandJsonStrings(eventDetails(event)), null, 2)}
                                                            </pre>
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        )
                                    })}
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

const STATUS_STYLES: Record<string, {background: string; color: string}> = {
    SUCCEEDED: {background: 'rgba(34,197,94,0.14)', color: '#4ade80'},
    RUNNING: {background: 'rgba(96,165,250,0.14)', color: '#60a5fa'},
    PENDING_REDRIVE: {background: 'rgba(250,204,21,0.14)', color: '#facc15'},
    FAILED: {background: 'rgba(248,113,113,0.14)', color: '#f87171'},
    TIMED_OUT: {background: 'rgba(248,113,113,0.14)', color: '#f87171'},
    ABORTED: {background: 'rgba(248,113,113,0.14)', color: '#f87171'},
}

const NEUTRAL_STATUS_STYLE = {background: 'rgba(107,114,128,0.14)', color: '#9ca3af'}

function ExecutionStatusBadge({status}: {status?: string}) {
    const label = status ?? 'UNKNOWN'
    // `.cosmos-list-row span` lays every span out as a grid; the badge is inline.
    return (
        <span className="badge" style={{display: 'inline-flex', ...(STATUS_STYLES[label] ?? NEUTRAL_STATUS_STYLE)}}>
            {label}
        </span>
    )
}

function stringMetadata(collection: ChildCollection, key: string): string | undefined {
    const value = collection.metadata[key]
    return typeof value === 'string' ? value : undefined
}

function numberMetadata(collection: ChildCollection, key: string): number | undefined {
    const value = collection.metadata[key]
    return typeof value === 'number' ? value : undefined
}

function eventType(event: ChildItem): string {
    return typeof event.body.type === 'string' ? event.body.type : '-'
}

function eventDetails(event: ChildItem): Record<string, unknown> {
    const details = event.body.details
    return typeof details === 'object' && details !== null && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : {}
}
