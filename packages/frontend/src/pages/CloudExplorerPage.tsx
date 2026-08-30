import {useMemo, useState} from 'react'
import {Cloud, X} from 'lucide-react'
import {Navigate, useNavigate, useParams} from 'react-router-dom'
import {useQuery} from '@tanstack/react-query'
import {Link} from 'react-router-dom'
import {getServiceSchema} from '@/api/cloudProxyClient'
import {useCloudServicesQuery, useCloudStatusQuery, useCloudsQuery} from '@/api/queries/cloudQueries'
import {CloudSelector} from '@/components/CloudSelector'
import {DynamicResourceView} from '@/components/DynamicResourceView'
import {EmptyState} from '@/components/EmptyState'
import {normalizeCapabilities, withRuntimeState, withServiceAvailability} from '@/lib/capabilities'
import type {CloudProvider, CloudServiceDescriptor, CloudServiceType, CloudStatus} from '@/types/cloud'
import type {ServiceSchema} from '@/types/schema'

export function CloudExplorerPage() {
    const navigate = useNavigate()
    const params = useParams()
    const routeCloud = normalizeCloud(params.cloud)
    const cloud = routeCloud ?? 'aws'
    const service = params.service ?? ''
    const [infoOpen, setInfoOpen] = useState(false)

    const cloudsQuery = useCloudsQuery()
    const servicesQuery = useCloudServicesQuery(cloud)
    const statusQuery = useCloudStatusQuery(cloud)
    const schemaQuery = useQuery({
        queryKey: ['cloud-schema', cloud, service],
        queryFn: ({signal}) => getServiceSchema(cloud, service, signal),
        enabled: Boolean(service),
    })

    const selectedService = useMemo(
        () => servicesQuery.data?.find((item) => item.service === service),
        [service, servicesQuery.data],
    )

    // Until the catalog resolves, availability is unknown — not "coming soon".
    // Treating it as unknown keeps a registered service from flashing the
    // adapter-coming-soon notice on every load.
    const catalogPending = servicesQuery.isPending

    if (!routeCloud) {
        return <Navigate to="/cloud-explorer/aws/storage" replace/>
    }

    // Never redirect while the catalog is still loading: doing so silently sent
    // any unknown or slow-loading service to storage.
    if (servicesQuery.isSuccess && !selectedService) {
        return <UnknownServiceNotice cloud={cloud} service={service} services={servicesQuery.data}/>
    }

    return (
        <>
            <div className="page-header cloud-explorer-header">
                <div className="page-title">
                    <Cloud size={20}/>
                    <div>
                        <h2>Cloud Explorer</h2>
                        <p className="muted">Unified local runtime console</p>
                    </div>
                </div>
                <div className="cloud-header-selectors">
                    <label>
                        <span>Service</span>
                        <div className="service-selector-readonly">{selectedService?.displayName ?? service}</div>
                    </label>
                    <label>
                        <span>Cloud</span>
                        <CloudSelector
                            clouds={cloudsQuery.data ?? []}
                            selected={cloud}
                            onSelect={(nextCloud) => navigate(`/cloud-explorer/${nextCloud}/storage`)}
                        />
                    </label>
                </div>
            </div>
            <div className="content cloud-explorer">
                <DynamicResourceView
                    cloud={cloud}
                    service={service}
                    serviceAvailability={selectedService?.availability}
                    serviceReason={selectedService?.reason}
                    cloudStatus={statusQuery.data}
                    statusLoading={statusQuery.isLoading || catalogPending}
                    onOpenInfo={() => setInfoOpen(true)}
                />
            </div>
            {infoOpen && (
                <ServiceInfoDialog
                    cloud={cloud}
                    service={service}
                    descriptor={selectedService}
                    status={statusQuery.data}
                    statusLoading={statusQuery.isLoading}
                    schema={schemaQuery.data}
                    onClose={() => setInfoOpen(false)}
                />
            )}
        </>
    )
}

function normalizeCloud(value?: string): CloudProvider | null {
    return value === 'aws' || value === 'azure' || value === 'gcp' ? value : null
}

