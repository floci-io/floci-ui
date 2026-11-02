import {Fragment, useEffect, useState} from 'react'
import {Icon, ChevronDown, ChevronRight, History, Play, RefreshCwSquared as RefreshCw} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {cn} from '@/lib/sodium/utils'
import {useQueries} from '@tanstack/react-query'
import {listChildCollections, listCollectionItems} from '@/api/cloudProxyClient'
import {formatDateTime} from '@/lib/format'
import {expandJsonStrings, formatDuration, isExpressExecution, summarizeDetails} from '@/lib/workflowHistory'
import {timeAgo} from '@/lib/utils'
import type {CloudProvider} from '@/types/cloud'
import type {ChildCollection, ChildItem, CloudResource} from '@/types/resource'
import {EmptyState} from '@/components/EmptyState'

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

    // Step Functions records no history for Express workflows, so the request
    // is never made; the column explains the gap instead.
    const selectedIsExpress = Boolean(selectedExecutionId && isExpressExecution(selectedExecutionId))

    const eventPages = useQueries({
        queries: eventCursors.map((cursor) => ({
            queryKey: ['workflow-execution-history', cloud, machineId, selectedExecutionId, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) =>
                listCollectionItems(cloud, 'workflows', machineId ?? '', selectedExecutionId ?? '', cursor, signal),
            enabled: Boolean(machineId && selectedExecutionId) && runtimeReachable && !selectedIsExpress,
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
                <EmptyState compact title="Select a state machine" description="Executions and their history are loaded after a state machine is selected."/>
            </section>
        )
    }

    return (
        <section className="cosmos-panel">
            <div className="cosmos-column">
                <div className="cosmos-panel-header">
                    <Icon icon={Play} />
                    <span>
                        <small>Executions</small>
                        <strong>{resource?.name ?? machineId}</strong>
                        <em>{executions.length} executions loaded</em>
                    </span>
                </div>
                <div className="cosmos-toolbar">
                    <Button variant="secondary"
                        type="button"
                        disabled={!runtimeReachable || firstExecutionPage?.isFetching}
                        onClick={refreshExecutions}
                    >
                        <Icon icon={RefreshCw} size={14}/>
                        Refresh
                    </Button>
                </div>
                <PageError pages={executionPages}/>
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
                        <Button variant="secondary"
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
                            <Icon icon={ChevronRight} size={14}/>
                        </Button>
                    ))}
                    {nextExecutionCursor && (
                        <div className="flex justify-center py-3 px-0">
                            <Button variant="secondary"
                                type="button"
                                disabled={Boolean(loadingMoreExecutions)}
                                onClick={() => setExecutionCursors((prev) => [...prev, nextExecutionCursor])}
                            >
                                {loadingMoreExecutions ? 'Loading…' : 'Load more'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <div className="cosmos-column cosmos-column--wide">
                <div className="cosmos-panel-header">
                    <Icon icon={History} />
                    <span>
                        <small>Execution history</small>
                        <strong>{selectedExecution?.name ?? selectedExecutionId ?? 'Select an execution'}</strong>
                        <em>{events.length} events loaded</em>
                    </span>
                </div>
                <div className="cosmos-toolbar">
                    <Button variant="secondary"
                        type="button"
                        disabled={!runtimeReachable || !selectedExecutionId || selectedIsExpress || firstEventPage?.isFetching}
                        onClick={refreshEvents}
                    >
                        <Icon icon={RefreshCw} size={14}/>
                        Refresh
                    </Button>
                </div>
                <PageError pages={eventPages}/>
                <div className="cosmos-items-table">
                    {!selectedExecutionId && (
                        <EmptyState compact title="Select an execution" description="History events are scoped to one execution."/>
                    )}
                    {selectedIsExpress && (
                        <EmptyState
                            icon={History}
                            title="No history for Express workflows"
                            description="Step Functions only records execution history for Standard workflows. Express executions log to CloudWatch Logs when the state machine has logging enabled."
                        />
                    )}
                    {selectedExecutionId && !selectedIsExpress && !firstEventPage?.isLoading && events.length === 0 && (
                        <EmptyState
                            icon={History}
                            title="No history events"
                            description="Events recorded for this execution will appear here."
                        />
                    )}
                    {selectedExecutionId && !selectedIsExpress && (firstEventPage?.isLoading ? (
                        <div className="muted padded">Loading execution history</div>
                    ) : events.length > 0 && (
                        <>
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th className="w-8"/>
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
                                                    className={cn(expanded ? 'selected' : undefined, 'cursor-pointer')}
                                                    onClick={() => setExpandedEventId(expanded ? undefined : event.id)}
                                                >
                                                    <td>
                                                        <Button variant="secondary" size="sm"
                                                            type="button"
                                                            aria-expanded={expanded}
                                                            aria-label={expanded ? 'Collapse event details' : 'Expand event details'}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setExpandedEventId(expanded ? undefined : event.id)
                                                            }}
                                                        >
                                                            {expanded ? <Icon icon={ChevronDown} size={14}/> : <Icon icon={ChevronRight} size={14}/>}
                                                        </Button>
                                                    </td>
                                                    <td className="mono text-text-3">{event.id}</td>
                                                    <td className="mono text-text-3 whitespace-nowrap">
                                                        {formatDateTime(event.timestamp) ?? '-'}
                                                    </td>
                                                    <td className="mono">{eventType(event)}</td>
                                                    <td className="mono">{summarizeDetails(eventDetails(event))}</td>
                                                </tr>
                                                {expanded && (
                                                    <tr className="selected">
                                                        <td colSpan={5}>
                                                            <pre className="mono m-0 whitespace-pre-wrap break-words">
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
                                <div className="flex justify-center py-3 px-0">
                                    <Button variant="secondary"
                                        type="button"
                                        disabled={Boolean(loadingMoreEvents)}
                                        onClick={() => setEventCursors((prev) => [...prev, nextEventCursor])}
                                    >
                                        {loadingMoreEvents ? 'Loading…' : 'Load more'}
                                    </Button>
                                </div>
                            )}
                        </>
                    ))}
                </div>
            </div>
        </section>
    )
}

