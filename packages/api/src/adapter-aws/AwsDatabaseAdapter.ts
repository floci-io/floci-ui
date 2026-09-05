import {ValidationError} from '../cloud-spi/errors'
import {ListTagsForResourceCommand, type RDSClient} from '@aws-sdk/client-rds'
import {rds as defaultRds} from '../aws'
import {awsDatabaseSchema} from '../cloud-spi/databaseSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateDatabaseSnapshotInput,
    CreateResourceInput,
    DatabaseSnapshot,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {rdsService, type RdsInstance, type RdsSnapshot} from '../services/rds'

type RdsServiceShape = Pick<
    typeof rdsService,
    'listInstances' | 'describeInstance' | 'createInstance' | 'deleteInstance' | 'listSnapshots' | 'createSnapshot' | 'listOrderableInstanceClasses'
>

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

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const values = input.values
        const dbInstanceIdentifier = instanceIdentifier(values.dbInstanceIdentifier)
        const engine = databaseEngine(values.engine)
        const masterUserPassword = password(values.masterUserPassword)
        const dbInstanceClass = stringValue(values.dbInstanceClass) || 'db.t3.micro'
        const allocatedStorage = storageSize(values.allocatedStorage)
        const masterUsername = stringValue(values.masterUsername) || 'root'
        const dbName = stringValue(values.dbName) || undefined
        const engineVersion = stringValue(values.engineVersion) || undefined
        const vpcSecurityGroupIds = securityGroupIds(values.securityGroupIds ?? values.vpcSecurityGroupIds)

        const instance = await this.rdsService_.createInstance({
            DBInstanceIdentifier: dbInstanceIdentifier,
            Engine: engine,
            MasterUserPassword: masterUserPassword,
            DBInstanceClass: dbInstanceClass,
            AllocatedStorage: allocatedStorage,
            MasterUsername: masterUsername,
            DBName: dbName,
            EngineVersion: engineVersion,
            VpcSecurityGroupIds: vpcSecurityGroupIds,
        })
        return this.toResource(instance)
    }

    async delete(id: string): Promise<void> {
        await this.rdsService_.deleteInstance(id)
    }

    async listDatabaseSnapshots(instanceIdentifier?: string): Promise<DatabaseSnapshot[]> {
        const normalizedIdentifier = stringValue(instanceIdentifier) || undefined
        return (await this.rdsService_.listSnapshots(normalizedIdentifier)).map(snapshotToDatabaseSnapshot)
    }

    async createDatabaseSnapshot(input: CreateDatabaseSnapshotInput): Promise<DatabaseSnapshot> {
        const sourceIdentifier = instanceIdentifier(input.instanceIdentifier)
        const snapshotIdentifier = databaseSnapshotIdentifier(input.snapshotIdentifier)
        return snapshotToDatabaseSnapshot(
            await this.rdsService_.createSnapshot(sourceIdentifier, snapshotIdentifier),
        )
    }

    async listDatabaseOrderableInstanceClasses(engine?: string): Promise<string[]> {
        const normalizedEngine = stringValue(engine) || 'postgres'
        return await this.rdsService_.listOrderableInstanceClasses(normalizedEngine)
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

const INSTANCE_IDENTIFIER_PATTERN = /^(?!.*--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SNAPSHOT_IDENTIFIER_PATTERN = /^(?!.*--)[A-Za-z](?:[A-Za-z0-9-]{0,253}[A-Za-z0-9])?$/

function instanceIdentifier(value: unknown): string {
    const identifier = stringValue(value)
    if (!INSTANCE_IDENTIFIER_PATTERN.test(identifier)) {
        throw new ValidationError('dbInstanceIdentifier must be 1-63 lowercase letters, numbers, or hyphens, begin with a letter, and not end with or repeat a hyphen')
    }
    return identifier
}

function databaseSnapshotIdentifier(value: unknown): string {
    const identifier = stringValue(value)
    if (!SNAPSHOT_IDENTIFIER_PATTERN.test(identifier)) {
        throw new ValidationError('snapshotIdentifier must be 1-255 letters, numbers, or hyphens, begin with a letter, and not end with or repeat a hyphen')
    }
    return identifier
}

function databaseEngine(value: unknown): 'postgres' | 'mysql' | 'mariadb' {
    const engine = stringValue(value)
    if (engine === 'postgres' || engine === 'mysql' || engine === 'mariadb') return engine
    throw new ValidationError('engine must be postgres, mysql, or mariadb')
}

function password(value: unknown): string {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
        throw new ValidationError('masterUserPassword must be 8-128 characters')
    }
    return value
}

function storageSize(value: unknown): number {
    if (value === undefined || (typeof value === 'string' && !value.trim())) return 20

    const normalized = typeof value === 'string' ? value.trim() : value
    const hasValidSyntax = typeof normalized === 'number'
        || (typeof normalized === 'string' && /^[1-9][0-9]*$/.test(normalized))
    if (!hasValidSyntax) {
        throw new ValidationError('allocatedStorage must be a positive integer')
    }

    const storage = Number(normalized)
    if (!Number.isSafeInteger(storage) || storage <= 0) {
        throw new ValidationError('allocatedStorage must be a positive integer')
    }
    return storage
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function securityGroupIds(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        const list = value.map(stringValue).filter(Boolean)
        return list.length > 0 ? list : undefined
    }
    if (typeof value === 'string') {
        const list = value.split(',').map((s) => s.trim()).filter(Boolean)
        return list.length > 0 ? list : undefined
    }
    return undefined
}

function snapshotToDatabaseSnapshot(snapshot: RdsSnapshot): DatabaseSnapshot {
    return {
        id: snapshot.identifier,
        name: snapshot.identifier,
        instanceIdentifier: snapshot.instanceIdentifier ?? null,
        status: snapshot.status ?? null,
        engine: snapshot.engine ?? null,
        version: snapshot.engineVersion ?? null,
        createdAt: snapshot.createdAt ?? null,
        metadata: {
            arn: snapshot.arn,
            allocatedStorage: snapshot.allocatedStorage,
            snapshotType: snapshot.snapshotType,
            port: snapshot.port,
            availabilityZone: snapshot.availabilityZone,
            vpcId: snapshot.vpcId,
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
