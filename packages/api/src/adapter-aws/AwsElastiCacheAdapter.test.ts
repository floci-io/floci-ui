import {describe, expect, test} from 'bun:test'
import {
    CreateCacheClusterCommand,
    CreateReplicationGroupCommand,
    DeleteCacheClusterCommand,
    DeleteReplicationGroupCommand,
    DescribeCacheClustersCommand,
    DescribeReplicationGroupsCommand,
    type ElastiCacheClient,
} from '@aws-sdk/client-elasticache'
import {AwsElastiCacheAdapter} from './AwsElastiCacheAdapter'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal ElastiCacheClient stub that records the commands it was sent. */
function stubElastiCache(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as ElastiCacheClient
    return {client, sent}
}

class NotFoundFault extends Error {
    constructor(readonly name: string) {
        super(name)
    }
}

// Shapes as Floci returns them for a Valkey group and a Memcached cluster.
const group = {
    ReplicationGroupId: 'rg1',
    Description: 'demo',
    Status: 'available',
    MemberClusters: ['rg1-001'],
    NodeGroups: [{
        NodeGroupId: '0001',
        PrimaryEndpoint: {Address: 'localhost', Port: 6379},
        ReaderEndpoint: {Address: 'localhost', Port: 6380},
    }],
    AutomaticFailover: 'disabled',
    MultiAZ: 'disabled',
    ClusterMode: 'disabled',
    CacheNodeType: 'cache.t3.micro',
    Engine: 'valkey',
    ARN: 'arn:aws:elasticache:us-east-1:000000000000:replicationgroup:rg1',
    ReplicationGroupCreateTime: new Date('2026-10-29T02:10:00.000Z'),
}

const member = {
    CacheClusterId: 'rg1-001',
    CacheNodeType: 'cache.t3.micro',
    Engine: 'valkey',
    EngineVersion: '8.1',
    CacheClusterStatus: 'available',
    ReplicationGroupId: 'rg1',
}

const memcached = {
    CacheClusterId: 'mc1',
    ConfigurationEndpoint: {Address: 'localhost', Port: 11211},
    CacheNodeType: 'cache.t3.micro',
    Engine: 'memcached',
    EngineVersion: '1.6.22',
    CacheClusterStatus: 'available',
    NumCacheNodes: 1,
    CacheNodes: [{CacheNodeId: '0001', Endpoint: {Address: 'localhost', Port: 11211}}],
    CacheClusterCreateTime: new Date('2026-10-29T02:14:12.382Z'),
    ARN: 'arn:aws:elasticache:us-east-1:000000000000:cluster:mc1',
}

function describeHandler(command: object): SendResult {
    if (command instanceof DescribeReplicationGroupsCommand) return {ReplicationGroups: [group]}
    if (command instanceof DescribeCacheClustersCommand) return {CacheClusters: [memcached, member]}
    throw new Error(`unexpected ${command.constructor.name}`)
}

describe('AwsElastiCacheAdapter.list', () => {
    test('lists groups and standalone clusters, hiding the nodes a group already owns', async () => {
        const {client} = stubElastiCache(describeHandler)

        const resources = await new AwsElastiCacheAdapter(client).list()

        expect(resources.map((r) => r.id)).toEqual(['replication-group:rg1', 'cache-cluster:mc1'])
        expect(resources[0]).toMatchObject({
            name: 'rg1',
            type: 'replication-group',
            region: 'us-east-1',
            status: 'available',
            engine: 'valkey',
            version: '8.1',
            instanceClass: 'cache.t3.micro',
            createdAt: '2026-10-29T02:10:00.000Z',
        })
        expect(resources[0].metadata).toMatchObject({endpoint: 'localhost:6379', readerEndpoint: 'localhost:6380', memberClusters: ['rg1-001']})
        expect(resources[1]).toMatchObject({type: 'cache-cluster', engine: 'memcached', version: '1.6.22'})
        expect(resources[1].metadata).toMatchObject({endpoint: 'localhost:11211', nodeCount: 1})
    })

    test('is empty when nothing exists', async () => {
        const {client} = stubElastiCache((command) =>
            command instanceof DescribeReplicationGroupsCommand ? {ReplicationGroups: []} : {CacheClusters: []})

        expect(await new AwsElastiCacheAdapter(client).list()).toEqual([])
    })

    test('follows the marker of every page', async () => {
        const {client, sent} = stubElastiCache((command) => {
            if (command instanceof DescribeReplicationGroupsCommand) return {ReplicationGroups: []}
            const marker = (command as DescribeCacheClustersCommand).input.Marker
            return marker
                ? {CacheClusters: [{...memcached, CacheClusterId: 'mc2'}]}
                : {CacheClusters: [memcached], Marker: 'next'}
        })

        const resources = await new AwsElastiCacheAdapter(client).list()

        expect(resources.map((r) => r.name)).toEqual(['mc1', 'mc2'])
        expect(sent.filter((c) => c instanceof DescribeCacheClustersCommand)).toHaveLength(2)
    })

    test('searches by name', async () => {
        const {client} = stubElastiCache(describeHandler)

        const resources = await new AwsElastiCacheAdapter(client).list({search: 'MC'})

        expect(resources.map((r) => r.name)).toEqual(['mc1'])
    })

    test('fails rather than returning a partial list when one describe fails', async () => {
        const {client} = stubElastiCache((command) => {
            if (command instanceof DescribeCacheClustersCommand) throw new Error('boom')
            return {ReplicationGroups: [group]}
        })

        await expect(new AwsElastiCacheAdapter(client).list()).rejects.toThrow('boom')
    })
})

