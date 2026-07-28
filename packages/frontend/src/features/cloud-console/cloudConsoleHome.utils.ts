import type {CloudProvider, CloudStatus} from '@/types/cloud'

export function runtimeEndpointLabel(status?: CloudStatus): string {
    return status?.endpoint ?? 'Unknown endpoint'
}

export function runtimeLabelFor(status: CloudStatus | undefined, loading: boolean): string {
    if (loading) return 'Checking runtime'
    if (!status) return 'Unknown'
    if (status.runtime === 'reachable') return 'Runtime reachable'
    if (status.runtime === 'unavailable') return 'Runtime unavailable'
    return 'Coming soon'
}

export function runtimeClassFor(status: CloudStatus | undefined, loading: boolean): 'ready' | 'pending' | 'unavailable' {
    if (loading || !status || status.runtime === 'coming_soon') return 'pending'
    return status.runtime === 'reachable' ? 'ready' : 'unavailable'
}

export function runtimeDetailFor(cloud: CloudProvider, status?: CloudStatus): string {
    if (status?.runtime === 'reachable') return 'Connected through Cloud Proxy API'
    if (status?.runtime === 'unavailable') return 'Start the selected runtime to load resources'
    if (cloud === 'gcp') return 'Waiting for Floci-GCP runtime status'
    return 'Waiting for runtime status'
}

export function resourceDetailFor(
    status: CloudStatus | undefined,
    statusLoading: boolean,
    resourcesLoading: boolean,
    resourcesError: boolean,
): string {
    if (statusLoading) return 'Waiting for runtime status'
    if (status?.runtime === 'unavailable') return 'Blocked until runtime is reachable'
    if (status?.runtime === 'coming_soon') return 'No adapter registered yet'
    if (resourcesLoading) return 'Loading normalized resources'
    if (resourcesError) return 'Resource load failed'
    return 'Normalized resources across available services'
}

export function serviceMetaLabel(status: CloudStatus | undefined, loading: boolean, label: string): string {
    if (status?.runtime === 'unavailable') return 'runtime unavailable'
    if (status?.runtime === 'coming_soon') return 'coming soon'
    if (loading) return `loading ${label}`
    return label
}

export function cloudName(cloud: CloudProvider): string {
    if (cloud === 'aws') return 'AWS Local Runtime'
    if (cloud === 'azure') return 'Azure Local Runtime'
    return 'GCP Local Runtime'
}

export function providerDescription(cloud: CloudProvider): string {
    if (cloud === 'aws') return 'Storage, runtime infrastructure, and AWS-specific pages are backed by Floci AWS Core.'
    if (cloud === 'azure') return 'Storage is backed by Floci-AZ through the same normalized storage contract.'
    return 'Storage is backed by Floci-GCP through the same normalized storage contract.'
}

export function adapterLabel(cloud: CloudProvider, status?: CloudStatus): string {
    if (!status?.adapterRegistered) return 'Coming soon'
    return `${cloud.toUpperCase()} Adapter`
}

export function runtimeName(cloud: CloudProvider): string {
    if (cloud === 'aws') return 'Floci AWS Core'
    if (cloud === 'azure') return 'Floci-AZ'
    return 'Floci-GCP'
}
