import {
    CreateClusterCommand,
    DeleteClusterCommand,
    DescribeClustersCommand,
    DescribeServicesCommand,
    DescribeTasksCommand,
    ListClustersCommand,
    ListServicesCommand,
    ListTasksCommand,
    type Cluster,
    type ECSClient,
    type Service,
    type Task,
} from '@aws-sdk/client-ecs'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {
    ECS_CLUSTER_NAME_MAX_LENGTH,
    ECS_CLUSTER_NAME_PATTERN,
    awsContainersSchema,
} from '../cloud-spi/containersSchema'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const CLUSTER_NAME = new RegExp(ECS_CLUSTER_NAME_PATTERN)
const DESCRIBE_CLUSTERS_BATCH = 100
const DESCRIBE_SERVICES_BATCH = 10
const DESCRIBE_TASKS_BATCH = 100
const LIST_MAX_RESULTS = 100

const SERVICES_COLLECTION = 'services'
const TASKS_COLLECTION = 'tasks'

/**
 * Amazon ECS through the provider-neutral Containers category — verified
 * against Floci core 2.1.0 with `FLOCI_SERVICES_ECS_MOCK=true`.
 *
 * Notes from probing the runtime:
 *  - `CreateCluster` is idempotent, as on AWS: creating an existing name returns
 *    that cluster instead of a conflict.
 *  - A missing cluster is `ClusterNotFoundException` with HTTP 400, so
 *    `awsErrors.ts` maps the name; `DescribeClusters` reports an unknown name as
 *    an empty result rather than a `failures` entry, so `get` treats both as
 *    missing.
 *  - `DeleteCluster` is refused with `ClusterContainsTasksException` while tasks
 *    run, which the route reports as a conflict.
 *  - ECS clusters carry no creation timestamp, so `createdAt` stays null.
 */
export class AwsEcsAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'containers' as const

    readonly documents: DocumentStoreAdapter

    constructor(private readonly ecs: ECSClient) {
        this.documents = new EcsClusterStore(ecs)
    }

    schema(): ServiceSchema {
        return awsContainersSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const arns = filterBySearch(await this.listClusterArns(), query.search)
        const clusters: CloudResource[] = []

        for (const batch of chunk(arns, DESCRIBE_CLUSTERS_BATCH)) {
            clusters.push(...(await describeClusters(this.ecs, batch)).map(toResource))
        }
        return clusters
    }

    async get(id: string): Promise<CloudResource | null> {
        const [cluster] = await describeClusters(this.ecs, [id])
        return cluster ? toResource(cluster) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const res = await this.ecs.send(new CreateClusterCommand({clusterName: clusterName(input.values.clusterName)}))
        if (!res.cluster) throw new RuntimeError('ECS did not return the cluster it created')
        return toResource(res.cluster)
    }

    async delete(id: string): Promise<void> {
        await this.ecs.send(new DeleteClusterCommand({cluster: id}))
    }

    /** One page of ARNs is enough to prove liveness without the describe fan-out of `list`. */
    async health(): Promise<void> {
        await this.ecs.send(new ListClustersCommand({maxResults: 1}))
    }

    private async listClusterArns(): Promise<string[]> {
        const arns: string[] = []
        const seenTokens = new Set<string>()
        let nextToken: string | undefined

        do {
            const res = await this.ecs.send(new ListClustersCommand({nextToken, maxResults: LIST_MAX_RESULTS}))
            arns.push(...(res.clusterArns ?? []))
            nextToken = res.nextToken
            if (nextToken) {
                if (seenTokens.has(nextToken)) throw new RuntimeError('ECS ListClusters repeated a continuation token')
                seenTokens.add(nextToken)
            }
        } while (nextToken)

        return arns
    }
}

/**
 * A cluster holds two fixed collections, services and tasks, so the nested
 * store has exactly two collection ids and no create or delete: creating a
 * service needs a task definition and running a task is a launch, neither of
 * which is a collection write.
 */
class EcsClusterStore implements DocumentStoreAdapter {
    constructor(private readonly ecs: ECSClient) {}

    async listCollections(clusterId: string): Promise<CollectionPage<ChildCollection>> {
        const [cluster] = await describeClusters(this.ecs, [clusterId])
        if (!cluster) throw new NotFoundError(`Cluster not found: ${clusterId}`)

        return {
            items: [
                {
                    id: SERVICES_COLLECTION,
                    name: 'Services',
                    parentId: clusterId,
                    createdAt: null,
                    metadata: {activeServicesCount: cluster.activeServicesCount ?? 0},
                },
                {
                    id: TASKS_COLLECTION,
                    name: 'Tasks',
                    parentId: clusterId,
                    createdAt: null,
                    metadata: {
                        runningTasksCount: cluster.runningTasksCount ?? 0,
                        pendingTasksCount: cluster.pendingTasksCount ?? 0,
                    },
                },
            ],
            nextCursor: null,
        }
    }

    async listItems(clusterId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        if (collectionId === SERVICES_COLLECTION) return this.listServices(clusterId, page)
        if (collectionId === TASKS_COLLECTION) return this.listTasks(clusterId, page)
        throw new NotFoundError(`Unknown ECS collection ${collectionId}; use ${SERVICES_COLLECTION} or ${TASKS_COLLECTION}`)
    }

