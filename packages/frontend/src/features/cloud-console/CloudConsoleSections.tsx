import {type ElementType} from 'react'
import {Cloud, Database, ExternalLink, Radio, Route, ShieldCheck} from 'lucide-react'
import {adapterLabel, cloudName, providerDescription, runtimeName} from './cloudConsoleHome.utils'
import type {ProviderBannerProps, RuntimeFlowProps, ServiceGridProps, SummarySectionProps} from './types'

export function ProviderBanner({cloud, runtimeClass, runtimeReachable, onOpenStorage}: ProviderBannerProps) {
    return (
        <section className={`console-provider-banner ${runtimeClass}`}>
            <div>
                <p className="eyebrow">Selected Cloud</p>
                <h3>{cloudName(cloud)}</h3>
                <p>{providerDescription(cloud)}</p>
            </div>
            <div className="console-provider-actions">
                <button className="button primary" type="button" disabled={!runtimeReachable} onClick={onOpenStorage}>
                    <ExternalLink size={14}/>
                    Open Storage
                </button>
            </div>
        </section>
    )
}

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

export function ServiceGrid({services, runtimeReachable, onNavigate, searchQuery}: ServiceGridProps) {
    if (services.length === 0) {
        return (
            <section className="console-service-grid empty">
                <p className="muted" style={{ padding: '24px', textAlign: 'center', gridColumn: '1 / -1' }}>
                    {searchQuery ? `No services matching "${searchQuery}"` : 'No services found.'}
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
                const content = (
                    <>
                        <div className="service-card-header">
                            <div className="service-icon"><Icon size={18}/></div>
                            <div>
                                <h3>{service.label}</h3>
                                <span className={isAvailable ? 'status healthy' : 'status unknown'}>
                                    {isAvailable ? 'available' : 'coming soon'}
                                </span>
                            </div>
                        </div>
                        <div className="console-service-meta">
                            <strong>{service.count ?? '-'}</strong>
                            <span>{service.meta}</span>
                        </div>
                    </>
                )

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
