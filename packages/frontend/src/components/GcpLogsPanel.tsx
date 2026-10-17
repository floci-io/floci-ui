import {useState, type FormEvent} from 'react'
import {useQuery} from '@tanstack/react-query'
import {queryFlatItems} from '@/api/cloudProxyClient'
import {formatDateTime} from '@/lib/format'

const SEVERITIES = ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY']

export function GcpLogsPanel({logName, runtimeReachable}: {logName: string; runtimeReachable: boolean}) {
    const [severity, setSeverity] = useState('')
    const [from, setFrom] = useState('')
    const [until, setUntil] = useState('')
    const [filter, setFilter] = useState('')
    const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
    const [error, setError] = useState('')
    const cursor = cursors[cursors.length - 1]

    const entries = useQuery({
        queryKey: ['gcp-log-entries', logName, filter, cursor],
        queryFn: ({signal}) => queryFlatItems('gcp', 'logs', logName, filter, cursor, signal),
        enabled: runtimeReachable,
    })

    function applyFilter(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (from && until && new Date(from) > new Date(until)) {
            setError('Start time must be before end time.')
            return
        }
        setError('')
        const clauses = [
            ...(severity ? [`severity>=${severity}`] : []),
            ...(from ? [`timestamp>="${new Date(from).toISOString()}"`] : []),
            ...(until ? [`timestamp<="${new Date(until).toISOString()}"`] : []),
        ]
        setFilter(clauses.join(' AND '))
        setCursors([undefined])
    }

    return (
        <section className="logs-query-panel" aria-label="Cloud Logging entries">
            <h3>Log entries</h3>
            <form onSubmit={applyFilter}>
                <label>Minimum severity
                    <select className="input" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                        <option value="">All</option>
                        {SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                </label>
                <label>Start time
                    <input className="input" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)}/>
                </label>
                <label>End time
                    <input className="input" type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)}/>
                </label>
                <button className="button" type="submit" disabled={!runtimeReachable}>Apply filters</button>
            </form>
            {error && <p role="alert" className="form-error">{error}</p>}
            {entries.error instanceof Error && <p role="alert" className="form-error">{entries.error.message}</p>}
            {!runtimeReachable && <p className="muted">Connect to Floci-GCP to read entries.</p>}
            {entries.isLoading && <p className="muted">Loading entries…</p>}
            {entries.isSuccess && entries.data.items.length === 0 && <p className="muted">No log entries match these filters.</p>}
            {entries.isSuccess && entries.data.items.length > 0 && (
                <div className="table-scroll">
                    <table className="table">
                        <thead><tr><th>Timestamp</th><th>Severity</th><th>Message</th></tr></thead>
                        <tbody>
                            {entries.data.items.map((entry, index) => (
                                <tr key={`${entry.id}-${index}`}>
                                    <td>{formatDateTime(entry.timestamp) ?? '-'}</td>
                                    <td>{String(entry.body.severity ?? 'DEFAULT')}</td>
                                    <td className="mono gcp-log-message">{String(entry.body.message ?? '')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {entries.isSuccess && (
                <div>
                    {cursors.length > 1 && <button className="button" type="button" onClick={() => setCursors((current) => current.slice(0, -1))}>Previous page</button>}
                    {entries.data.nextCursor && <button className="button" type="button" onClick={() => setCursors((current) => [...current, entries.data.nextCursor ?? undefined])}>Next page</button>}
                    <button className="button" type="button" disabled={entries.isFetching} onClick={() => void entries.refetch()}>Refresh</button>
                </div>
            )}
        </section>
    )
}
