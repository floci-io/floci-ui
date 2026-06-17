import {awsEksSchema} from '../cloud-spi/eksSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {eksService, type EksCluster} from '../services/eks'

type EksServiceShape = Pick<typeof eksService, 'listClusters' | 'describeCluster'>

export class AwsEksAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'k8s' as const

    constructor(private readonly eks: EksServiceShape = eksService) {}

    schema(): ServiceSchema {
        return awsEksSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const clusters = await this.eks.listClusters()
        return filterBySearch(clusters.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return toResource(await this.eks.describeCluster(id))
        } catch (error) {
            if (hasHttpStatus(error, 404)) return null
            throw error
        }
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new Error('EKS cluster creation is not supported from the dynamic Cloud Explorer.')
    }

    async delete(_id: string): Promise<void> {
        throw new Error('EKS cluster deletion is not supported from the dynamic Cloud Explorer.')
    }
}

function toResource(cluster: EksCluster): CloudResource {
    return {
        id: cluster.name,
        name: cluster.name,
        cloud: 'aws',
        service: 'k8s',
        type: 'cluster',
        region: null,
        createdAt: cluster.createdAt ?? null,
        status: cluster.status ?? null,
        version: cluster.version ?? null,
        metadata: {
            arn: cluster.arn,
            endpoint: cluster.endpoint,
            roleArn: cluster.roleArn,
            platformVersion: cluster.platformVersion,
            nodegroupCount: cluster.nodegroupCount ?? 0,
            fargateProfileCount: cluster.fargateProfileCount ?? 0,
            resourcesVpcConfig: cluster.resourcesVpcConfig,
            tags: Object.entries(cluster.tags).map(([key, value]) => ({key, value})),
        },
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function hasHttpStatus(error: unknown, status: number): boolean {
    if (typeof error !== 'object' || error === null) return false
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === status
}