function ServiceInfoDialog({
    cloud,
    service,
    descriptor,
    status,
    statusLoading,
    schema,
    onClose,
}: {
    cloud: CloudProvider
    service: CloudServiceType
    descriptor?: CloudServiceDescriptor
    status?: CloudStatus
    statusLoading: boolean
    schema?: ServiceSchema
    onClose: () => void
}) {
    const capabilityList = schema?.capabilities
        ? withServiceAvailability(
            withRuntimeState(
                normalizeCapabilities([
                    ...(schema.capabilities.resourceActions ?? []),
                    ...(schema.capabilities.objectActions ?? []),
                    ...(schema.capabilities.kubernetesActions ?? []),
                ]),
                status?.runtime === 'reachable',
            ),
            descriptor?.availability ?? 'coming_soon',
        )
        : []
    const actionFallback = schema?.actions.join(', ') ?? 'Loading actions'

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="service-info-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="service-info-header">
                    <div>
                        <p className="eyebrow">Service Information</p>
                        <h3>{schema?.displayName ?? descriptor?.displayName ?? service}</h3>
                    </div>
                    <button className="icon-btn" type="button" onClick={onClose}>
                        <X size={14}/>
                    </button>
                </div>
                <div className="service-info-grid">
                    <InfoCard label="Proxy API" value={`/api/clouds/${cloud}/services/${service}`} detail="Single entry point used by the UI"/>
                    <InfoCard label="Service" value={descriptor?.displayName ?? service} detail={serviceAvailability(descriptor)}/>
                    <InfoCard label="Runtime" value={runtimeValue(status)} detail={runtimeDetail(status, statusLoading)} state={runtimeState(status, statusLoading)}/>
                    <InfoCard label="Adapter" value={adapterValue(cloud, status)} detail={adapterDetail(status, statusLoading)} state={adapterState(cloud, status)}/>
                    <InfoCard label="Connection" value={connectionValue(status, statusLoading)} detail={status?.endpoint ?? 'No runtime endpoint'} state={runtimeState(status, statusLoading)}/>
                    <InfoCard label="Normalized Contract" value={schema?.columns.length ? `${schema.columns.length} columns · ${schema.filters.length} filters` : 'Loading schema'} detail="Shared table and resource inspector"/>
                </div>
                <div className="service-info-section">
                    <p className="eyebrow">Supported Actions</p>
                    {capabilityList.length ? (
                        <div className="capability-strip">
                            {capabilityList.map((capability) => (
                                <span
                                    key={capability.name}
                                    className={`capability-pill ${capability.status}`}
                                    title={capability.reason}
                                >
                                    {capability.label}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="service-info-copy">{actionFallback}</p>
                    )}
                </div>
                {descriptor?.reason && (
                    <div className="service-info-section">
                        <p className="eyebrow">Availability</p>
                        <p className="service-info-copy">{descriptor.reason}</p>
                    </div>
                )}
            </div>
        </div>
    )
}

function InfoCard({
    label,
    value,
    detail,
    state,
}: {
    label: string
    value: string
    detail: string
    state?: 'ready' | 'pending' | 'unavailable'
}) {
    return (
        <div className={`service-info-card ${state ?? ''}`}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
        </div>
    )
}

function serviceAvailability(service?: CloudServiceDescriptor): string {
    if (!service) return 'Loading service schema'
    return service.availability === 'available' ? 'Schema available' : 'Coming soon'
}

function runtimeValue(status?: CloudStatus): string {
    return status?.endpoint?.replace(/^https?:\/\//, '') ?? 'Unknown'
}

function runtimeDetail(status?: CloudStatus, loading?: boolean): string {
    if (loading) return 'Checking runtime'
    if (!status) return 'Status unavailable'
    if (status.runtime === 'reachable') return 'Runtime reachable'
    if (status.runtime === 'unavailable') return status.error ?? 'Runtime unavailable'
    return 'Runtime coming soon'
}

function runtimeState(status?: CloudStatus, loading?: boolean): 'ready' | 'pending' | 'unavailable' {
    if (loading || !status || status.runtime === 'coming_soon') return 'pending'
    return status.runtime === 'reachable' ? 'ready' : 'unavailable'
}

function adapterValue(cloud: CloudProvider, status?: CloudStatus): string {
    if (cloud === 'gcp') return 'GCP Adapter'
    if (status?.adapterRegistered === false) return 'Not registered'
    return `${cloud.toUpperCase()} Adapter`
}

function adapterDetail(status?: CloudStatus, loading?: boolean): string {
    if (loading) return 'Checking adapter'
    if (!status) return 'Adapter status unknown'
    return status.adapterRegistered ? 'Adapter ready' : 'Coming soon'
}

function adapterState(_cloud: CloudProvider, status?: CloudStatus): 'ready' | 'pending' | 'unavailable' {
    if (!status || !status.adapterRegistered) return 'pending'
    return 'ready'
}

function connectionValue(status?: CloudStatus, loading?: boolean): string {
    if (loading) return 'Checking'
    if (!status) return 'Unknown'
    if (status.runtime === 'reachable') return 'Connected'
    if (status.runtime === 'unavailable') return 'Not connected'
    return 'Coming soon'
}



/**
 * A slug that is not in the server's catalog. Previously this silently redirected
 * to storage, so a typo or a stale bookmark looked like a working page.
 */
function UnknownServiceNotice({
    cloud,
    service,
    services,
}: {
    cloud: CloudProvider
    service: string
    services?: CloudServiceDescriptor[]
}) {
    const available = (services ?? []).filter((item) => item.availability === 'available')

    return (
        <>
            <div className="page-header cloud-explorer-header">
                <div className="page-title">
                    <Cloud size={20}/>
                    <div>
                        <h2>Cloud Explorer</h2>
                        <p className="muted">Unified local runtime console</p>
                    </div>
                </div>
            </div>
            <div className="content cloud-explorer">
                <EmptyState
                    icon={Cloud}
                    title={service ? `${cloud.toUpperCase()} has no service called "${service}"` : 'No service selected'}
                    description="Pick one of the services this runtime exposes."
                />
                <div className="unknown-service-links">
                    {available.map((item) => (
                        <Link
                            className="button compact"
                            key={item.service}
                            to={item.route.startsWith('/') ? item.route : `/cloud-explorer/${cloud}/${item.route}`}
                        >
                            {item.displayName}
                        </Link>
                    ))}
                    <Link className="button compact" to={`/console/${cloud}`}>Console Home</Link>
                </div>
            </div>
        </>
    )
}
