import {useEffect, useMemo, useState} from 'react'
import {useSearchParams} from 'react-router-dom'
import {History, RefreshCw} from 'lucide-react'
import {ACTIVITY_POLL_INTERVAL_MS, useActivityPages} from '@/api/queries/activityQueries'
import {useCloudServicesQuery} from '@/api/queries/cloudQueries'
import {EmptyState} from '@/components/EmptyState'
import {formatDateTime} from '@/lib/format'
import {useActiveCloud} from '@/lib/useActiveCloud'
import type {ActivityQuery, ActivityStatus} from '@/types/activity'

const CLOUD_OPTIONS = [
    {value: 'aws', label: 'AWS'},
    {value: 'azure', label: 'Azure'},
    {value: 'gcp', label: 'GCP'},
    {value: 'oci', label: 'OCI'},
]

const STATUS_OPTIONS = [
    {value: 'success', label: 'Success'},
    {value: 'failed', label: 'Failed'},
]

const STATUS_BADGES: Record<ActivityStatus, {background: string; color: string}> = {
    success: {background: 'var(--status-ok-tint)', color: 'var(--status-ok)'},
    failed: {background: 'var(--status-error-tint)', color: 'var(--status-error)'},
}

interface FilterSelectProps {
    label: string
    allLabel: string
    value: string
    options: Array<{value: string; label: string}>
    onChange: (value: string) => void
}

function FilterSelect({label, allLabel, value, options, onChange}: FilterSelectProps) {
    return (
        <select aria-label={label} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{allLabel}</option>
            {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
            ))}
        </select>
    )
}

/**
 * The global recent-changes feed: every mutation the console API served, newest
 * first, across all clouds. Recorded server-side (see the API's activityLog),
 * so the list reflects what actually changed rather than only this page's own
 * actions, and it polls so changes land without a manual refresh.
 */
