import type {ElementType} from 'react'
import type {CloudAvailability, CloudProvider, CloudStatus} from '@/types/cloud'

export interface ConsoleServiceCard {
    id: string
    label: string
    status: CloudAvailability
    count?: number
    icon: ElementType
    route?: string
    meta: string
}

export interface SummarySectionProps {
    cloud: CloudProvider
    runtimeLabel: string
    runtimeState: string
    runtimeClass: 'ready' | 'pending' | 'unavailable'
    runtimeDetail: string
    activeServices: number
    activeServicesDetail: string
    resourceCount: number
    resourceDetail: string
}

export interface ServiceGridProps {
    services: ConsoleServiceCard[]
    runtimeReachable: boolean
    onNavigate: (route: string) => void
    searchQuery?: string
}

export interface RuntimeFlowProps {
    cloud: CloudProvider
    status?: CloudStatus
}
