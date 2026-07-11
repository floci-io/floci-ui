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
    const serverlessResourcesQuery = useCloudConsoleResourcesQuery({...queryContext, service: 'serverless'})
    const secretsQuery = useSecretsQuery(cloud === 'aws' && status?.runtime === 'reachable')
    const serviceCards = useMemo<ConsoleServiceCard[]>(() => {
        const storage = servicesQuery.data?.find((service) => service.service === 'storage')
        const k8s = servicesQuery.data?.find((service) => service.service === 'k8s')
        const database = servicesQuery.data?.find((service) => service.service === 'database')
        const queueSvc = servicesQuery.data?.find((service) => service.service === 'queue')
        const serverlessSvc = servicesQuery.data?.find((service) => service.service === 'serverless')

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
            }] : []),
            ...(queueSvc ? [{
                id: 'queue',
                label: queueSvc.displayName ?? 'Queue',
                status: queueSvc.availability,
                count: queueResourcesQuery.data?.length,
                icon: MessageSquare,
                route: `/cloud-explorer/${cloud}/queue`,
                meta: serviceMetaLabel(status, queueResourcesQuery.isLoading, 'queues'),
            }] : []),
            ...(serverlessSvc ? [{
                id: 'serverless',
                label: serverlessSvc.displayName ?? 'Serverless',
                status: serverlessSvc.availability,
                count: serverlessResourcesQuery.data?.length,
                icon: Zap,
                route: `/cloud-explorer/${cloud}/serverless`,
                meta: serviceMetaLabel(status, serverlessResourcesQuery.isLoading, 'functions'),
            }] : []),
        ]
    }, [
        databaseResourcesQuery.data,
        databaseResourcesQuery.isLoading,
        cloud,
        k8sResourcesQuery.data,
        k8sResourcesQuery.isLoading,
        queueResourcesQuery.data,
        queueResourcesQuery.isLoading,
        serverlessResourcesQuery.data,
        serverlessResourcesQuery.isLoading,
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
        || (cloud === 'aws' && secretsQuery.isLoading)
    const resourcesError = storageResourcesQuery.isError
        || k8sResourcesQuery.isError
        || databaseResourcesQuery.isError
        || (cloud === 'aws' && secretsQuery.isError)

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
            + (cloud === 'aws' ? (secretsQuery.data?.length ?? 0) : 0),
        resourceDetail: resourceDetailFor(cloud, status, statusQuery.isLoading, resourcesLoading, resourcesError),
        serviceCards,
    }
}
