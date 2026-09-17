import {useEffect, useState, type KeyboardEvent} from 'react'
import {createPortal} from 'react-dom'
import {Maximize2, Minimize2, Play, Terminal} from 'lucide-react'
import {useMutation} from '@tanstack/react-query'
import {queryLogs} from '@/api/cloudProxyClient'
import type {CloudProvider} from '@/types/cloud'
import type {LogsInsightsQueryResult} from '@/types/resource'

const DEFAULT_QUERY = 'fields @timestamp, @message\n| sort @timestamp desc\n| limit 20'

const RANGE_OPTIONS = [
    {label: '15m', minutes: 15},
    {label: '1h', minutes: 60},
    {label: '6h', minutes: 360},
    {label: '24h', minutes: 1440},
]

interface LogsQueryPanelProps {
    cloud: CloudProvider
    logGroupName?: string
    runtimeReachable: boolean
}

/**
 * Lives inside ResourceInspector next to a selected log group's metadata,
 * rather than as a full-width section a dev has to scroll the resource table
 * to find. The inspector column is narrow, so this expands into a full-page
 * modal on demand via a portal — the same mounted component either way, so
 * expanding/collapsing keeps the in-progress query text and results.
 *
 * Floci's supported StartQuery subset (fields/filter/sort/dedup/limit — see
 * docs/services/cloudwatch.md) has no UI of its own; this is that surface.
 * Styled after the real CloudWatch Logs Insights query editor (dark code box,
 * time-range chips, run-with-shortcut), minus the capabilities Floci doesn't
 * implement (stats/visualize, pattern analysis, live tail) — this repo's own
 * rule against decorative, unwired controls.
 */
export function LogsQueryPanel({cloud, logGroupName, runtimeReachable}: LogsQueryPanelProps) {
    const [queryText, setQueryText] = useState(DEFAULT_QUERY)
    const [rangeMinutes, setRangeMinutes] = useState(RANGE_OPTIONS[1].minutes)
    const [expanded, setExpanded] = useState(false)

    const queryMut = useMutation({
        mutationFn: () => {
            const endTime = Math.floor(Date.now() / 1000)
            return queryLogs(cloud, logGroupName ?? '', {
                queryString: queryText,
                startTime: endTime - rangeMinutes * 60,
                endTime,
            })
        },
    })
    const {mutate: runQuery, reset: resetQuery} = queryMut

    // ResourceInspector reuses this instance across row selections rather than
    // remounting it, so without this the previous group's results linger and
    // read as if they belong to the newly selected one.
    useEffect(() => {
        resetQuery()
        setQueryText(DEFAULT_QUERY)
        setExpanded(false)
    }, [logGroupName, resetQuery])

    if (!logGroupName) return null

    function submit() {
        if (!queryText.trim()) return
        runQuery()
    }

    function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
        }
    }

    const panel = (
        <section className="logs-query-panel">
            <div className="logs-query-header">
                <Terminal size={15}/>
                <span>
                    <small>Insights query</small>
                    <strong>{logGroupName}</strong>
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
            <div className="logs-query-editor-wrap">
                <textarea
                    className="logs-query-textarea"
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
                        disabled={!runtimeReachable || queryMut.isPending || !queryText.trim()}
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

    if (!expanded) return panel

    return createPortal(
        <div className="modal-overlay" onClick={() => setExpanded(false)}>
            <div className="logs-query-modal" onClick={(event) => event.stopPropagation()}>
                {panel}
            </div>
        </div>,
        document.body,
    )
}

function macShortcut(): string {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

function LogsQueryResults({result, expanded}: {result?: LogsInsightsQueryResult; expanded: boolean}) {
    if (!result) {
        return (
            <div className="empty compact sql-results-empty">
                <h3>No query results</h3>
                <p>Run an Insights query to see matching log events.</p>
            </div>
        )
    }

    const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : []

    return (
        <div className="sql-results">
            <div className="sql-results-summary">
                <span>Status: {result.status}</span>
                <span>{result.rows.length} rows</span>
            </div>
            {result.rows.length === 0 && <div className="muted padded">No events matched this query.</div>}
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
