import {useMemo} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {listCloudResourceCounts} from '@/api/cloudProxyClient'
import {
    cloudQueryKeys,
    useCloudResourceCountsQuery,
    useCloudServicesQuery,
    useCloudStatusQuery,
} from '@/api/queries/cloudQueries'
import {serviceIcon} from '@/components/serviceIcons'
import {useAccountId} from '@/lib/accountStore'
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
 * Services are shown only when they have at least one resource instance, so the
 * home page reflects what the user is actually running. Availability still comes
 * from the catalog/adapters, and counts come from the aggregate resource-counts
 * endpoint to avoid N per-service list requests.
 */
export function useCloudConsoleHomeData(cloud: CloudProvider) {
    const accountId = useAccountId()
    const queryClient = useQueryClient()
    const servicesQuery = useCloudServicesQuery(cloud)
    const statusQuery = useCloudStatusQuery(cloud)
    const status = statusQuery.data
    const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])

    const runtimeReachable = status?.runtime === 'reachable'
    const countsQuery = useCloudResourceCountsQuery(cloud, runtimeReachable)
    const countable = useMemo(
        () => services.filter((service) => service.availability === 'available'),
        [services],
    )

    const countsByService = useMemo(() => {
        const map = new Map<string, {count?: number; isLoading: boolean; isError: boolean; errorMessage?: string}>()
        for (const service of countable) {
            map.set(service.service, {isLoading: runtimeReachable && countsQuery.isLoading, isError: false})
        }
        for (const item of countsQuery.data ?? []) {
            map.set(item.service, {
                count: item.count,
                isLoading: false,
                isError: !!item.error,
                errorMessage: item.error,
            })
        }
        return map
    }, [countable, countsQuery.data, countsQuery.isLoading, runtimeReachable])

    const serviceCards = useMemo<ConsoleServiceCard[]>(
        () =>
            services.map((service): ConsoleServiceCard => {
                const counts = countsByService.get(service.service)
                const isLegacyPage = service.route.startsWith('/')
                const countUnknown = counts?.isError
                return {
                    id: service.service,
                    label: service.displayName,
                    description: service.description ?? '',
                    status: service.availability,
                    count: counts?.count,
                    countError: countUnknown,
                    countErrorMessage: counts?.errorMessage,
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
                                : countUnknown
                                    ? 'count unavailable'
                                    : serviceMetaLabel(status, counts?.isLoading ?? false, 'resources')
                            : 'coming soon',
                }
            }),
        [cloud, countsByService, services, status],
    )

    const resourcesLoading = runtimeReachable && countsQuery.isLoading
    const failedCountItems = (countsQuery.data ?? []).filter((item) => !!item.error)
    const resourceCountErrorCount = failedCountItems.length + (countsQuery.isError ? countable.length : 0)
    const resourceCount = (countsQuery.data ?? []).reduce((total, item) => total + (item.count ?? 0), 0)
    const failedServiceNames = countsQuery.isError
        ? countable.map((service) => service.displayName)
        : failedCountItems.map((item) => services.find((service) => service.service === item.service)?.displayName ?? item.service)
    const failedServiceTypes = countsQuery.isError
        ? countable.map((service) => service.service)
        : failedCountItems.map((item) => item.service)
    const refetchFailedCounts = async () => {
        if (failedServiceTypes.length === 0) {
            await countsQuery.refetch()
            return
        }
        const fresh = await listCloudResourceCounts(cloud, undefined, failedServiceTypes)
        queryClient.setQueryData(cloudQueryKeys.resourceCounts(accountId, cloud), (current: unknown) => {
            const items = Array.isArray(current) ? current as Array<{service: string}> : []
            const merged = items.map((item) => fresh.find((next) => next.service === item.service) ?? item)
            for (const next of fresh) {
                if (!merged.some((item) => item.service === next.service)) merged.push(next)
            }
            return merged
        })
    }
    const visibleServiceCards = useMemo(
        () => serviceCards.filter((service) => service.status === 'available' && ((service.count ?? 0) > 0 || service.countError)),
        [serviceCards],
    )
    const activeServices = visibleServiceCards.filter((service) => (service.count ?? 0) > 0).length
    const settledCounts = countsQuery.isLoading ? 0 : countable.length

    return {
        status,
        runtimeLabel: runtimeEndpointLabel(status),
        runtimeState: runtimeLabelFor(status, statusQuery.isLoading),
        runtimeClass: runtimeClassFor(status, statusQuery.isLoading),
        runtimeDetail: status?.error ?? runtimeDetailFor(cloud, status),
        activeServices,
        activeServicesDetail: servicesQuery.isSuccess
            ? runtimeReachable
                ? resourcesLoading
                    ? `Loading services with resources (${settledCounts}/${countable.length})`
                    : `${activeServices} service${activeServices === 1 ? '' : 's'} with resources`
                : 'Waiting for runtime'
            : 'Loading services',
        resourceCount,
        resourceDetail: resourceDetailFor(status, statusQuery.isLoading, resourcesLoading, countsQuery.isError ? countable.length : resourceCountErrorCount),
        serviceCards: visibleServiceCards,
        resourcesLoading,
        resourceCountErrorCount: countsQuery.isError ? countable.length : resourceCountErrorCount,
        resourceCountFailedServices: failedServiceNames,
        resourceCountProgress: {
            loaded: settledCounts,
            total: countable.length,
        },
        countsUpdatedAt: countsQuery.dataUpdatedAt,
        refetchCounts: countsQuery.refetch,
        refetchFailedCounts,
    }
}