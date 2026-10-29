import {
    type CacheCluster,
    CreateCacheClusterCommand,
    CreateReplicationGroupCommand,
    DeleteCacheClusterCommand,
    DeleteReplicationGroupCommand,
    DescribeCacheClustersCommand,
    DescribeReplicationGroupsCommand,
    type ElastiCacheClient,
    type Endpoint,
    type ReplicationGroup,
} from '@aws-sdk/client-elasticache'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {
    ELASTICACHE_DEFAULT_NODE_TYPE,
    ELASTICACHE_ENGINES,
    ELASTICACHE_NAME_MAX_LENGTH,
    ELASTICACHE_NAME_MESSAGE,
    ELASTICACHE_NAME_PATTERN,
    type ElastiCacheEngine,
    awsElastiCacheSchema,
} from '../cloud-spi/elastiCacheSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const GROUP_PREFIX = 'replication-group:'
const CLUSTER_PREFIX = 'cache-cluster:'
/** DescribeCacheClusters and DescribeReplicationGroups accept 20 to 100 records per page. */
const PAGE_SIZE = 100

/**
 * Valkey and Redis replication groups, and standalone cache clusters. The ids
 * carry the kind because the two are separate namespaces. DescribeCacheClusters
 * also returns every member node of a replication group, which belongs to its
 * group row, so only the clusters that are not members are listed.
 */
export class AwsElastiCacheAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'cache' as const

    constructor(private readonly elasticache: ElastiCacheClient) {}

    schema(): ServiceSchema {
        return awsElastiCacheSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const [groups, clusters] = await Promise.all([this.describeGroups(), this.describeClusters()])
        return filterBySearch([
            ...groups.map((group) => groupResource(group, clusters)),
            ...clusters.filter((cluster) => !cluster.ReplicationGroupId).map(clusterResource),
        ], query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const target = parseId(id)
        if (!target) return null
        try {
            if (target.kind === 'group') {
                const [group] = await this.describeGroups(target.name)
                if (!group) return null
                const memberId = group.MemberClusters?.[0]
                return groupResource(group, memberId ? await this.describeClusters(memberId) : [])
            }
            const [cluster] = await this.describeClusters(target.name)
            return cluster && !cluster.ReplicationGroupId ? clusterResource(cluster) : null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.name)
        validateName(name)
        const engine = engineValue(input.values.engine)
        const nodeType = stringValue(input.values.nodeType) || ELASTICACHE_DEFAULT_NODE_TYPE

        if (engine === 'memcached') {
            await this.elasticache.send(new CreateCacheClusterCommand({
                CacheClusterId: name,
                Engine: engine,
                CacheNodeType: nodeType,
                NumCacheNodes: 1,
            }))
            return this.created(`${CLUSTER_PREFIX}${name.toLowerCase()}`)
        }
        await this.elasticache.send(new CreateReplicationGroupCommand({
            ReplicationGroupId: name,
            ReplicationGroupDescription: stringValue(input.values.description) || name,
            Engine: engine,
            CacheNodeType: nodeType,
            NumCacheClusters: 1,
        }))
        return this.created(`${GROUP_PREFIX}${name.toLowerCase()}`)
    }

    async delete(id: string): Promise<void> {
        const target = parseId(id)
        if (!target) throw new ValidationError(`${id} is not a replication group or cache cluster id`)
        if (target.kind === 'group') {
            await this.elasticache.send(new DeleteReplicationGroupCommand({ReplicationGroupId: target.name}))
        } else {
            await this.elasticache.send(new DeleteCacheClusterCommand({CacheClusterId: target.name}))
        }
    }

    async health(): Promise<void> {
        await this.elasticache.send(new DescribeCacheClustersCommand({MaxRecords: 20}))
    }

    private async created(id: string): Promise<CloudResource> {
        const resource = await this.get(id)
        if (!resource) throw new NotFoundError(`ElastiCache did not return ${id} after creating it`)
        return resource
    }

    private async describeGroups(id?: string): Promise<ReplicationGroup[]> {
        const groups: ReplicationGroup[] = []
        let marker: string | undefined
        do {
            const page = await this.elasticache.send(new DescribeReplicationGroupsCommand({
                ...(id ? {ReplicationGroupId: id} : {MaxRecords: PAGE_SIZE}),
                ...(marker ? {Marker: marker} : {}),
            }))
            groups.push(...(page.ReplicationGroups ?? []))
            marker = page.Marker
        } while (marker)
        return groups
    }

    private async describeClusters(id?: string): Promise<CacheCluster[]> {
        const clusters: CacheCluster[] = []
        let marker: string | undefined
        do {
            const page = await this.elasticache.send(new DescribeCacheClustersCommand({
                ShowCacheNodeInfo: true,
                ...(id ? {CacheClusterId: id} : {MaxRecords: PAGE_SIZE}),
                ...(marker ? {Marker: marker} : {}),
            }))
            clusters.push(...(page.CacheClusters ?? []))
            marker = page.Marker
        } while (marker)
        return clusters
    }
}

