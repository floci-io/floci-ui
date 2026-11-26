import {type ElementType} from 'react'
import {Cloud, Database, Radio, Route, ShieldCheck} from 'lucide-react'
import {adapterLabel, runtimeName} from './cloudConsoleHome.utils'
import type {RuntimeFlowProps, ServiceGridProps, SummarySectionProps} from './types'

export function SummarySection({
    cloud,
    runtimeLabel,
    runtimeState,
    runtimeClass,
    runtimeDetail,
    activeServices,
    activeServicesDetail,
    resourceCount,
    resourceDetail,
}: SummarySectionProps) {
    return (
        <section className="console-summary">
            <SummaryTile label="Cloud" value={cloud.toUpperCase()} detail={runtimeLabel} icon={Cloud}/>
            <SummaryTile label="Runtime" value={runtimeState} detail={runtimeDetail} icon={Radio} state={runtimeClass}/>
            <SummaryTile label="Active services" value={`${activeServices}`} detail={activeServicesDetail}/>
            <SummaryTile label="Resources" value={`${resourceCount}`} detail={resourceDetail}/>
        </section>
    )
}

export function RuntimeFlow({cloud, status}: RuntimeFlowProps) {
    return (
        <section className="console-runtime-flow">
            <FlowStep icon={Cloud} label="UI" value="Console Home"/>
            <FlowStep icon={Route} label="Proxy" value="/api/clouds"/>
            <FlowStep icon={ShieldCheck} label="Adapter" value={adapterLabel(cloud, status)}/>
            <FlowStep icon={Database} label="Runtime" value={runtimeName(cloud)}/>
        </section>
    )
}

