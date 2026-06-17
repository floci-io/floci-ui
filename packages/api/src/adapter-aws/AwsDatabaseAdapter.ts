import {ListTagsForResourceCommand, type RDSClient} from '@aws-sdk/client-rds'
import {rds as defaultRds} from '../aws'
import {awsDatabaseSchema} from '../cloud-spi/databaseSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {rdsService, type RdsInstance} from '../services/rds'

type RdsServiceShape = Pick<typeof rdsService, 'listInstances' | 'describeInstance'>

export class AwsDatabaseAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'database' as const

    constructor(
        private readonly rdsService_: RdsServiceShape = rdsService,
        private readonly rds: RDSClient = defaultRds,
    ) {}

    schema(): ServiceSchema {
        return awsDatabaseSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const instances = await this.rdsService_.listInstances()
        const resources = await Promise.all(instances.map((instance) => this.toResource(instance)))
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return await this.toResource(await this.rdsService_.describeInstance(id))
        } catch (error) {
            if (hasHttpStatus(error, 404)) return null
            throw error
        }
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new Error('Database creation is not supported from the dynamic Cloud Explorer.')
    }

    async delete(_id: string): Promise<void> {
        throw new Error('Database deletion is not supported from the dynamic Cloud Explorer.')
    }

    private async toResource(instance: RdsInstance): Promise<CloudResource> {
        const tags = instance.arn ? await this.getTags(instance.arn) : []

        return {
        id: instance.identifier,
        name: instance.identifier,
        cloud: 'aws',
        service: 'database',
        type: 'db-instance',
        region: instance.availabilityZone ?? null,
        createdAt: instance.createdAt ?? null,
        status: instance.status ?? null,
        version: instance.engineVersion ?? null,
        engine: instance.engine ?? null,
        instanceClass: instance.instanceClass ?? null,
        metadata: {
            arn: instance.arn,
            resourceId: instance.resourceId,
            dbName: instance.dbName,
            masterUsername: instance.masterUsername,
            allocatedStorage: instance.allocatedStorage,
            storageType: instance.storageType,
            endpoint: instance.endpoint,
            multiAz: instance.multiAz,
            publiclyAccessible: instance.publiclyAccessible,
            iamDatabaseAuthenticationEnabled: instance.iamDatabaseAuthenticationEnabled,
            preferredBackupWindow: instance.preferredBackupWindow,
            preferredMaintenanceWindow: instance.preferredMaintenanceWindow,
            vpcSecurityGroups: instance.vpcSecurityGroups,
            subnetGroup: instance.subnetGroup,
            tags,
        },
        }
    }

    private async getTags(arn: string): Promise<Array<{key: string; value: string}>> {
        try {
            const res = await this.rds.send(new ListTagsForResourceCommand({ResourceName: arn}))
            return (res.TagList ?? []).map((tag) => ({
                key: tag.Key ?? '',
                value: tag.Value ?? '',
            }))
        } catch (error) {
            if (error instanceof Error && error.message.includes('ListTagsForResource is not supported')) return []
            throw error
        }
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
