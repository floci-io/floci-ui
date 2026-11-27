import {useMemo} from 'react'
import {useQuery} from '@tanstack/react-query'
import {
    getCloudServiceStatus,
    getCloudStatus,
    listCloudResources,
    listCloudServices,
    listClouds,
} from '@/api/cloudProxyClient'
import {useAccountId} from '@/lib/accountStore'
import {useRegion} from '@/lib/regionStore'
import type {CloudProvider, CloudServiceDescriptor, CloudServiceType, CloudStatus} from '@/types/cloud'

/** The account and region a cloud's data is cached under; empty for a cloud that has neither. */
export type CloudQueryScope = readonly [] | readonly [accountId: string, region: string | null]

/**
 * Floci isolates AWS resources per account and region, so AWS data is cached under
 * both, as the EC2 queries are. They go last: a key without them still matches every
 * account's and region's copy by prefix. Azure, GCP and OCI adapters are
 * account-neutral and ignore the AWS region, so their data is cached once.
 */
export function useCloudQueryScope(cloud: CloudProvider | undefined): CloudQueryScope {
    const accountId = useAccountId()
    const region = useRegion()
    return useMemo(() => (cloud === 'aws' ? [accountId, region] : []), [cloud, accountId, region])
}

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
    resources: (cloud: CloudProvider, service: CloudServiceType, scope: CloudQueryScope = []) =>
        ['cloud-console-resources', cloud, service, ...scope] as const,
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
    const scope = useCloudQueryScope(cloud)
    return useQuery({
        queryKey: cloudQueryKeys.resources(cloud, service, scope),
        queryFn: ({signal}) => listCloudResources(cloud, service, undefined, signal),
        enabled: hasAvailableService(services, service) && status?.runtime === 'reachable',
    })
}

function hasAvailableService(services: CloudServiceDescriptor[] | undefined, service: CloudServiceType): boolean {
    return services?.some((item) => item.service === service && item.availability === 'available') ?? false
}
