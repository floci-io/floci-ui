export type CloudProvider = 'aws' | 'azure' | 'gcp'
export type CloudAvailability = 'available' | 'coming_soon'

export type KnownCloudServiceType =
    | 'storage'
    | 'k8s'
    | 'database'
    | 'compute'
    | 'networking'
    | 'serverless'
    | 'messaging'
    | 'events'
    | 'secrets'
    | 'iac'
    | 'email'

/**
 * Deliberately open where the API's own type is closed.
 *
 * The service catalog lives on the server, so a newly registered service must be
 * able to appear in the UI without a frontend type edit. The known literals are
 * kept for autocompletion and so existing `service === 'compute'` comparisons
 * keep type-checking.
 */
export type CloudServiceType = KnownCloudServiceType | (string & {})

export type ServiceGroup =
    | 'Compute'
    | 'Storage'
    | 'Databases'
    | 'Networking'
    | 'Integration'
    | 'Provisioning'
    | 'Security'
    | 'Observability'

export interface CloudDescriptor {
    id: CloudProvider
    displayName: string
    availability: CloudAvailability
}

/** Everything the nav needs to render a service, supplied by the server. */
export interface CloudServiceDescriptor {
    cloud: CloudProvider
    service: CloudServiceType
    displayName: string
    availability: CloudAvailability
    /** Why the service is unavailable; always present when coming_soon. */
    reason?: string
    /** Route slug, or an absolute path for a page outside Cloud Explorer. */
    route: string
    iconKey: string
    group: ServiceGroup
    order: number
}

export type RuntimeReachability = 'reachable' | 'unavailable' | 'coming_soon'

export interface CloudStatus {
    cloud: CloudProvider
    adapterRegistered: boolean
    runtime: RuntimeReachability
    endpoint: string | null
    checkedAt: string
    error: string | null
    services?: CloudServiceStatus[]
}

export interface CloudServiceStatus {
    cloud: CloudProvider
    service: CloudServiceType
    adapterRegistered: boolean
    runtime: RuntimeReachability
    endpoint: string | null
    checkedAt: string
    latencyMs: number | null
    error: string | null
    /** Mapped error code, so "not implemented" reads differently from "down". */
    errorCode: string | null
}
