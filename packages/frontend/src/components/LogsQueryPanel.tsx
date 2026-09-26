import {useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react'
import {Maximize2, Minimize2, Play, Terminal} from 'lucide-react'
import {useMutation} from '@tanstack/react-query'
import {queryLogs, queryLogsAcrossGroups} from '@/api/cloudProxyClient'
import {ExpandablePanel} from '@/components/ExpandablePanel'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource, LogsInsightsQueryResult} from '@/types/resource'

const DEFAULT_QUERY = 'fields @timestamp, @message\n| sort @timestamp desc\n| limit 20'
const MAX_QUERY_LOG_GROUPS = 50

const RANGE_OPTIONS = [
    {label: '15m', minutes: 15},
    {label: '1h', minutes: 60},
    {label: '6h', minutes: 360},
    {label: '24h', minutes: 1440},
]

interface LogsQueryPanelProps {
    cloud: CloudProvider
    runtimeReachable: boolean
    /** Single-log-group mode — the per-row panel in ResourceInspector. */
    logGroupName?: string
    /** Cross-log-group mode — the Logs Insights tab, scoped by name prefix + multi-select over this list. */
    allLogGroups?: CloudResource[]
}

/**
 * Lives inside ResourceInspector next to a selected log group's metadata
 * (single-group mode), and as the Logs Insights tab on the CloudWatch Logs
 * explorer page (cross-group mode) — one component so both modes share the
 * same query editor, time-range chips, and results table rather than two
 * near-duplicate implementations. The inspector column is narrow, so this
 * expands into a full-page modal on demand via a portal — the same mounted
 * component either way, so expanding/collapsing keeps the in-progress query
 * text and results.
 *
 * Floci's supported StartQuery subset (fields/filter/sort/dedup/limit — see
 * docs/services/cloudwatch.md) has no UI of its own; this is that surface.
 * Styled after the real CloudWatch Logs Insights query editor (dark code box,
 * time-range chips, run-with-shortcut), minus the capabilities Floci doesn't
 * implement (stats/visualize, pattern analysis, live tail) — this repo's own
 * rule against decorative, unwired controls.
 *
 * The cross-group mode's "SOURCE logGroups(...)" line mirrors the real AWS
 * console's display, but Floci's query engine doesn't parse that syntax
 * embedded in a query string (verified: it fails the query when present, and
 * rejects the query outright with neither that clause nor a request-level
 * log-group parameter) — so the line is a read-only, auto-updating summary of
 * the actual scope, never sent as part of the query text. The real scope goes
 * through the request's logGroupNames field, which is what Floci executes.
 */
