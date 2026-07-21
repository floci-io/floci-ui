export type CloudProvider = 'aws' | 'azure' | 'gcp'
export type CloudAvailability = 'available' | 'coming_soon'
export type CloudServiceType = 'storage' | 'k8s' | 'database' | 'compute' | 'networking' | 'serverless' | 'queue'

export interface CloudDescriptor {
    id: CloudProvider
    displayName: string
    availability: CloudAvailability
}

export interface CloudServiceDescriptor {
    cloud: CloudProvider
    service: CloudServiceType
    displayName: string
    availability: CloudAvailability
}

export interface CloudStatus {
    cloud: CloudProvider
    adapterRegistered: boolean
    runtime: 'reachable' | 'unavailable' | 'coming_soon'
    endpoint: string | null
    checkedAt: string
    error: string | null
}