    private async listServices(clusterId: string, page: PageQuery): Promise<CollectionPage<ChildItem>> {
        const listed = await this.ecs.send(new ListServicesCommand({
            cluster: clusterId,
            nextToken: page.cursor,
            maxResults: pageSize(page),
        }))
        const arns = listed.serviceArns ?? []
        const described = await Promise.all(chunk(arns, DESCRIBE_SERVICES_BATCH).map((services) =>
            this.ecs.send(new DescribeServicesCommand({cluster: clusterId, services, include: ['TAGS']})),
        ))
        const byArn = new Map(described.flatMap((res) => res.services ?? []).map((service) => [service.serviceArn, service]))

        return {
            items: arns.flatMap((arn) => {
                const service = byArn.get(arn)
                return service ? [toServiceItem(service)] : []
            }),
            nextCursor: listed.nextToken ?? null,
        }
    }

    private async listTasks(clusterId: string, page: PageQuery): Promise<CollectionPage<ChildItem>> {
        const listed = await this.ecs.send(new ListTasksCommand({
            cluster: clusterId,
            nextToken: page.cursor,
            maxResults: pageSize(page),
        }))
        const arns = listed.taskArns ?? []
        const described = await Promise.all(chunk(arns, DESCRIBE_TASKS_BATCH).map((tasks) =>
            this.ecs.send(new DescribeTasksCommand({cluster: clusterId, tasks, include: ['TAGS']})),
        ))
        const byArn = new Map(described.flatMap((res) => res.tasks ?? []).map((task) => [task.taskArn, task]))

        return {
            items: arns.flatMap((arn) => {
                const task = byArn.get(arn)
                return task ? [toTaskItem(task)] : []
            }),
            nextCursor: listed.nextToken ?? null,
        }
    }
}

async function describeClusters(ecs: ECSClient, names: string[]): Promise<Cluster[]> {
    const res = await ecs.send(new DescribeClustersCommand({
        clusters: names,
        include: ['TAGS', 'SETTINGS', 'STATISTICS'],
    }))
    return res.clusters ?? []
}

function toResource(cluster: Cluster): CloudResource {
    const name = cluster.clusterName ?? ''
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'containers',
        type: 'ecs-cluster',
        region: cluster.clusterArn?.split(':')[3] || null,
        createdAt: null,
        status: cluster.status ?? null,
        metadata: {
            provider: 'aws',
            arn: cluster.clusterArn,
            activeServicesCount: cluster.activeServicesCount ?? 0,
            runningTasksCount: cluster.runningTasksCount ?? 0,
            pendingTasksCount: cluster.pendingTasksCount ?? 0,
            registeredContainerInstancesCount: cluster.registeredContainerInstancesCount ?? 0,
            capacityProviders: cluster.capacityProviders ?? [],
            settings: (cluster.settings ?? []).map(({name: key, value}) => ({key, value})),
            statistics: (cluster.statistics ?? []).map(({name: key, value}) => ({key, value})),
            tags: (cluster.tags ?? []).map(({key, value}) => ({key, value})),
        },
    }
}

function toServiceItem(service: Service): ChildItem {
    const createdAt = service.createdAt?.toISOString() ?? null
    return {
        id: service.serviceName ?? '',
        collectionId: SERVICES_COLLECTION,
        timestamp: createdAt,
        body: {
            serviceName: service.serviceName,
            status: service.status,
            desiredCount: service.desiredCount,
            runningCount: service.runningCount,
            pendingCount: service.pendingCount,
            launchType: service.launchType,
            schedulingStrategy: service.schedulingStrategy,
            taskDefinition: service.taskDefinition,
            createdAt,
        },
        metadata: {arn: service.serviceArn, tags: tagList(service.tags)},
    }
}

function toTaskItem(task: Task): ChildItem {
    const createdAt = task.createdAt?.toISOString() ?? null
    const arn = task.taskArn ?? ''
    return {
        // The final ARN segment is what `StopTask` and the console call the task id.
        id: arn.split('/').pop() ?? arn,
        collectionId: TASKS_COLLECTION,
        timestamp: createdAt,
        body: {
            lastStatus: task.lastStatus,
            desiredStatus: task.desiredStatus,
            taskDefinitionArn: task.taskDefinitionArn,
            launchType: task.launchType,
            group: task.group,
            cpu: task.cpu,
            memory: task.memory,
            createdAt,
            startedAt: task.startedAt?.toISOString() ?? null,
            stoppedAt: task.stoppedAt?.toISOString() ?? null,
            stoppedReason: task.stoppedReason,
            containers: (task.containers ?? []).map((container) => ({
                name: container.name,
                image: container.image,
                lastStatus: container.lastStatus,
                exitCode: container.exitCode,
            })),
        },
        metadata: {arn, tags: tagList(task.tags)},
    }
}

function tagList(tags?: Array<{key?: string; value?: string}>): Array<{key?: string; value?: string}> {
    return (tags ?? []).map(({key, value}) => ({key, value}))
}

function clusterName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new ValidationError('clusterName is required')
    if (name.length > ECS_CLUSTER_NAME_MAX_LENGTH || !CLUSTER_NAME.test(name)) {
        throw new ValidationError(
            `Use a valid ECS cluster name: up to ${ECS_CLUSTER_NAME_MAX_LENGTH} letters, numbers, hyphens and underscores.`,
        )
    }
    return name
}

/** ECS lists at most 100 per call; a larger requested page is capped and the cursor continues it. */
function pageSize(page: PageQuery): number {
    return Math.min(page.limit ?? LIST_MAX_RESULTS, LIST_MAX_RESULTS)
}

/** ECS cluster ARNs end in `cluster/<name>`, so the search can run before any describe call. */
function filterBySearch(arns: string[], search?: string): string[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return arns
    return arns.filter((arn) => (arn.split('/').pop() ?? arn).toLowerCase().includes(normalized))
}

function chunk<T>(items: T[], size: number): T[][] {
    const batches: T[][] = []
    for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size))
    return batches
}
