import {useQuery} from '@tanstack/react-query'
import {
    getCloudServiceStatus,
    getCloudStatus,
    listCloudResourceCounts,
    listCloudResources,
    listCloudServices,
    listClouds,
} from '@/api/cloudProxyClient'
import {useAccountId} from '@/lib/accountStore'
import type {CloudProvider, CloudServiceDescriptor, CloudServiceType, CloudStatus} from '@/types/cloud'

/**
 * Shared cloud queries.
 *
 * These live under api/ rather than in a feature folder because the app shell
 * (nav, connection indicator) needs them as much as the console home does.
 * Key strings are unchanged so existing caches still share.
 */
export const cloudQueryKeys = {
    clouds: ['clouds'] as const,
    services: (cloud: CloudProvider) => ['cloud-services', cloud] as const,
    status: (cloud: CloudProvider) => ['cloud-status', cloud] as const,
    serviceStatus: (cloud: CloudProvider, service: CloudServiceType) =>
        ['cloud-service-status', cloud, service] as const,
    resources: (accountId: string, cloud: CloudProvider, service: CloudServiceType) =>
        ['cloud-resources', accountId, cloud, service] as const,
    resourceCounts: (accountId: string, cloud: CloudProvider) =>
        ['cloud-resource-counts', accountId, cloud] as const,
}

export function useCloudsQuery() {
    return useQuery({
        queryKey: cloudQueryKeys.clouds,
        queryFn: ({signal}) => listClouds(signal),
    })
}

export function useCloudServicesQuery(cloud: CloudProvider) {
    return useQuery({
        queryKey: cloudQueryKeys.services(cloud),
        queryFn: ({signal}) => listCloudServices(cloud, signal),
        // The catalog only changes when the API restarts, so this is effectively
        // free on every navigation while still driving the whole nav.
        staleTime: 60_000,
    })
}

export function useCloudStatusQuery(cloud: CloudProvider, options: {refetchInterval?: number} = {}) {
    return useQuery({
        queryKey: cloudQueryKeys.status(cloud),
        queryFn: ({signal}) => getCloudStatus(cloud, signal),
        refetchInterval: options.refetchInterval ?? 10_000,
    })
}

/** Health of the single service being viewed, rather than of the whole cloud. */
export function useCloudServiceStatusQuery(
    cloud: CloudProvider,
    service: CloudServiceType,
    options: {enabled?: boolean} = {},
) {
    return useQuery({
        queryKey: cloudQueryKeys.serviceStatus(cloud, service),
        queryFn: ({signal}) => getCloudServiceStatus(cloud, service, signal),
        refetchInterval: 10_000,
        enabled: options.enabled ?? true,
    })
}

export function useCloudConsoleResourcesQuery({
    cloud,
    service,
    services,
    status,
}: {
    cloud: CloudProvider
    service: CloudServiceType
    services?: CloudServiceDescriptor[]
    status?: CloudStatus
}) {
    const accountId = useAccountId()
    return useQuery({
        queryKey: cloudQueryKeys.resources(accountId, cloud, service),
        queryFn: ({signal}) => listCloudResources(cloud, service, undefined, signal),
        enabled: hasAvailableService(services, service) && status?.runtime === 'reachable',
    })
}

export function useCloudResourceCountsQuery(cloud: CloudProvider, enabled = true) {
    const accountId = useAccountId()
    return useQuery({
        queryKey: cloudQueryKeys.resourceCounts(accountId, cloud),
        queryFn: ({signal}) => listCloudResourceCounts(cloud, signal),
        enabled,
        staleTime: 30_000,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
    })
}

function hasAvailableService(services: CloudServiceDescriptor[] | undefined, service: CloudServiceType): boolean {
    return services?.some((item) => item.service === service && item.availability === 'available') ?? false
}
