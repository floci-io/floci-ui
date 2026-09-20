import {ArrowLeft, Database} from 'lucide-react'
import {Link, useParams, useSearchParams} from 'react-router-dom'
import {useQuery} from '@tanstack/react-query'
import {getCloudResource} from '@/api/cloudProxyClient'
import {HttpError} from '@/api/HttpClient'
import {useCloudServicesQuery, useCloudStatusQuery} from '@/api/queries/cloudQueries'
import {AzureSqlPanel} from '@/components/AzureSqlPanel'
import {CosmosNoSqlPanel} from '@/components/CosmosNoSqlPanel'
import {DynamoDbTableExplorer} from '@/components/DynamoDbTableExplorer'
import {useAccountId} from '@/lib/accountStore'
import {dataExplorerKind} from '@/lib/dataExplorer'
import type {CloudProvider} from '@/types/cloud'

export function DatabaseDataPage() {
    const {cloud, service, resourceId} = useParams()
    const accountId = useAccountId()
    if ((cloud !== 'aws' && cloud !== 'azure' && cloud !== 'gcp') || !service || !resourceId) {
        return <div className="content"><DataNotice title="Invalid data workspace" detail="Check the cloud, service, and resource in this link."/>
            <Link to="/console/aws">Console Home</Link></div>
    }
    return <DatabaseDataWorkspace key={`${accountId}:${cloud}:${service}:${resourceId}`} cloud={cloud} service={service} resourceId={resourceId}/>
}

function DatabaseDataWorkspace({cloud, service, resourceId}: {cloud: CloudProvider; service: string; resourceId: string}) {
    const accountId = useAccountId()
    const [searchParams, setSearchParams] = useSearchParams()
    const servicesQuery = useCloudServicesQuery(cloud)
    const statusQuery = useCloudStatusQuery(cloud)
    const descriptor = servicesQuery.data?.find((item) => item.service === service)
    const resourceQuery = useQuery({
        queryKey: ['cloud-data-resource', accountId, cloud, service, resourceId],
        queryFn: ({signal}) => getCloudResource(cloud, service, resourceId, signal),
        enabled: descriptor?.availability === 'available' && statusQuery.data?.runtime === 'reachable',
    })
    const resource = resourceQuery.data
    const kind = resource && dataExplorerKind(resource)
    const containerId = searchParams.get('container') || undefined

    function retry() {
        void servicesQuery.refetch()
        void statusQuery.refetch()
        if (descriptor?.availability === 'available' && statusQuery.data?.runtime === 'reachable') void resourceQuery.refetch()
    }

    function selectContainer(id: string | undefined) {
        setSearchParams((previous) => {
            const next = new URLSearchParams(previous)
            if (id) next.set('container', id)
            else next.delete('container')
            return next
        })
    }

    function renderWorkspace() {
        if (servicesQuery.isPending || statusQuery.isPending) return <DataNotice title="Loading workspace" detail="Checking service availability and runtime connection."/>
        if (servicesQuery.isError || statusQuery.isError) return <DataNotice title="Unable to load workspace" detail={(servicesQuery.error ?? statusQuery.error)?.message} onRetry={retry}/>
        if (!descriptor) return <DataNotice title="Unknown service" detail={`No ${service} service exists for ${cloud.toUpperCase()}.`}/>
        if (descriptor.availability !== 'available') return <DataNotice title="Service unavailable" detail={descriptor.reason ?? 'This service has no available adapter.'}/>
        if (statusQuery.data?.runtime !== 'reachable') return <DataNotice title="Runtime unavailable" detail={statusQuery.data?.error ?? 'Start the selected runtime to explore data.'} onRetry={retry}/>
        if (resourceQuery.isError) return <DataNotice title={resourceQuery.error instanceof HttpError && resourceQuery.error.status === 404 ? 'Resource not found' : 'Unable to load resource'} detail={resourceQuery.error.message} onRetry={retry}/>
        if (!resource) return <DataNotice title="Loading resource" detail="Reading resource details from the runtime."/>
        if (kind === 'dynamodb') return <DynamoDbTableExplorer cloud={cloud} resource={resource} runtimeReachable/>
        if (kind === 'cosmos') return <CosmosNoSqlPanel key={containerId ?? ''} cloud={cloud} resource={resource} runtimeReachable selectedContainerId={containerId} onSelectContainer={selectContainer}/>
        if (kind === 'sql') return <AzureSqlPanel cloud={cloud} resource={resource} runtimeReachable/>
        return <DataNotice title="Data exploration unavailable" detail="This resource supports management operations only."/>
    }

    return (
        <div className="database-data-page">
            <header className="page-header data-workspace-header">
                <Link className="button compact" to={`/cloud-explorer/${cloud}/${service}`}><ArrowLeft size={14}/>Back to {descriptor?.displayName ?? service}</Link>
                <div className="page-title">
                    <Database size={20}/>
                    <div>
                        <h1>{resource?.name ?? resourceId}</h1>
                        <p className="muted">{cloud.toUpperCase()} · {descriptor?.displayName ?? service} · Explore data</p>
                    </div>
                </div>
            </header>
            <div className="data-workspace">{renderWorkspace()}</div>
        </div>
    )
}

function DataNotice({title, detail, onRetry}: {title: string; detail?: string; onRetry?: () => void}) {
    return <div className="runtime-notice" role="status"><h3>{title}</h3>{detail && <p>{detail}</p>}
        {onRetry && <button className="button" type="button" onClick={onRetry}>Retry</button>}
    </div>
}
