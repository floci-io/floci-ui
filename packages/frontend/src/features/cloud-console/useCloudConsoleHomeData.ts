import {useMemo} from 'react'
import {Cpu, Database, KeyRound, MessageSquare, Table2, Zap} from 'lucide-react'
import {
    useCloudConsoleResourcesQuery,
    useCloudsQuery,
    useCloudServicesQuery,
    useCloudStatusQuery,
} from './cloudConsoleHome.queries'
import {useSecretsQuery} from '@/api/aws/secretsmanager.queries'
import {
    activeServicesDetailFor,
    resourceDetailFor,
    runtimeClassFor,
    runtimeDetailFor,
    runtimeEndpointLabel,
    runtimeLabelFor,
    serviceMetaLabel,
} from './cloudConsoleHome.utils'
import type {CloudProvider} from '@/types/cloud'
import type {ConsoleServiceCard} from './types'

const SERVICE_PLACEHOLDERS = [
    {id: 'function', label: 'Function', icon: Zap},
]

export function useCloudConsoleHomeData(cloud: CloudProvider) {
    const cloudsQuery = useCloudsQuery()
    const servicesQuery = useCloudServicesQuery(cloud)
    const statusQuery = useCloudStatusQuery(cloud)
    const status = statusQuery.data
    const queryContext = {
        cloud,
        services: servicesQuery.data,
        status,
    }
    const storageResourcesQuery = useCloudConsoleResourcesQuery({...queryContext, service: 'storage'})
    const k8sResourcesQuery = useCloudConsoleResourcesQuery({...queryContext, service: 'k8s'})
    const databaseResourcesQuery = useCloudConsoleResourcesQuery({...queryContext, service: 'database'})
    const queueResourcesQuery = useCloudConsoleResourcesQuery({...queryContext, service: 'queue'})
    const secretsQuery = useSecretsQuery(cloud === 'aws' && status?.runtime === 'reachable')
    const serviceCards = useMemo<ConsoleServiceCard[]>(() => {
        const storage = servicesQuery.data?.find((service) => service.service === 'storage')
        const k8s = servicesQuery.data?.find((service) => service.service === 'k8s')
        const database = servicesQuery.data?.find((service) => service.service === 'database')
        const queue = servicesQuery.data?.find((service) => service.service === 'queue')

        return [
            {
                id: 'storage',
                label: storage?.displayName ?? 'Storage',
                status: storage?.availability ?? (cloud === 'gcp' ? 'coming_soon' : 'available'),
                count: storageResourcesQuery.data?.length,
                icon: Database,
                route: `/cloud-explorer/${cloud}/storage`,
                meta: serviceMetaLabel(status, storageResourcesQuery.isLoading, 'resources'),
            },
            {
                id: 'k8s',
                label: k8s?.displayName ?? 'k8s Engine',
                status: k8s?.availability ?? 'coming_soon',
                count: k8sResourcesQuery.data?.length,
                icon: Cpu,
                route: `/cloud-explorer/${cloud}/k8s`,
                meta: serviceMetaLabel(status, k8sResourcesQuery.isLoading, 'clusters'),
            },
            {
                id: 'database',
                label: database?.displayName ?? 'Database',
                status: database?.availability ?? 'coming_soon',
                count: databaseResourcesQuery.data?.length,
                icon: Table2,
                route: `/cloud-explorer/${cloud}/database`,
                meta: serviceMetaLabel(status, databaseResourcesQuery.isLoading, 'instances'),
            },
            ...(cloud === 'aws' ? [{
                id: 'secretsmanager',
                label: 'Secrets Manager',
                status: 'available' as const,
                count: secretsQuery.data?.length,
                icon: KeyRound,
                route: '/secretsmanager',
                meta: serviceMetaLabel(status, secretsQuery.isLoading, 'secrets'),
            }, {
                id: 'queue',
                label: queue?.displayName ?? 'Queue',
                status: queue?.availability ?? 'coming_soon',
                count: queueResourcesQuery.data?.length,
                icon: MessageSquare,
                route: `/cloud-explorer/${cloud}/queue`,
                meta: serviceMetaLabel(status, queueResourcesQuery.isLoading, 'queues'),
            }] : []),
            ...SERVICE_PLACEHOLDERS.map((service) => ({
                ...service,
                status: 'coming_soon' as const,
                count: undefined,
                route: undefined,
                meta: 'not wired yet',
            })),
        ]
    }, [
        databaseResourcesQuery.data,
        databaseResourcesQuery.isLoading,
        cloud,
        k8sResourcesQuery.data,
        k8sResourcesQuery.isLoading,
        queueResourcesQuery.data,
        queueResourcesQuery.isLoading,
        secretsQuery.data,
        secretsQuery.isLoading,
        servicesQuery.data,
        status,
        storageResourcesQuery.data,
        storageResourcesQuery.isLoading,
    ])

    const resourcesLoading = storageResourcesQuery.isLoading
        || k8sResourcesQuery.isLoading
        || databaseResourcesQuery.isLoading
        || (cloud === 'aws' && (secretsQuery.isLoading || queueResourcesQuery.isLoading))
    const resourcesError = storageResourcesQuery.isError
        || k8sResourcesQuery.isError
        || databaseResourcesQuery.isError
        || (cloud === 'aws' && (secretsQuery.isError || queueResourcesQuery.isError))

    return {
        cloudsQuery,
        status,
        runtimeLabel: runtimeEndpointLabel(cloud, status),
        runtimeState: runtimeLabelFor(status, statusQuery.isLoading),
        runtimeClass: runtimeClassFor(status, statusQuery.isLoading),
        runtimeDetail: status?.error ?? runtimeDetailFor(cloud, status),
        activeServices: serviceCards.filter((service) => service.status === 'available').length,
        activeServicesDetail: activeServicesDetailFor(cloud),
        resourceCount: (storageResourcesQuery.data?.length ?? 0)
            + (k8sResourcesQuery.data?.length ?? 0)
            + (databaseResourcesQuery.data?.length ?? 0)
            + (cloud === 'aws' ? (secretsQuery.data?.length ?? 0) + (queueResourcesQuery.data?.length ?? 0) : 0),
        resourceDetail: resourceDetailFor(cloud, status, statusQuery.isLoading, resourcesLoading, resourcesError),
        serviceCards,
    }
}