export function ActivityPage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const urlSearch = (searchParams.get('search') ?? '').trim()
    const activeCloud = useActiveCloud()
    const servicesQuery = useCloudServicesQuery(activeCloud)

    const [searchDraft, setSearchDraft] = useState(urlSearch)
    const [cloud, setCloud] = useState('')
    const [service, setService] = useState('')
    const [operation, setOperation] = useState('')
    const [status, setStatus] = useState('')
    const [resourceType, setResourceType] = useState('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])

    // The topbar search shares ?search=; both inputs follow the URL.
    useEffect(() => setSearchDraft(urlSearch), [urlSearch])
    useEffect(() => {
        const next = searchDraft.trim()
        if (next === urlSearch) return
        const timer = setTimeout(() => {
            const params = new URLSearchParams(searchParams)
            if (next) params.set('search', next)
            else params.delete('search')
            setSearchParams(params, {replace: true})
        }, 300)
        return () => clearTimeout(timer)
    }, [searchDraft, urlSearch, searchParams, setSearchParams])

    const filters: ActivityQuery = useMemo(() => ({
        cloud: cloud || undefined,
        service: service || undefined,
        operation: operation || undefined,
        status: (status || undefined) as ActivityStatus | undefined,
        resourceType: resourceType || undefined,
        search: urlSearch || undefined,
        // A date input gives a day; span the whole day at the upper bound.
        from: from ? `${from}T00:00:00.000` : undefined,
        to: to ? `${to}T23:59:59.999` : undefined,
    }), [cloud, service, operation, status, resourceType, urlSearch, from, to])

    // Any filter change invalidates the cursor chain behind it.
    useEffect(() => setCursors([undefined]), [filters])

    const pages = useActivityPages(filters, cursors)
    const firstPage = pages[0]
    const lastPage = pages[pages.length - 1]
    const entries = pages.flatMap((page) => page.data?.items ?? [])
    const facets = firstPage.data?.facets
    const nextCursor = lastPage.data?.nextCursor ?? null
    const loading = firstPage.isLoading
    const loadingMore = pages.length > 1 && lastPage.isFetching

    const serviceLabels = new Map(
        servicesQuery.data?.map((item) => [item.service, item.displayName] as const) ?? [],
    )
    const serviceOptions = (facets?.services ?? []).map((key) => ({
        value: key,
        label: serviceLabels.get(key) ?? key,
    }))
    const operationOptions = (facets?.operations ?? []).map((value) => ({value, label: value}))
    const typeOptions = (facets?.resourceTypes ?? []).map((value) => ({value, label: value}))

    const hasFilters = Boolean(cloud || service || operation || status || resourceType || from || to || urlSearch)
    const clearFilters = () => {
        setCloud('')
        setService('')
        setOperation('')
        setStatus('')
        setResourceType('')
        setFrom('')
        setTo('')
        setSearchDraft('')
        const params = new URLSearchParams(searchParams)
        params.delete('search')
        setSearchParams(params, {replace: true})
    }

    const loadMore = () => {
        if (nextCursor) setCursors((current) => [...current, nextCursor])
    }

    return (
        <>
            <div className="page-header">
                <div className="page-title">
                    <History size={20}/>
                    <div>
                        <h1>Activity</h1>
                        <p className="muted">Recent changes across every cloud this console serves</p>
                    </div>
                </div>
            </div>

            <div className="content">
                <section className="table-panel">
                    <div className="input-row resource-table-bar">
                        <div>
                            <p className="eyebrow">Recent changes</p>
                            <span className="muted">
                                {loading ? 'Loading activity' : `${entries.length} recorded operations`}
                            </span>
                        </div>
                        <div className="resource-table-tools">
                            <div className="search-box">
                                <input
                                    aria-label="Search activity"
                                    className="input"
                                    value={searchDraft}
                                    onChange={(event) => setSearchDraft(event.target.value)}
                                    placeholder="Search by resource name or ID"
                                />
                            </div>
                            <FilterSelect
                                label="Filter by cloud" allLabel="All clouds"
                                value={cloud} options={CLOUD_OPTIONS} onChange={setCloud}
                            />
                            <FilterSelect
                                label="Filter by service" allLabel="All services"
                                value={service} options={serviceOptions} onChange={setService}
                            />
                            <FilterSelect
                                label="Filter by operation" allLabel="All operations"
                                value={operation} options={operationOptions} onChange={setOperation}
                            />
                            <FilterSelect
                                label="Filter by resource type" allLabel="All types"
                                value={resourceType} options={typeOptions} onChange={setResourceType}
                            />
                            <FilterSelect
                                label="Filter by status" allLabel="Any status"
                                value={status} options={STATUS_OPTIONS} onChange={setStatus}
                            />
                            <input
                                aria-label="From date" className="input" type="date"
                                value={from} onChange={(event) => setFrom(event.target.value)}
                            />
                            <input
                                aria-label="To date" className="input" type="date"
                                value={to} onChange={(event) => setTo(event.target.value)}
                            />
                            {hasFilters && (
                                <button className="button" type="button" onClick={clearFilters}>Clear</button>
                            )}
                            <button
                                className="button"
                                type="button"
                                title={`Refreshes automatically every ${ACTIVITY_POLL_INTERVAL_MS / 1000} seconds`}
                                disabled={firstPage.isFetching}
                                onClick={() => void firstPage.refetch()}
                            >
                                <RefreshCw size={14}/> Refresh
                            </button>
                        </div>
                    </div>

                    {firstPage.isError && (
                        <div className="form-error" role="alert" style={{display: 'flex', alignItems: 'center', gap: 8}}>
                            <span style={{flex: 1}}>Could not load activity.</span>
                            <button className="button compact" type="button" disabled={firstPage.isFetching} onClick={() => void firstPage.refetch()}>
                                Retry
                            </button>
                        </div>
                    )}

                    {!loading && entries.length > 0 && (
                        <div className="table-scroll">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Cloud</th>
                                        <th>Service</th>
                                        <th>Resource</th>
                                        <th>Operation</th>
                                        <th>Status</th>
                                        <th>Source</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {entries.map((entry) => (
                                        <tr key={entry.id}>
                                            <td className="mono" title={entry.timestamp}>
                                                {formatDateTime(entry.timestamp) ?? entry.timestamp}
                                            </td>
                                            <td>{entry.cloud ? entry.cloud.toUpperCase() : '-'}</td>
                                            <td>{entry.service ? (serviceLabels.get(entry.service) ?? entry.service) : '-'}</td>
                                            <td>
                                                {entry.resourceType && (
                                                    <span className="badge neutral">{entry.resourceType}</span>
                                                )}{' '}
                                                {entry.resourceName ?? '-'}
                                            </td>
                                            <td>{entry.operation}</td>
                                            <td>
                                                <span
                                                    className="badge"
                                                    style={{display: 'inline-flex', ...STATUS_BADGES[entry.status]}}
                                                >
                                                    {entry.status === 'success' ? 'Success' : 'Failed'}
                                                </span>
                                                {entry.detail && (
                                                    <span className="muted"> {entry.detail}</span>
                                                )}
                                            </td>
                                            <td className="muted">{entry.source}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {nextCursor && (
                        <div style={{padding: 12}}>
                            <button className="button" type="button" disabled={loadingMore} onClick={loadMore}>
                                {loadingMore ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}

                    {!loading && !firstPage.isError && entries.length === 0 && (
                        hasFilters ? (
                            <div>
                                <EmptyState
                                    icon={History}
                                    title="No matching activity"
                                    description="No recorded changes match the current filters."
                                />
                                <div style={{display: 'flex', justifyContent: 'center'}}>
                                    <button className="button" type="button" onClick={clearFilters}>Clear filters</button>
                                </div>
                            </div>
                        ) : (
                            <EmptyState
                                icon={History}
                                title="No activity yet"
                                description="Resource operations performed in this console appear here, newest first."
                            />
                        )
                    )}
                </section>
            </div>
        </>
    )
}
