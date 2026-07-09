import {useMemo, useState} from 'react'
import {Cloud, X} from 'lucide-react'
import {Navigate, useNavigate, useParams} from 'react-router-dom'
import {useQuery} from '@tanstack/react-query'
import {getCloudStatus, getServiceSchema, listClouds, listCloudServices} from '@/api/cloudProxyClient'
import {CloudSelector} from '@/components/CloudSelector'
import {DynamicResourceView} from '@/components/DynamicResourceView'
import {normalizeCapabilities, withRuntimeState, withServiceAvailability} from '@/lib/capabilities'
import type {CloudProvider, CloudServiceDescriptor, CloudServiceType, CloudStatus} from '@/types/cloud'
import type {ServiceSchema} from '@/types/schema'

export function CloudExplorerPage() {
    const navigate = useNavigate()
    const params = useParams()
    const routeCloud = normalizeCloud(params.cloud)
    const routeService = normalizeService(params.service)
    const cloud = routeCloud ?? 'aws'
    const service = routeService ?? 'storage'
    const [infoOpen, setInfoOpen] = useState(false)

    const cloudsQuery = useQuery({
        queryKey: ['clouds'],
        queryFn: ({signal}) => listClouds(signal),
    })

    const servicesQuery = useQuery({
        queryKey: ['cloud-services', cloud],
        queryFn: ({signal}) => listCloudServices(cloud, signal),
    })

    const statusQuery = useQuery({
        queryKey: ['cloud-status', cloud],
        queryFn: ({signal}) => getCloudStatus(cloud, signal),
        refetchInterval: 10_000,
    })
    const schemaQuery = useQuery({
        queryKey: ['cloud-schema', cloud, service],
        queryFn: ({signal}) => getServiceSchema(cloud, service, signal),
    })

    const selectedService = useMemo(
        () => servicesQuery.data?.find((item) => item.service === service),
        [service, servicesQuery.data],
    )

    if (!routeCloud || !routeService) {
        return <Navigate to="/cloud-explorer/aws/storage" replace/>
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
                        <div className="service-selector-readonly">{selectedService?.displayName ?? serviceLabel(service)}</div>
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
                    cloudStatus={statusQuery.data}
                    statusLoading={statusQuery.isLoading}
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

function normalizeService(value?: string): CloudServiceType | null {
    return value === 'storage' || value === 'k8s' || value === 'database' || value === 'compute' || value === 'networking' || value === 'serverless' ? value : null
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
                        <h3>{schema?.displayName ?? descriptor?.displayName ?? serviceLabel(service)}</h3>
                    </div>
                    <button className="icon-btn" type="button" onClick={onClose}>
                        <X size={14}/>
                    </button>
                </div>
                <div className="service-info-grid">
                    <InfoCard label="Proxy API" value={`/api/clouds/${cloud}/services/${service}`} detail="Single entry point used by the UI"/>
                    <InfoCard label="Service" value={descriptor?.displayName ?? serviceLabel(service)} detail={serviceAvailability(descriptor)}/>
                    <InfoCard label="Runtime" value={runtimeValue(cloud, status)} detail={runtimeDetail(status, statusLoading)} state={runtimeState(status, statusLoading)}/>
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
                <div className="service-info-section">
                    <p className="eyebrow">Current Limitations</p>
                    <p className="service-info-copy">{limitationCopy(cloud, service)}</p>
                </div>
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

function runtimeValue(cloud: CloudProvider, status?: CloudStatus): string {
    if (status?.endpoint) return status.endpoint.replace(/^https?:\/\//, '')
    if (cloud === 'aws') return 'localhost:4566'
    if (cloud === 'azure') return 'localhost:4577'
    return 'localhost:4588'
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

function serviceLabel(service: CloudServiceType): string {
    if (service === 'k8s') return 'k8s Engine'
    if (service === 'serverless') return 'Serverless'
    return service.charAt(0).toUpperCase() + service.slice(1)
}

function limitationCopy(cloud: CloudProvider, service: CloudServiceType): string {
    if (cloud === 'aws' && service === 'storage') return 'Advanced S3 workflows such as bulk actions, version browsing, and richer object lifecycle controls still live outside the normalized surface.'
    if (cloud === 'azure' && service === 'storage') return 'Blob Storage is wired through the normalized contract, but advanced metadata, tags, and access-policy workflows are still limited.'
    if (cloud === 'azure' && service === 'database') return 'Cosmos DB uses a richer panel below for databases, containers, items, and SQL queries; a fully normalized database model is still evolving.'
    if (cloud === 'aws' && service === 'compute') return 'Compute workflows still rely on AWS-specific forms for dependent infrastructure choices such as VPC, subnet, and security group.'
    if (cloud === 'aws' && service === 'networking') return 'Networking uses AWS-specific operational panels because many actions require nested workflows instead of a flat generic form.'
    return 'This service is available through the current adapter, but the normalized contract is still expanding.'
}
