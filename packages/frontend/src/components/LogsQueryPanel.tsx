import {useState} from 'react'
import {Play, Terminal} from 'lucide-react'
import {useMutation} from '@tanstack/react-query'
import {queryLogs} from '@/api/cloudProxyClient'
import type {CloudProvider} from '@/types/cloud'
import type {LogsInsightsQueryResult} from '@/types/resource'

const DEFAULT_QUERY = 'fields @timestamp, @message\n| sort @timestamp desc\n| limit 20'

const RANGE_OPTIONS = [
    {label: 'Last 15 minutes', minutes: 15},
    {label: 'Last 1 hour', minutes: 60},
    {label: 'Last 6 hours', minutes: 360},
    {label: 'Last 24 hours', minutes: 1440},
]

interface LogsQueryPanelProps {
    cloud: CloudProvider
    logGroupName?: string
    runtimeReachable: boolean
}

/**
 * Floci's supported StartQuery subset (fields/filter/sort/dedup/limit — see
 * docs/services/cloudwatch.md) has no UI of its own; this is that surface,
 * scoped to the log group in view rather than a single stream, matching how
 * Logs Insights itself queries across a whole group.
 */
export function LogsQueryPanel({cloud, logGroupName, runtimeReachable}: LogsQueryPanelProps) {
    const [queryText, setQueryText] = useState(DEFAULT_QUERY)
    const [rangeMinutes, setRangeMinutes] = useState(RANGE_OPTIONS[1].minutes)

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

    if (!logGroupName) return null

    function runQuery() {
        if (!queryText.trim()) return
        queryMut.mutate()
    }

    return (
        <section className="sql-panel">
            <div className="sql-column sql-workspace">
                <div className="sql-panel-header">
                    <Terminal size={15}/>
                    <span>
                        <small>Insights query</small>
                        <strong>{logGroupName}</strong>
                        <em>fields / filter / sort / dedup / limit</em>
                    </span>
                    <select
                        className="input"
                        value={rangeMinutes}
                        disabled={!runtimeReachable}
                        onChange={(event) => setRangeMinutes(Number(event.target.value))}
                    >
                        {RANGE_OPTIONS.map((option) => (
                            <option key={option.minutes} value={option.minutes}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div className="sql-query-editor">
                    <textarea
                        className="textarea code-textarea small"
                        value={queryText}
                        onChange={(event) => setQueryText(event.target.value)}
                        spellCheck={false}
                        rows={3}
                    />
                    <button
                        className="button primary"
                        type="button"
                        disabled={!runtimeReachable || queryMut.isPending || !queryText.trim()}
                        onClick={runQuery}
                    >
                        <Play size={14}/>
                        {queryMut.isPending ? 'Running' : 'Run query'}
                    </button>
                </div>
                {queryMut.error instanceof Error && <div className="form-error">{queryMut.error.message}</div>}
                <LogsQueryResults result={queryMut.data}/>
            </div>
        </section>
    )
}

function LogsQueryResults({result}: {result?: LogsInsightsQueryResult}) {
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
                <div className="sql-result-table-wrap">
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
