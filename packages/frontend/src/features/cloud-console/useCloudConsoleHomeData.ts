import {useMemo} from 'react'
import {useQueries} from '@tanstack/react-query'
import {listCloudResources} from '@/api/cloudProxyClient'
import {
    cloudQueryKeys,
    useCloudServicesQuery,
    useCloudStatusQuery,
    useCloudsQuery,
} from '@/api/queries/cloudQueries'
import {serviceIcon} from '@/components/serviceIcons'
import {
    resourceDetailFor,
    runtimeClassFor,
    runtimeDetailFor,
    runtimeEndpointLabel,
    runtimeLabelFor,
    serviceMetaLabel,
} from './cloudConsoleHome.utils'
import type {CloudProvider} from '@/types/cloud'
import type {ConsoleServiceCard} from './types'

/**
 * Console home is driven entirely by `GET /clouds/:cloud/services`.
 *
 * It previously hardcoded three resource queries, spliced in a Secrets Manager
 * card for AWS with a hardcoded "available", and appended two permanent
 * placeholder cards — so it could disagree with both the sidebar and the API.
 */
export function useCloudConsoleHomeData(cloud: CloudProvider) {
    const cloudsQuery = useCloudsQuery()
    const servicesQuery = useCloudServicesQuery(cloud)
    const statusQuery = useCloudStatusQuery(cloud)
    const status = statusQuery.data
    const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])

    // Services on their own route are counted through the generic list endpoint;
    // a legacy absolute-route page has no such endpoint, so it shows no count.
    const countable = useMemo(
        () => services.filter((service) => service.availability === 'available' && !service.route.startsWith('/')),
        [services],
    )

    const runtimeReachable = status?.runtime === 'reachable'
    const countQueries = useQueries({
        queries: countable.map((service) => ({
            queryKey: cloudQueryKeys.resources(cloud, service.service),
            queryFn: ({signal}: {signal?: AbortSignal}) =>
                listCloudResources(cloud, service.service, undefined, signal),
            enabled: runtimeReachable,
            staleTime: 30_000,
        })),
    })

    const countsByService = useMemo(() => {
        const map = new Map<string, {count?: number; isLoading: boolean; isError: boolean}>()
        countable.forEach((service, index) => {
            const query = countQueries[index]
            map.set(service.service, {
                count: query?.data?.length,
                isLoading: query?.isLoading ?? false,
                isError: query?.isError ?? false,
            })
        })
        return map
    }, [countable, countQueries])

    const serviceCards = useMemo<ConsoleServiceCard[]>(
        () =>
            services.map((service): ConsoleServiceCard => {
                const counts = countsByService.get(service.service)
                const isLegacyPage = service.route.startsWith('/')
                return {
                    id: service.service,
                    label: service.displayName,
                    status: service.availability,
                    count: counts?.count,
                    icon: serviceIcon(service.iconKey),
                    route:
                        service.availability === 'available'
                            ? isLegacyPage
                                ? service.route
                                : `/cloud-explorer/${cloud}/${service.route}`
                            : undefined,
                    meta:
                        service.availability === 'available'
                            ? isLegacyPage
                                ? 'open service'
                                : serviceMetaLabel(status, counts?.isLoading ?? false, 'resources')
                            : 'coming soon',
                }
            }),
        [cloud, countsByService, services, status],
    )

    const resourcesLoading = countQueries.some((query) => query.isLoading)
    const resourcesError = countQueries.some((query) => query.isError)
    const resourceCount = countQueries.reduce((total, query) => total + (query.data?.length ?? 0), 0)
    const activeServices = services.filter((service) => service.availability === 'available').length

    return {
        cloudsQuery,
        status,
        runtimeLabel: runtimeEndpointLabel(status),
        runtimeState: runtimeLabelFor(status, statusQuery.isLoading),
        runtimeClass: runtimeClassFor(status, statusQuery.isLoading),
        runtimeDetail: status?.error ?? runtimeDetailFor(cloud, status),
        activeServices,
        // Counted rather than asserted: the old copy claimed a fixed service list.
        activeServicesDetail: servicesQuery.isSuccess
            ? `${activeServices} of ${services.length} services available`
            : 'Loading services',
        resourceCount,
        resourceDetail: resourceDetailFor(status, statusQuery.isLoading, resourcesLoading, resourcesError),
        serviceCards,
    }
}