export function ServiceGrid({services, runtimeReachable, onNavigate, searchQuery, resourcesLoading, resourceCountProgress, resourceCountErrorCount = 0, resourceCountFailedServices = [], onRetryCounts}: ServiceGridProps) {
    const progressText = resourcesLoading && resourceCountProgress && resourceCountProgress.total > 0
        ? ` (${resourceCountProgress.loaded}/${resourceCountProgress.total})`
        : ''
    const failedServicesText = resourceCountFailedServices.length > 0
        ? ` (${resourceCountFailedServices.slice(0, 3).join(', ')}${resourceCountFailedServices.length > 3 ? `, +${resourceCountFailedServices.length - 3} more` : ''})`
        : ''

    if (services.length === 0) {
        const errorText = resourceCountErrorCount > 0
            ? ` Could not load ${resourceCountErrorCount} service${resourceCountErrorCount === 1 ? '' : 's'}${failedServicesText}.`
            : ''
        if (resourcesLoading && !searchQuery && runtimeReachable) {
            const skeletonCount = Math.min(resourceCountProgress?.total || 6, 8)
            return (
                <section className="console-service-grid">
                    {Array.from({length: skeletonCount}, (_, index) => (
                        <div key={index} className="service-card console-service-card" aria-hidden="true">
                            <div className="service-card-header">
                                <div className="service-icon"><span className="skeleton-bar" style={{width: 18, height: 18, borderRadius: 4}}/></div>
                                <div style={{flex: 1}}>
                                    <span className="skeleton-bar" style={{width: '55%', height: 12, marginBottom: 8}}/>
                                    <span className="skeleton-bar" style={{width: '40%', height: 10}}/>
                                </div>
                            </div>
                            <span className="skeleton-bar" style={{width: '90%', height: 10, marginTop: 12}}/>
                            <span className="skeleton-bar" style={{width: '70%', height: 10, marginTop: 8}}/>
                        </div>
                    ))}
                    <p className="muted" role="status" aria-live="polite" style={{ padding: '8px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                        Loading resources...{progressText}
                    </p>
                </section>
            )
        }
        const message = searchQuery
            ? `No services matching "${searchQuery}"`
            : resourcesLoading
                ? `Loading resources...${progressText}`
                : runtimeReachable
                    ? `No resources yet. Create a resource to see it here.${errorText}`
                    : 'Runtime unavailable.'
        return (
            <section className="console-service-grid empty">
                <p className="muted" style={{ padding: '24px', textAlign: 'center', gridColumn: '1 / -1' }}>
                    {message}
                    {resourceCountErrorCount > 0 && onRetryCounts && !searchQuery && !resourcesLoading && (
                        <button
                            type="button"
                            className="nav-retry"
                            style={{ marginLeft: 8, padding: '2px 8px', fontSize: '0.75rem' }}
                            onClick={onRetryCounts}
                            aria-busy={resourcesLoading}
                        >
                            Retry
                        </button>
                    )}
                </p>
            </section>
        )
    }

    return (
        <section className="console-service-grid">
            {services.map((service) => {
                const Icon = service.icon
                const isAvailable = service.status === 'available'
                const canOpen = isAvailable && service.route && runtimeReachable
                const errorDetail = service.countError
                    ? (
                        <div style={{margin: '8px 0 0', fontSize: '0.75rem', lineHeight: 1.3}}>
                            <p className="muted" style={{margin: 0}}>Included in view; excluded from active count until confirmed.</p>
                            {service.countErrorMessage && (
                                service.countErrorMessage.length > 80 ? (
                                    <details style={{margin: '6px 0 0'}}>
                                        <summary className="muted" style={{cursor: 'pointer'}}>
                                            {service.countErrorMessage.slice(0, 80).trimEnd()}...
                                        </summary>
                                        <p className="muted" style={{margin: '6px 0 0'}}>{service.countErrorMessage}</p>
                                    </details>
                                ) : (
                                    <p className="muted" style={{margin: '6px 0 0'}}>{service.countErrorMessage}</p>
                                )
                            )}
                        </div>
                    )
                    : null
                const content = (
                    <>
                        <div className="service-card-header">
                            <div className="service-icon"><Icon size={18}/></div>
                            <div>
                                <h2>{service.label}</h2>
                                <span className={service.countError ? 'status unknown' : isAvailable ? 'status healthy' : 'status unknown'}>
                                    {service.countError ? 'count unavailable' : isAvailable ? 'available' : 'coming soon'}
                                </span>
                            </div>
                        </div>
                        <p className="console-service-description">{service.description}</p>
                        <div className="console-service-meta" title={service.countErrorMessage}>
                            <strong>{service.countError ? '!' : (service.count ?? '-')}</strong>
                            <span>{service.meta}</span>
                        </div>
                    </>
                )

                if (service.countError && onRetryCounts) {
                    const retryButton = (
                        <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 8}}>
                            <button
                                type="button"
                                className="nav-retry"
                                style={{padding: '2px 8px', fontSize: '0.75rem'}}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onRetryCounts()
                                }}
                                disabled={resourcesLoading}
                                aria-busy={resourcesLoading}
                            >
                                Retry
                            </button>
                        </div>
                    )
                    return (
                        <div key={service.id} className={`service-card console-service-card ${canOpen ? '' : isAvailable ? 'blocked' : 'offline'}`}>
                            {canOpen ? (
                                <button type="button" className="console-service-card-link" style={{all: 'unset', cursor: 'pointer', display: 'block', width: '100%'}} onClick={() => onNavigate(service.route!)}>
                                    {content}
                                </button>
                            ) : content}
                            {errorDetail}
                            {retryButton}
                        </div>
                    )
                }

                if (errorDetail) {
                    return (
                        <div key={service.id} className={`service-card console-service-card ${canOpen ? '' : isAvailable ? 'blocked' : 'offline'}`}>
                            {canOpen ? (
                                <button type="button" className="console-service-card-link" style={{all: 'unset', cursor: 'pointer', display: 'block', width: '100%'}} onClick={() => onNavigate(service.route!)}>
                                    {content}
                                </button>
                            ) : content}
                            {errorDetail}
                        </div>
                    )
                }

                return canOpen ? (
                    <button key={service.id} className="service-card console-service-card" type="button" onClick={() => onNavigate(service.route!)}>
                        {content}
                    </button>
                ) : (
                    <div key={service.id} className={`service-card console-service-card ${isAvailable ? 'blocked' : 'offline'}`}>
                        {content}
                    </div>
                )
            })}
            {resourcesLoading && progressText && (
                <p className="muted" role="status" aria-live="polite" style={{ padding: '8px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                    Loading resources...{progressText}
                </p>
            )}
            {resourceCountErrorCount > 0 && (
                <p className="muted" style={{ padding: '8px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                    Could not load {resourceCountErrorCount} service{resourceCountErrorCount === 1 ? '' : 's'}{failedServicesText}.
                    {onRetryCounts && (
                        <button
                            type="button"
                            className="nav-retry"
                            style={{ marginLeft: 8, padding: '2px 8px', fontSize: '0.75rem' }}
                            onClick={onRetryCounts}
                            disabled={resourcesLoading}
                            aria-busy={resourcesLoading}
                        >
                            Retry
                        </button>
                    )}
                </p>
            )}
        </section>
    )
}

function SummaryTile({label, value, detail, icon, state}: {label: string; value: string; detail: string; icon?: ElementType; state?: string}) {
    const Icon = icon
    return (
        <div className={`summary-tile ${state ?? ''}`}>
            {Icon && <Icon size={16}/>}
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
        </div>
    )
}

function FlowStep({icon, label, value}: {icon: ElementType; label: string; value: string}) {
    const Icon = icon
    return (
        <div className="console-flow-step">
            <Icon size={16}/>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    )
}
