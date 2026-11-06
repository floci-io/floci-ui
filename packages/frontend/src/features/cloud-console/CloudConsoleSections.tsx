import {SoftText} from '@/components/SoftText'
import {EmptyState} from '@/components/EmptyState'
import {RowsSkeleton} from '@/components/PageSkeleton'
import {Icon, Search} from '@/components/sodium/icon'
import {Frame, FrameBody, FrameHeader, FrameTitle, FrameValue} from '@/components/sodium/ui/frame'
import {Item, ItemContent, ItemDescription, ItemGroup, ItemLink, ItemMedia, ItemMeta, ItemTitle} from '@/components/sodium/ui/item'
import {StatusMark} from '@/components/sodium/ui/status'
import {StatusStrip, StatusStripCell, StatusStripLabel, StatusStripValue} from '@/components/sodium/ui/status-strip'
import {adapterLabel, runtimeName} from './cloudConsoleHome.utils'
import type {RuntimeFlowProps, ServiceGridProps, SummarySectionProps} from './types'

const RUNTIME_MARK = {ready: 'ok', unavailable: 'fail', pending: 'idle'} as const

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
        <StatusStrip label="Runtime summary">
            <SummaryCell label="Cloud" value={cloud.toUpperCase()} detail={runtimeLabel}/>
            <SummaryCell
                label="Runtime"
                value={<><StatusMark status={RUNTIME_MARK[runtimeClass]} label={runtimeState}/><SoftText value={runtimeState}/></>}
                detail={runtimeDetail}
            />
            <SummaryCell label="Active services" value={`${activeServices}`} detail={activeServicesDetail}/>
            <SummaryCell label="Resources" value={`${resourceCount}`} detail={resourceDetail}/>
        </StatusStrip>
    )
}

export function RuntimeFlow({cloud, status}: RuntimeFlowProps) {
    return (
        <StatusStrip label="Request path">
            <FlowCell label="UI" value="Console Home"/>
            <FlowCell label="Proxy" value="/api/clouds"/>
            <FlowCell label="Adapter" value={adapterLabel(cloud, status)}/>
            <FlowCell label="Runtime" value={runtimeName(cloud)}/>
        </StatusStrip>
    )
}

export function ServiceGrid({services, loading, runtimeReachable, onNavigate, searchQuery}: ServiceGridProps) {
    return (
        <Frame aria-label="Services">
            <FrameHeader>
                <FrameTitle>Services</FrameTitle>
                <FrameValue meta>{services.length}</FrameValue>
            </FrameHeader>
            <FrameBody padding="none">
                {services.length === 0 && loading ? (
                    <RowsSkeleton rows={8} label="Loading services"/>
                ) : services.length === 0 ? (
                    <EmptyState
                        compact
                        icon={searchQuery ? Search : undefined}
                        reason={searchQuery ? 'no-results' : 'empty'}
                        title={searchQuery ? `No services matching "${searchQuery}"` : 'No services found'}
                        description={searchQuery ? 'Try another name or clear the filter.' : 'The runtime did not list any services.'}
                    />
                ) : (
                    <ItemGroup variant="plain">
                        {services.map((service) => (
                            <ServiceRow
                                key={service.id}
                                service={service}
                                runtimeReachable={runtimeReachable}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </ItemGroup>
                )}
            </FrameBody>
        </Frame>
    )
}

function ServiceRow({service, runtimeReachable, onNavigate}: {
    service: ServiceGridProps['services'][number]
    runtimeReachable: boolean
    onNavigate: (route: string) => void
}) {
    const isAvailable = service.status === 'available'
    const route = isAvailable && runtimeReachable ? service.route : undefined
    const availability = isAvailable ? 'available' : 'coming soon'
    return (
        <Item disabled={!route}>
            <ItemMedia variant="icon"><Icon icon={service.icon}/></ItemMedia>
            <ItemContent>
                <ItemTitle role="heading" aria-level={2}>
                    {route ? (
                        <ItemLink
                            href={route}
                            onClick={(event) => {
                                event.preventDefault()
                                onNavigate(route)
                            }}
                        >
                            {service.label}
                        </ItemLink>
                    ) : service.label}
                </ItemTitle>
                <ItemDescription>{service.description}</ItemDescription>
            </ItemContent>
            <ItemMeta>
                {availability}, {service.count ?? '-'} {service.meta}
            </ItemMeta>
        </Item>
    )
}

function SummaryCell({label, value, detail}: {label: string; value: React.ReactNode; detail: string}) {
    return (
        <StatusStripCell className="justify-start">
            <StatusStripLabel>{label}</StatusStripLabel>
            <StatusStripValue>{typeof value === 'string' ? <SoftText value={value}/> : value}</StatusStripValue>
            <SoftText className="type-body-sm text-text-2" value={detail}/>
        </StatusStripCell>
    )
}

function FlowCell({label, value}: {label: string; value: string}) {
    return (
        <StatusStripCell>
            <StatusStripLabel>{label}</StatusStripLabel>
            <StatusStripValue>{value}</StatusStripValue>
        </StatusStripCell>
    )
}
