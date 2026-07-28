import {NotSupportedError} from '../cloud-spi/errors'
import {awsNetworkingSchema} from '../cloud-spi/networkingSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'
import {ec2Service, type Ec2Tag, type Ec2Vpc} from '../services/ec2'

type Ec2NetworkingServiceShape = {
    listVpcs(): Promise<Ec2Vpc[]>
}

/**
 * Networking adapter for AWS.
 *
 * Exposes VPCs as the top-level resource in the generic Cloud Explorer table.
 * All VPC, subnet, security-group, key-pair, IGW, route-table, and EIP management
 * is handled by the dedicated NetworkingPanel component which calls the EC2 API
 * routes directly — this adapter only drives the resource table and sidebar entry.
 */
export class AwsNetworkingAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'networking' as const

    constructor(private readonly service_: Ec2NetworkingServiceShape = ec2Service) {}

    schema(): ServiceSchema {
        return awsNetworkingSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const vpcs = await this.service_.listVpcs()
        return filterBySearch(vpcs.map(vpcToResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        // listVpcs is the only read the EC2 service exposes here, and a local
        // emulator's VPC count is small enough that filtering it is cheaper than
        // adding a describe path through the legacy service layer.
        const vpcs = await this.service_.listVpcs()
        const match = vpcs.find((vpc) => vpc.vpcId === id)
        return match ? vpcToResource(match) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Use the Networking panel to create VPCs and networking resources.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Use the Networking panel to delete networking resources.')
    }
}

function vpcToResource(vpc: Ec2Vpc): CloudResource {
    return {
        id: vpc.vpcId,
        name: nameTag(vpc.tags) || vpc.vpcId,
        cloud: 'aws',
        service: 'networking',
        type: 'vpc',
        region: null,
        createdAt: null,
        status: vpc.state ?? null,
        version: vpc.cidrBlock,
        metadata: {
            cidrBlock: vpc.cidrBlock,
            isDefault: vpc.isDefault,
            tags: vpc.tags,
        },
    }
}

function nameTag(tags: Ec2Tag[]): string {
    return tags.find((t) => t.key === 'Name')?.value ?? ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((r) => r.name.toLowerCase().includes(normalized))
}
