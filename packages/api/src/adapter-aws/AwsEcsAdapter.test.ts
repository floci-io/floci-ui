import {describe, expect, test} from 'bun:test'
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
} from '@aws-sdk/client-ecs'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {AwsEcsAdapter} from './AwsEcsAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

const CLUSTER_ARN = 'arn:aws:ecs:us-east-1:000000000000:cluster'

describe('AwsEcsAdapter', () => {
    test('identifies ECS as the AWS containers adapter', () => {
        const adapter = createAdapter()

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('containers')
        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'containers', displayName: 'ECS Clusters'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('follows nextToken, then describes clusters in batches of 100', async () => {
        const listTokens: Array<string | undefined> = []
        const describeSizes: number[] = []
        const names = Array.from({length: 150}, (_, index) => `c${index}`)
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListClustersCommand) {
                listTokens.push(command.input.nextToken)
                return command.input.nextToken
                    ? {clusterArns: names.slice(100).map(arn)}
                    : {clusterArns: names.slice(0, 100).map(arn), nextToken: 'page-2'}
            }
            if (command instanceof DescribeClustersCommand) {
                describeSizes.push(command.input.clusters?.length ?? 0)
                return {clusters: (command.input.clusters ?? []).map((arnValue) => cluster(nameOf(arnValue)))}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resources = await adapter.list()

        expect(resources).toHaveLength(150)
        expect(listTokens).toEqual([undefined, 'page-2'])
        expect(describeSizes).toEqual([100, 50])
    })

    test('rejects a repeated ListClusters continuation token', async () => {
        const adapter = createAdapter(async () => ({clusterArns: [arn('web')], nextToken: 'again'}))

        await expect(adapter.list()).rejects.toThrow('ECS ListClusters repeated a continuation token')
    })

    test('maps a cluster to the shared resource shape', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeClustersCommand) {
                return {
                    clusters: [{
                        ...cluster('web'),
                        activeServicesCount: 2,
                        runningTasksCount: 3,
                        pendingTasksCount: 1,
                        registeredContainerInstancesCount: 0,
                        settings: [{name: 'containerInsights', value: 'disabled'}],
                        tags: [{key: 'env', value: 'dev'}],
                    }],
                }
            }
            return {}
        })

        await expect(adapter.get('web')).resolves.toEqual({
            id: 'web',
            name: 'web',
            cloud: 'aws',
            service: 'containers',
            type: 'ecs-cluster',
            region: 'us-east-1',
            createdAt: null,
            status: 'ACTIVE',
            metadata: {
                provider: 'aws',
                arn: `${CLUSTER_ARN}/web`,
                activeServicesCount: 2,
                runningTasksCount: 3,
                pendingTasksCount: 1,
                registeredContainerInstancesCount: 0,
                capacityProviders: [],
                settings: [{key: 'containerInsights', value: 'disabled'}],
                statistics: [],
                tags: [{key: 'env', value: 'dev'}],
            },
        })
    })

    test('filters by name before issuing describe requests', async () => {
        const described: string[][] = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListClustersCommand) return {clusterArns: ['web', 'worker', 'batch'].map(arn)}
            if (command instanceof DescribeClustersCommand) {
                described.push(command.input.clusters ?? [])
                return {clusters: [cluster('worker')]}
            }
            return {}
        })

        await adapter.list({search: 'WOR'})

        expect(described).toEqual([[arn('worker')]])
    })

    test('treats an unknown cluster as missing, with or without a failure entry', async () => {
        const empty = createAdapter(async () => ({clusters: [], failures: []}))
        const failed = createAdapter(async () => ({clusters: [], failures: [{arn: 'ghost', reason: 'MISSING'}]}))

        await expect(empty.get('ghost')).resolves.toBeNull()
        await expect(failed.get('ghost')).resolves.toBeNull()
    })

    test('creates a cluster from the validated name and returns what ECS answered', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {cluster: cluster('web')}
        })

        const created = await adapter.create({values: {clusterName: ' web '}})

        expect(created).toMatchObject({id: 'web', status: 'ACTIVE'})
        expect(sent).toHaveLength(1)
        expect((sent[0] as CreateClusterCommand).input.clusterName).toBe('web')
    })

    test('rejects missing and malformed cluster names before any request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        for (const clusterName of [undefined, '', '   ', 'has space', 'dot.name', 'a'.repeat(256)]) {
            await expect(adapter.create({values: {clusterName}})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(sent).toEqual([])
    })

    test('deletes by cluster name', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        await adapter.delete('web')

        expect(sent[0]).toBeInstanceOf(DeleteClusterCommand)
        expect((sent[0] as DeleteClusterCommand).input.cluster).toBe('web')
    })

    test('health checks only the list operation', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {clusterArns: []}
        })

        await adapter.health()

        expect(sent).toHaveLength(1)
        expect((sent[0] as ListClustersCommand).input.maxResults).toBe(1)
    })
})

