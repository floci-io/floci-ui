import {awsComputeSchema} from '../cloud-spi/computeSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {ec2Service, type Ec2Image, type Ec2Instance, type RunInstanceInput} from '../services/ec2'

type Ec2ServiceShape = {
    listInstances(): Promise<Ec2Instance[]>
    describeInstance(instanceId: string): Promise<Ec2Instance>
    terminateInstance(instanceId: string): Promise<void>
    deregisterImage(imageId: string): Promise<void>
    listAmis(): Promise<Ec2Image[]>
    runInstance(input: RunInstanceInput): Promise<Ec2Instance>
}

export class AwsComputeAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'compute' as const

    constructor(private readonly service_: Ec2ServiceShape = ec2Service) {}

    schema(): ServiceSchema {
        return awsComputeSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const [instances, images] = await Promise.all([
            this.service_.listInstances(),
            this.service_.listAmis(),
        ])
        const resources = [
            ...instances.map(instanceToResource),
            ...images.map(imageToResource),
        ]
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return instanceToResource(await this.service_.describeInstance(id))
        } catch (error) {
            if (hasHttpStatus(error, 404)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const v = input.values
        const sgRaw = typeof v.securityGroupIds === 'string' ? v.securityGroupIds : ''
        const securityGroupIds = sgRaw ? sgRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
        const runInput: RunInstanceInput = {
            name:           String(v.name ?? ''),
            imageId:        String(v.imageId ?? ''),
            instanceType:   String(v.instanceType ?? ''),
            keyName:        v.keyName ? String(v.keyName) : undefined,
            subnetId:       v.subnetId ? String(v.subnetId) : undefined,
            securityGroupIds,
        }
        const instance = await this.service_.runInstance(runInput)
        return instanceToResource(instance)
    }

    async delete(id: string): Promise<void> {
        // The list mixes instances and AMIs, and they have different removal
        // APIs: an AMI id handed to TerminateInstances is a 404, not a delete.
        if (id.startsWith('ami-')) await this.service_.deregisterImage(id)
        else await this.service_.terminateInstance(id)
    }
}

function instanceToResource(instance: Ec2Instance): CloudResource {
    return {
        id: instance.instanceId,
        name: instance.name,
        cloud: 'aws',
        service: 'compute',
        type: 'instance',
        region: instance.availabilityZone ?? null,
        createdAt: instance.launchTime ?? null,
        status: instance.state ?? null,
        metadata: {
            instanceType: instance.instanceType,
            publicIpAddress: instance.publicIpAddress,
            privateIpAddress: instance.privateIpAddress,
            vpcId: instance.vpcId,
            subnetId: instance.subnetId,
            imageId: instance.imageId,
            keyName: instance.keyName,
            architecture: instance.architecture,
            platform: instance.platform,
            securityGroups: instance.securityGroups,
            tags: instance.tags,
        },
    }
}

function imageToResource(image: Ec2Image): CloudResource {
    return {
        id: image.imageId,
        name: image.name,
        cloud: 'aws',
        service: 'compute',
        type: 'image',
        region: null,
        createdAt: image.createdAt ?? null,
        status: image.state ?? null,
        metadata: {
            architecture: image.architecture,
            rootDeviceType: image.rootDeviceType,
            virtualizationType: image.virtualizationType,
            ownerId: image.ownerId,
            public: image.public,
            tags: image.tags,
        },
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((r) => r.name.toLowerCase().includes(normalized))
}

function hasHttpStatus(error: unknown, status: number): boolean {
    if (typeof error !== 'object' || error === null) return false
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === status
}