function groupResource(group: ReplicationGroup, clusters: CacheCluster[]): CloudResource {
    const id = group.ReplicationGroupId ?? ''
    const members = new Set(group.MemberClusters ?? [])
    // The group does not report an engine version; its member nodes do.
    const member = clusters.find((cluster) => cluster.CacheClusterId && members.has(cluster.CacheClusterId))
    const nodeGroup = group.NodeGroups?.[0]
    return {
        id: `${GROUP_PREFIX}${id}`,
        name: id,
        cloud: 'aws',
        service: 'cache',
        type: 'replication-group',
        region: regionFromArn(group.ARN),
        createdAt: group.ReplicationGroupCreateTime?.toISOString() ?? null,
        status: group.Status ?? null,
        engine: group.Engine ?? member?.Engine ?? null,
        version: member?.EngineVersion ?? null,
        instanceClass: group.CacheNodeType ?? null,
        metadata: {
            provider: 'aws',
            arn: group.ARN,
            description: group.Description,
            endpoint: formatEndpoint(group.ConfigurationEndpoint ?? nodeGroup?.PrimaryEndpoint),
            readerEndpoint: formatEndpoint(nodeGroup?.ReaderEndpoint),
            memberClusters: group.MemberClusters ?? [],
            clusterMode: group.ClusterMode,
            automaticFailover: group.AutomaticFailover,
            multiAz: group.MultiAZ,
            transitEncryptionEnabled: group.TransitEncryptionEnabled,
            atRestEncryptionEnabled: group.AtRestEncryptionEnabled,
            authTokenEnabled: group.AuthTokenEnabled,
            snapshotRetentionLimit: group.SnapshotRetentionLimit,
        },
    }
}

function clusterResource(cluster: CacheCluster): CloudResource {
    const id = cluster.CacheClusterId ?? ''
    return {
        id: `${CLUSTER_PREFIX}${id}`,
        name: id,
        cloud: 'aws',
        service: 'cache',
        type: 'cache-cluster',
        region: regionFromArn(cluster.ARN),
        createdAt: cluster.CacheClusterCreateTime?.toISOString() ?? null,
        status: cluster.CacheClusterStatus ?? null,
        engine: cluster.Engine ?? null,
        version: cluster.EngineVersion ?? null,
        instanceClass: cluster.CacheNodeType ?? null,
        metadata: {
            provider: 'aws',
            arn: cluster.ARN,
            endpoint: formatEndpoint(cluster.ConfigurationEndpoint ?? cluster.CacheNodes?.[0]?.Endpoint),
            nodeCount: cluster.NumCacheNodes,
            availabilityZone: cluster.PreferredAvailabilityZone,
            transitEncryptionEnabled: cluster.TransitEncryptionEnabled,
            atRestEncryptionEnabled: cluster.AtRestEncryptionEnabled,
        },
    }
}

function parseId(id: string): {kind: 'group' | 'cluster'; name: string} | null {
    if (id.startsWith(GROUP_PREFIX) && id.length > GROUP_PREFIX.length) return {kind: 'group', name: id.slice(GROUP_PREFIX.length)}
    if (id.startsWith(CLUSTER_PREFIX) && id.length > CLUSTER_PREFIX.length) return {kind: 'cluster', name: id.slice(CLUSTER_PREFIX.length)}
    return null
}

function validateName(name: string): void {
    if (!name) throw new ValidationError('name is required')
    if (name.length > ELASTICACHE_NAME_MAX_LENGTH || !new RegExp(ELASTICACHE_NAME_PATTERN).test(name)) {
        throw new ValidationError(`name is invalid: ${ELASTICACHE_NAME_MESSAGE}`)
    }
}

function engineValue(value: unknown): ElastiCacheEngine {
    const engine = stringValue(value)
    if (!(ELASTICACHE_ENGINES as readonly string[]).includes(engine)) {
        throw new ValidationError(`engine must be one of ${ELASTICACHE_ENGINES.join(', ')}`)
    }
    return engine as ElastiCacheEngine
}

function formatEndpoint(endpoint?: Endpoint): string | null {
    return endpoint?.Address ? `${endpoint.Address}${endpoint.Port ? `:${endpoint.Port}` : ''}` : null
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized))
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function isNotFound(error: unknown): boolean {
    const name = (error as {name?: string} | null)?.name
    return name === 'CacheClusterNotFoundFault' || name === 'CacheClusterNotFound' || name === 'ReplicationGroupNotFoundFault'
}
