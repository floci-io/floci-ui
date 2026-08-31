import {NotSupportedError} from '../cloud-spi/errors'
import {awsEksSchema} from '../cloud-spi/eksSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateKubernetesFargateProfileInput,
    CreateKubernetesNodegroupInput,
    CreateResourceInput,
    KubernetesFargateProfile,
    KubernetesNodegroup,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {ValidationError} from '../cloud-spi/errors'
import {eksService, type EksCluster, type EksFargateProfile, type EksNodegroup} from '../services/eks'

type EksServiceShape = Pick<
    typeof eksService,
    | 'listClusters'
    | 'describeCluster'
    | 'listNodegroups'
    | 'createNodegroup'
    | 'deleteNodegroup'
    | 'listFargateProfiles'
    | 'createFargateProfile'
    | 'deleteFargateProfile'
>

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
        throw new NotSupportedError('EKS cluster creation is not supported from the dynamic Cloud Explorer.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('EKS cluster deletion is not supported from the dynamic Cloud Explorer.')
    }

    async listKubernetesNodegroups(clusterId: string): Promise<KubernetesNodegroup[]> {
        return (await this.eks.listNodegroups(clusterId)).map(toNodegroup)
    }

    async createKubernetesNodegroup(
        clusterId: string,
        input: CreateKubernetesNodegroupInput,
    ): Promise<KubernetesNodegroup> {
        validateNodegroupInput(input)
        return toNodegroup(await this.eks.createNodegroup(clusterId, input))
    }

    async deleteKubernetesNodegroup(clusterId: string, nodegroupId: string): Promise<void> {
        await this.eks.deleteNodegroup(clusterId, nodegroupId)
    }

    async listKubernetesFargateProfiles(clusterId: string): Promise<KubernetesFargateProfile[]> {
        return (await this.eks.listFargateProfiles(clusterId)).map(toFargateProfile)
    }

    async createKubernetesFargateProfile(
        clusterId: string,
        input: CreateKubernetesFargateProfileInput,
    ): Promise<KubernetesFargateProfile> {
        validateFargateProfileInput(input)
        return toFargateProfile(await this.eks.createFargateProfile(clusterId, input))
    }

    async deleteKubernetesFargateProfile(clusterId: string, profileId: string): Promise<void> {
        await this.eks.deleteFargateProfile(clusterId, profileId)
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

function toNodegroup(nodegroup: EksNodegroup): KubernetesNodegroup {
    return {
        id: nodegroup.name,
        name: nodegroup.name,
        clusterId: nodegroup.clusterName,
        arn: nodegroup.arn ?? null,
        status: nodegroup.status ?? null,
        version: nodegroup.version ?? null,
        releaseVersion: nodegroup.releaseVersion ?? null,
        createdAt: nodegroup.createdAt ?? null,
        modifiedAt: nodegroup.modifiedAt ?? null,
        capacityType: nodegroup.capacityType ?? null,
        instanceTypes: nodegroup.instanceTypes,
        subnets: nodegroup.subnets,
        nodeRole: nodegroup.nodeRole ?? null,
        scalingConfig: nodegroup.scalingConfig ?? null,
        labels: nodegroup.labels,
        tags: nodegroup.tags,
    }
}

function toFargateProfile(profile: EksFargateProfile): KubernetesFargateProfile {
    return {
        id: profile.name,
        name: profile.name,
        clusterId: profile.clusterName,
        arn: profile.arn ?? null,
        status: profile.status ?? null,
        createdAt: profile.createdAt ?? null,
        podExecutionRoleArn: profile.podExecutionRoleArn ?? null,
        subnets: profile.subnets,
        selectors: profile.selectors.map((selector) => ({
            namespace: selector.namespace ?? null,
            labels: selector.labels,
        })),
        tags: profile.tags,
    }
}

function validateNodegroupInput(input: CreateKubernetesNodegroupInput): void {
    if (typeof input.name !== 'string' || !input.name.trim()) throw new ValidationError('Nodegroup name is required')
    if (typeof input.nodeRole !== 'string' || !input.nodeRole.trim()) throw new ValidationError('Node role ARN is required')
    if (!Array.isArray(input.subnets) || input.subnets.length === 0 || input.subnets.some((subnet) => typeof subnet !== 'string' || !subnet.trim())) {
        throw new ValidationError('At least one subnet is required')
    }
}

function validateFargateProfileInput(input: CreateKubernetesFargateProfileInput): void {
    if (typeof input.name !== 'string' || !input.name.trim()) throw new ValidationError('Fargate profile name is required')
    if (typeof input.podExecutionRoleArn !== 'string' || !input.podExecutionRoleArn.trim()) throw new ValidationError('Pod execution role ARN is required')
    if (!Array.isArray(input.selectors) || input.selectors.length === 0 || input.selectors.some((selector) => typeof selector.namespace !== 'string' || !selector.namespace.trim())) {
        throw new ValidationError('At least one selector namespace is required')
    }
}