interface PageState {
    error: unknown
    isFetching: boolean
    refetch: () => unknown
}

/**
 * Any loaded page can fail, not only the first. A failed continuation page has
 * no next cursor, so without this the "Load more" control would simply vanish
 * and the list would look complete. Retry refetches the page that failed.
 */
function PageError({pages}: {pages: PageState[]}) {
    const failed = pages.find((page) => page.error instanceof Error)
    if (!failed || !(failed.error instanceof Error)) return null
    return (
        <div className="form-error flex items-center gap-2" role="alert">
            <span className="flex-1">{failed.error.message}</span>
            <Button variant="secondary" size="sm" type="button" disabled={failed.isFetching} onClick={() => void failed.refetch()}>
                Retry
            </Button>
        </div>
    )
}

const STATUS_STYLES: Record<string, {background: string; color: string}> = {
    SUCCEEDED: {background: 'var(--status-ok-tint)', color: 'var(--status-ok)'},
    RUNNING: {background: 'var(--status-info-tint)', color: 'var(--status-info)'},
    PENDING_REDRIVE: {background: 'var(--status-warn-tint)', color: 'var(--status-warn)'},
    FAILED: {background: 'var(--status-error-tint)', color: 'var(--status-error)'},
    TIMED_OUT: {background: 'var(--status-error-tint)', color: 'var(--status-error)'},
    ABORTED: {background: 'var(--status-error-tint)', color: 'var(--status-error)'},
}

const NEUTRAL_STATUS_STYLE = {background: 'var(--status-neutral-tint)', color: 'var(--text-3)'}

function ExecutionStatusBadge({status}: {status?: string}) {
    const label = status ?? 'UNKNOWN'
    // `.cosmos-list-row span` lays every span out as a grid; the badge is inline.
    return (
        <span className="badge inline-flex" style={{...(STATUS_STYLES[label] ?? NEUTRAL_STATUS_STYLE)}}>
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