describe('AwsEcsAdapter child collections', () => {
    test('exposes fixed services and tasks collections with the cluster counts', async () => {
        const adapter = createAdapter(async () => ({
            clusters: [{...cluster('web'), activeServicesCount: 2, runningTasksCount: 3, pendingTasksCount: 1}],
        }))

        const page = await adapter.documents.listCollections('web')

        expect(page.nextCursor).toBeNull()
        expect(page.items).toEqual([
            {id: 'services', name: 'Services', parentId: 'web', createdAt: null, metadata: {activeServicesCount: 2}},
            {
                id: 'tasks',
                name: 'Tasks',
                parentId: 'web',
                createdAt: null,
                metadata: {runningTasksCount: 3, pendingTasksCount: 1},
            },
        ])
    })

    test('a missing cluster is not found rather than an empty list', async () => {
        const adapter = createAdapter(async () => ({clusters: [], failures: []}))

        await expect(adapter.documents.listCollections('ghost')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('an unknown collection id is not found', async () => {
        const adapter = createAdapter()

        await expect(adapter.documents.listItems('web', 'deployments')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('lists services in order, describing at most 10 per request and passing the cursor through', async () => {
        const describeSizes: number[] = []
        let listInput: ListServicesCommand['input'] | undefined
        const names = Array.from({length: 25}, (_, index) => `svc-${index}`)
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListServicesCommand) {
                listInput = command.input
                return {serviceArns: names.map(serviceArn), nextToken: 'next'}
            }
            if (command instanceof DescribeServicesCommand) {
                describeSizes.push(command.input.services?.length ?? 0)
                // Answer each batch in reverse so ordering must come from the list call.
                return {
                    services: [...(command.input.services ?? [])].reverse().map((value) => ({
                        serviceArn: value,
                        serviceName: value.split('/').pop(),
                        status: 'ACTIVE',
                        desiredCount: 1,
                        runningCount: 1,
                        pendingCount: 0,
                        createdAt: new Date('2026-10-01T00:00:00.000Z'),
                    })),
                }
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const page = await adapter.documents.listItems('web', 'services', {cursor: 'token', limit: 500})

        expect(listInput).toMatchObject({cluster: 'web', nextToken: 'token', maxResults: 100})
        expect(describeSizes).toEqual([10, 10, 5])
        expect(page.items.map((item) => item.id)).toEqual(names)
        expect(page.nextCursor).toBe('next')
        expect(page.items[0]).toEqual({
            id: 'svc-0',
            collectionId: 'services',
            timestamp: '2026-10-01T00:00:00.000Z',
            body: {
                serviceName: 'svc-0',
                status: 'ACTIVE',
                desiredCount: 1,
                runningCount: 1,
                pendingCount: 0,
                launchType: undefined,
                schedulingStrategy: undefined,
                taskDefinition: undefined,
                createdAt: '2026-10-01T00:00:00.000Z',
            },
            metadata: {arn: serviceArn('svc-0'), tags: []},
        })
    })

    test('lists tasks and drops one that vanished between list and describe', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListTasksCommand) {
                return {taskArns: [taskArn('aaa'), taskArn('gone'), taskArn('bbb')]}
            }
            if (command instanceof DescribeTasksCommand) {
                return {
                    tasks: [
                        {
                            taskArn: taskArn('bbb'),
                            lastStatus: 'STOPPED',
                            desiredStatus: 'STOPPED',
                            stoppedReason: 'Task stopped by user',
                            containers: [{name: 'app', image: 'nginx:latest', lastStatus: 'STOPPED', exitCode: 0}],
                        },
                        {taskArn: taskArn('aaa'), lastStatus: 'RUNNING', desiredStatus: 'RUNNING', group: 'service:s1'},
                    ],
                    failures: [{arn: taskArn('gone'), reason: 'MISSING'}],
                }
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const page = await adapter.documents.listItems('web', 'tasks')

        expect(page.items.map((item) => item.id)).toEqual(['aaa', 'bbb'])
        expect(page.items[0]).toMatchObject({collectionId: 'tasks', body: {lastStatus: 'RUNNING', group: 'service:s1'}})
        expect(page.items[1].body).toMatchObject({
            stoppedReason: 'Task stopped by user',
            containers: [{name: 'app', image: 'nginx:latest', lastStatus: 'STOPPED', exitCode: 0}],
        })
        expect(page.nextCursor).toBeNull()
    })

    test('an empty service list issues no describe request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {serviceArns: []}
        })

        const page = await adapter.documents.listItems('web', 'services')

        expect(page).toEqual({items: [], nextCursor: null})
        expect(sent).toHaveLength(1)
    })
})

function arn(name: string): string {
    return `${CLUSTER_ARN}/${name}`
}

function nameOf(clusterArn: string): string {
    return clusterArn.split('/').pop() ?? clusterArn
}

function serviceArn(name: string): string {
    return `arn:aws:ecs:us-east-1:000000000000:service/web/${name}`
}

function taskArn(id: string): string {
    return `arn:aws:ecs:us-east-1:000000000000:task/web/${id}`
}

function cluster(name: string): Cluster {
    return {clusterArn: arn(name), clusterName: name, status: 'ACTIVE'}
}

function createAdapter(handler: SendHandler = async () => ({})): AwsEcsAdapter {
    return new AwsEcsAdapter({send: handler} as unknown as ECSClient)
}
