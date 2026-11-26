import {useEffect, useState} from 'react'
import {Cloud, RefreshCw} from 'lucide-react'
import {Navigate, useNavigate, useParams, useSearchParams} from 'react-router-dom'
import {
    RuntimeFlow,
    ServiceGrid,
    SummarySection,
} from '@/features/cloud-console/CloudConsoleSections'
import {useCloudConsoleHomeData} from '@/features/cloud-console/useCloudConsoleHomeData'
import type {CloudProvider} from '@/types/cloud'
import {isCloudProvider} from '@/lib/cloudProvider'

export function CloudConsoleHomePage() {
    const navigate = useNavigate()
    const params = useParams()
    const [searchParams] = useSearchParams()
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const routeCloud = normalizeCloud(params.cloud)
    const cloud = routeCloud ?? 'aws'
    const data = useCloudConsoleHomeData(cloud)
    const [, setTick] = useState(0)

    useEffect(() => {
        const id = window.setInterval(() => setTick((value) => value + 1), 30_000)
        return () => window.clearInterval(id)
    }, [])

    if (!routeCloud) return <Navigate to="/console/aws" replace/>

    const filteredServices = search
        ? data.serviceCards.filter((s) =>
            s.label.toLowerCase().includes(search) ||
            s.id.toLowerCase().includes(search) ||
            s.description?.toLowerCase().includes(search) ||
            s.meta?.toLowerCase().includes(search)
          )
        : data.serviceCards

    return (
        <>
            <div className="page-header cloud-explorer-header">
                <div className="page-title">
                    <Cloud size={20}/>
                    <div>
                        <h1>Console Home</h1>
                        <p className="muted">Cloud-aware local runtime overview</p>
                    </div>
                </div>
            </div>

            <div className="content cloud-console-home">
                <SummarySection
                    cloud={cloud}
                    runtimeLabel={data.runtimeLabel}
                    runtimeState={data.runtimeState}
                    runtimeClass={data.runtimeClass}
                    runtimeDetail={data.runtimeDetail}
                    activeServices={data.activeServices}
                    activeServicesDetail={data.activeServicesDetail}
                    resourceCount={data.resourceCount}
                    resourceDetail={data.resourceDetail}
                />

                <RuntimeFlow cloud={cloud} status={data.status}/>

                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '8px 0 12px'}}>
                    <div>
                        <p className="muted" style={{margin: 0, fontSize: '0.8rem'}} title={data.countsUpdatedAt ? new Date(data.countsUpdatedAt).toLocaleString() : undefined}>
                            {data.countsUpdatedAt ? `Last checked ${formatRelativeTime(data.countsUpdatedAt)}` : 'Resource counts not loaded yet'}
                        </p>
                        <p className="muted" style={{margin: '2px 0 0', fontSize: '0.75rem'}}>
                            Shows services with confirmed instances; unknown counts stay visible but are excluded from active totals.
                        </p>
                    </div>
                    <button
                        type="button"
                        className="nav-retry"
                        style={{display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: '0.75rem'}}
                        onClick={() => { void data.refetchCounts() }}
                        disabled={data.resourcesLoading || data.status?.runtime !== 'reachable'}
                        aria-busy={data.resourcesLoading}
                    >
                        <RefreshCw size={12}/>
                        {data.resourcesLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>

                <ServiceGrid
                    services={filteredServices}
                    searchQuery={search}
                    runtimeReachable={data.status?.runtime === 'reachable'}
                    resourcesLoading={data.resourcesLoading}
                    resourceCountProgress={data.resourceCountProgress}
                    resourceCountErrorCount={data.resourceCountErrorCount}
                    resourceCountFailedServices={data.resourceCountFailedServices}
                    onRetryCounts={() => { void data.refetchFailedCounts() }}
                    onNavigate={(route) => navigate(route)}
                />
            </div>
        </>
    )
}

function normalizeCloud(value?: string): CloudProvider | null {
    return isCloudProvider(value) ? value : null
}

function formatRelativeTime(timestamp: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
    if (seconds < 10) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}