export function LogsQueryPanel({cloud, runtimeReachable, logGroupName, allLogGroups}: LogsQueryPanelProps) {
    const isMultiGroup = allLogGroups !== undefined
    const [queryText, setQueryText] = useState(DEFAULT_QUERY)
    const [rangeMinutes, setRangeMinutes] = useState(RANGE_OPTIONS[1].minutes)
    const [expanded, setExpanded] = useState(false)
    const [namePrefix, setNamePrefix] = useState('')
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
    const hasSeededSelectionRef = useRef(false)

    const matchingGroups = useMemo(
        () => (allLogGroups ?? []).filter((group) => group.id.startsWith(namePrefix)),
        [allLogGroups, namePrefix],
    )

    // Seeds the initial "everything selected" state the first time data
    // arrives, and never again — checking `selectedGroups.size === 0` instead
    // of a one-time flag would look identical to "user deliberately cleared
    // every checkbox," and silently re-select everything on the next
    // resources refetch (Refresh button, refocus, etc.), overriding a choice
    // the user just made.
    useEffect(() => {
        if (!isMultiGroup || hasSeededSelectionRef.current || matchingGroups.length === 0) return
        setSelectedGroups(new Set(matchingGroups.map((group) => group.id)))
        hasSeededSelectionRef.current = true
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seeds once on arrival; must not re-run as namePrefix/selection change
    }, [allLogGroups])

    function handlePrefixChange(value: string) {
        setNamePrefix(value)
        const matches = (allLogGroups ?? []).filter((group) => group.id.startsWith(value))
        setSelectedGroups(new Set(matches.map((group) => group.id)))
    }

    function toggleGroup(id: string) {
        setSelectedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const queryMut = useMutation({
        mutationFn: () => {
            const endTime = Math.floor(Date.now() / 1000)
            const startTime = endTime - rangeMinutes * 60
            if (isMultiGroup) {
                return queryLogsAcrossGroups(cloud, {
                    logGroupNames: [...selectedGroups],
                    queryString: queryText,
                    startTime,
                    endTime,
                })
            }
            return queryLogs(cloud, logGroupName ?? '', {queryString: queryText, startTime, endTime})
        },
    })
    const {mutate: runQuery, reset: resetQuery} = queryMut

    // ResourceInspector reuses this instance across row selections rather than
    // remounting it, so without this the previous group's results linger and
    // read as if they belong to the newly selected one. No-op in multi-group
    // mode, where logGroupName never changes.
    useEffect(() => {
        resetQuery()
        setQueryText(DEFAULT_QUERY)
        setRangeMinutes(RANGE_OPTIONS[1].minutes)
        setExpanded(false)
    }, [logGroupName, resetQuery])

    if (!logGroupName && !isMultiGroup) return null

    const selectionInvalid = isMultiGroup && (selectedGroups.size === 0 || selectedGroups.size > MAX_QUERY_LOG_GROUPS)

    function submit() {
        if (!queryText.trim() || selectionInvalid) return
        runQuery()
    }

    function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
        }
    }

    // Falls back to an explicit names list once the selection diverges from
    // "everything the prefix matches" (a group manually unchecked, most
    // commonly) — otherwise this read-only line would keep describing a
    // broader scope than what logGroupNames actually sends.
    const scopeMatchesPrefix = selectedGroups.size === matchingGroups.length
        && matchingGroups.every((group) => selectedGroups.has(group.id))
    const sourceLine = scopeMatchesPrefix
        ? `SOURCE logGroups(namePrefix: [${namePrefix ? JSON.stringify(namePrefix) : ''}], class: "STANDARD") START=-${rangeMinutes}m END=0s |`
        : `SOURCE logGroups(names: [${[...selectedGroups].map((id) => JSON.stringify(id)).join(', ')}], class: "STANDARD") START=-${rangeMinutes}m END=0s |`

    const panel = (
        <section className="logs-query-panel">
            <div className="logs-query-header">
                <Terminal size={15}/>
                <span>
                    <small>{isMultiGroup ? 'Cross-group Insights query' : 'Insights query'}</small>
                    <strong>
                        {isMultiGroup ? `${selectedGroups.size} of ${(allLogGroups ?? []).length} log groups` : logGroupName}
                    </strong>
                    <em>fields / filter / sort / dedup / limit</em>
                </span>
                <div className="logs-query-range" role="group" aria-label="Time range">
                    {RANGE_OPTIONS.map((option) => (
                        <button
                            key={option.minutes}
                            type="button"
                            className={option.minutes === rangeMinutes ? 'active' : ''}
                            disabled={!runtimeReachable}
                            onClick={() => setRangeMinutes(option.minutes)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                <button
                    className="icon-btn"
                    type="button"
                    title={expanded ? 'Collapse' : 'Expand to full page'}
                    onClick={() => setExpanded((value) => !value)}
                >
                    {expanded ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
                </button>
            </div>
            {isMultiGroup && (
                <div className="logs-scope">
                    <div className="logs-scope-row">
                        <input
                            value={namePrefix}
                            onChange={(event) => handlePrefixChange(event.target.value)}
                            placeholder="Filter by log group name prefix…"
                            aria-label="Filter log groups by name prefix"
                        />
                        <span className="logs-scope-count">
                            {selectedGroups.size} of {matchingGroups.length} selected
                        </span>
                    </div>
                    <div className="logs-scope-list" role="group" aria-label="Log groups to query">
                        {matchingGroups.map((group) => (
                            <label className="logs-scope-option" key={group.id}>
                                <input
                                    type="checkbox"
                                    checked={selectedGroups.has(group.id)}
                                    onChange={() => toggleGroup(group.id)}
                                />
                                {group.id}
                            </label>
                        ))}
                        {matchingGroups.length === 0 && <p className="muted">No log groups match this prefix.</p>}
                    </div>
                    {selectedGroups.size > MAX_QUERY_LOG_GROUPS && (
                        <p className="form-error">Select at most {MAX_QUERY_LOG_GROUPS} log groups — CloudWatch Logs' own limit.</p>
                    )}
                </div>
            )}
            <div className="logs-query-editor-wrap">
                {isMultiGroup && <div className="logs-query-source-line">{sourceLine}</div>}
                <textarea
                    className={isMultiGroup ? 'logs-query-textarea with-source-line' : 'logs-query-textarea'}
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    onKeyDown={onEditorKeyDown}
                    spellCheck={false}
                    rows={expanded ? 8 : 3}
                />
                <div className="logs-query-actions">
                    <span className="logs-query-shortcut">{macShortcut()}+Enter</span>
                    <button
                        className="button primary"
                        type="button"
                        disabled={!runtimeReachable || queryMut.isPending || !queryText.trim() || selectionInvalid}
                        onClick={submit}
                    >
                        <Play size={14}/>
                        {queryMut.isPending ? 'Running' : 'Run query'}
                    </button>
                </div>
            </div>
            {queryMut.error instanceof Error && <div className="form-error">{queryMut.error.message}</div>}
            <LogsQueryResults result={queryMut.data} expanded={expanded}/>
        </section>
    )

    return (
        <ExpandablePanel expanded={expanded} onCollapse={() => setExpanded(false)}>
            {panel}
        </ExpandablePanel>
    )
}

function macShortcut(): string {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

const STILL_RUNNING_STATUSES = new Set(['Running', 'Scheduled'])

function LogsQueryResults({result, expanded}: {result?: LogsInsightsQueryResult; expanded: boolean}) {
    if (!result) {
        return (
            <div className="empty compact sql-results-empty">
                <h3>No query results</h3>
                <p>Run an Insights query to see matching log events.</p>
            </div>
        )
    }

    // Different log events discover different fields (a query with no `fields`
    // clause, or events whose shape varies row to row), so a field present only
    // on a later row must not be dropped just because row 0 lacked it.
    const columns = Array.from(new Set(result.rows.flatMap((row) => Object.keys(row))))
    const stillRunning = STILL_RUNNING_STATUSES.has(result.status)

    return (
        <div className="sql-results">
            <div className="sql-results-summary">
                <span>Status: {result.status}</span>
                <span>{result.rows.length} rows</span>
            </div>
            {stillRunning && (
                <div className="muted padded">
                    Floci hadn't finished this query when the console stopped waiting — these rows are a partial,
                    in-progress result, not the full answer. Run the query again to see if it has finished
                    (query id: {result.queryId}).
                </div>
            )}
            {!stillRunning && result.rows.length === 0 && <div className="muted padded">No events matched this query.</div>}
            {columns.length > 0 && (
                <div className={expanded ? 'sql-result-table-wrap logs-query-table-wrap--expanded' : 'sql-result-table-wrap'}>
                    <table className="table sql-result-table">
                        <thead>
                            <tr>
                                {columns.map((column) => <th key={column}>{column}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {result.rows.map((row, index) => (
                                <tr key={index}>
                                    {columns.map((column) => (
                                        <td key={column} title={row[column]}>{row[column]}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