describe('AwsElastiCacheAdapter.get', () => {
    test('reads a group and takes its version from a member node', async () => {
        const {client} = stubElastiCache((command) =>
            command instanceof DescribeReplicationGroupsCommand ? {ReplicationGroups: [group]} : {CacheClusters: [member]})

        const resource = await new AwsElastiCacheAdapter(client).get('replication-group:rg1')

        expect(resource).toMatchObject({id: 'replication-group:rg1', version: '8.1'})
    })

    test('answers null for a missing resource and for an id without a kind', async () => {
        const {client} = stubElastiCache(() => {
            throw new NotFoundFault('ReplicationGroupNotFoundFault')
        })
        const adapter = new AwsElastiCacheAdapter(client)

        expect(await adapter.get('replication-group:nope')).toBeNull()
        expect(await adapter.get('rg1')).toBeNull()
    })

    test('does not expose a group member as a cluster of its own', async () => {
        const {client} = stubElastiCache(() => ({CacheClusters: [member]}))

        expect(await new AwsElastiCacheAdapter(client).get('cache-cluster:rg1-001')).toBeNull()
    })

    test('rethrows other failures', async () => {
        const {client} = stubElastiCache(() => {
            throw new Error('boom')
        })

        await expect(new AwsElastiCacheAdapter(client).get('cache-cluster:mc1')).rejects.toThrow('boom')
    })
})

describe('AwsElastiCacheAdapter.create', () => {
    test('creates a one node replication group for Valkey and Redis', async () => {
        const {client, sent} = stubElastiCache((command) => {
            if (command instanceof CreateReplicationGroupCommand) return {}
            return describeHandler(command)
        })

        const created = await new AwsElastiCacheAdapter(client).create({values: {name: 'rg1', engine: 'valkey'}})

        expect(created.id).toBe('replication-group:rg1')
        expect((sent[0] as CreateReplicationGroupCommand).input).toEqual({
            ReplicationGroupId: 'rg1',
            ReplicationGroupDescription: 'rg1',
            Engine: 'valkey',
            CacheNodeType: 'cache.t3.micro',
            NumCacheClusters: 1,
        })
    })

    test('creates a one node cache cluster for Memcached', async () => {
        const {client, sent} = stubElastiCache((command) => {
            if (command instanceof CreateCacheClusterCommand) return {}
            return describeHandler(command)
        })

        const created = await new AwsElastiCacheAdapter(client).create({values: {name: 'MC1', engine: 'memcached', nodeType: 'cache.m5.large'}})

        expect(created.id).toBe('cache-cluster:mc1')
        expect((sent[0] as CreateCacheClusterCommand).input).toEqual({
            CacheClusterId: 'MC1',
            Engine: 'memcached',
            CacheNodeType: 'cache.m5.large',
            NumCacheNodes: 1,
        })
    })

    test('rejects a bad name or engine before calling AWS', async () => {
        const {client, sent} = stubElastiCache(() => ({}))
        const adapter = new AwsElastiCacheAdapter(client)

        await expect(adapter.create({values: {engine: 'valkey'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {name: '1bad', engine: 'valkey'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {name: 'bad-', engine: 'valkey'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {name: 'ok', engine: 'dragonfly'}})).rejects.toBeInstanceOf(ValidationError)
        expect(sent).toHaveLength(0)
    })

    test('reports a created resource it cannot read back', async () => {
        const {client} = stubElastiCache((command) =>
            command instanceof DescribeReplicationGroupsCommand ? {ReplicationGroups: []} : {})

        await expect(new AwsElastiCacheAdapter(client).create({values: {name: 'rg1', engine: 'valkey'}}))
            .rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('AwsElastiCacheAdapter.delete', () => {
    test('deletes a group or a cluster by the kind in the id', async () => {
        const {client, sent} = stubElastiCache(() => ({}))
        const adapter = new AwsElastiCacheAdapter(client)

        await adapter.delete('replication-group:rg1')
        await adapter.delete('cache-cluster:mc1')

        expect(sent[0]).toBeInstanceOf(DeleteReplicationGroupCommand)
        expect((sent[0] as DeleteReplicationGroupCommand).input).toEqual({ReplicationGroupId: 'rg1'})
        expect(sent[1]).toBeInstanceOf(DeleteCacheClusterCommand)
        expect((sent[1] as DeleteCacheClusterCommand).input).toEqual({CacheClusterId: 'mc1'})
    })

    test('rejects an id without a kind', async () => {
        const {client, sent} = stubElastiCache(() => ({}))

        await expect(new AwsElastiCacheAdapter(client).delete('rg1')).rejects.toBeInstanceOf(ValidationError)
        expect(sent).toHaveLength(0)
    })
})
