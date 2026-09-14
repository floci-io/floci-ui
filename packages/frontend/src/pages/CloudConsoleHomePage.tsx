import {Cloud} from 'lucide-react'
import {Navigate, useNavigate, useParams, useSearchParams} from 'react-router-dom'
import {CloudSelector} from '@/components/CloudSelector'
import {
    ProviderBanner,
    RuntimeFlow,
    ServiceGrid,
    SummarySection,
} from '@/features/cloud-console/CloudConsoleSections'
import {useCloudConsoleHomeData} from '@/features/cloud-console/useCloudConsoleHomeData'
import type {CloudProvider} from '@/types/cloud'

export function CloudConsoleHomePage() {
    const navigate = useNavigate()
    const params = useParams()
    const [searchParams] = useSearchParams()
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const routeCloud = normalizeCloud(params.cloud)
    const cloud = routeCloud ?? 'aws'
    const data = useCloudConsoleHomeData(cloud)

    if (!routeCloud) return <Navigate to="/console/aws" replace/>

    const filteredServices = search
        ? data.serviceCards.filter((s) =>
            s.label.toLowerCase().includes(search) ||
            s.id.toLowerCase().includes(search) ||
            s.meta?.toLowerCase().includes(search)
          )
        : data.serviceCards

    return (
        <>
            <div className="page-header cloud-explorer-header">
                <div className="page-title">
                    <Cloud size={20}/>
                    <div>
                        <h2>Console Home</h2>
                        <p className="muted">Cloud-aware local runtime overview</p>
                    </div>
                </div>
                <div className="cloud-header-selectors">
                    <label>
                        <span>Cloud</span>
                        <CloudSelector
                            clouds={data.cloudsQuery.data ?? []}
                            selected={cloud}
                            onSelect={(nextCloud) => navigate(`/console/${nextCloud}`)}
                        />
                    </label>
                </div>
            </div>

            <div className="content cloud-console-home">
                <ProviderBanner
                    cloud={cloud}
                    runtimeClass={data.runtimeClass}
                    runtimeReachable={data.status?.runtime === 'reachable'}
                    onOpenStorage={() => navigate(`/cloud-explorer/${cloud}/storage`)}
                />

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

                <ServiceGrid
                    services={filteredServices}
                    searchQuery={search}
                    runtimeReachable={data.status?.runtime === 'reachable'}
                    onNavigate={(route) => navigate(route)}
                />
            </div>
        </>
    )
}

function normalizeCloud(value?: string): CloudProvider | null {
    return value === 'aws' || value === 'azure' || value === 'gcp' ? value : null
}
