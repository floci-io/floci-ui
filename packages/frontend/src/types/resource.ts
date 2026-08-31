import type {CloudProvider, CloudServiceType} from './cloud'

export type KnownResourceType =
    | 'bucket' | 'container' | 'cluster' | 'db-instance' | 'cosmos-database'
    | 'instance' | 'image' | 'vpc' | 'lambda' | 'azure-function' | 'gcp-function'
    | 'dynamodb-table' | 'secret' | 'iam-user' | 'servicebus-namespace'
    | 'queue' | 'fifo-queue' | 'topic' | 'event-bus' | 'rest-api' | 'stack' | 'email'
    | 'sql-server' | 'postgres-flexible-server';

export interface CloudResource {
    id: string
    name: string
    cloud: CloudProvider
    service: CloudServiceType
    /** Provider resource kind. Open by design — see the API's CloudResource. */
    type: KnownResourceType | (string & {});
    region: string | null
    createdAt: string | null
    status?: string | null
    version?: string | null
    engine?: string | null
    instanceClass?: string | null
    metadata: Record<string, unknown>
}

export interface StorageObject {
    key: string
    name: string
    type: 'folder' | 'object'
    size: number | null
    lastModified: string | null
    metadata: Record<string, unknown>
}

export interface StorageObjectList {
    prefix: string
    objects: StorageObject[]
}

export interface CosmosContainer {
    id: string
    name: string
    databaseId: string
    partitionKeyPath: string
    createdAt: string | null
    metadata: Record<string, unknown>
}

export interface CosmosItem {
    id: string
    databaseId: string
    containerId: string
    partitionKey: string | null
    etag: string | null
    timestamp: string | null
    document: Record<string, unknown>
}

export interface CosmosQueryResult {
    items: Array<Record<string, unknown> | string | number | boolean | null>
    count: number
}

export interface SqlCredentials {
    username: string
    password: string
}

export type SqlEngine = 'azure-sql' | 'postgresql'

export interface SqlDatabase {
    name: string
    state: string
    createdAt: string | null
    isSystem: boolean
}

export interface SqlTable {
    schema: string
    name: string
    type: 'table' | 'view'
    rowCount: number | null
}

export interface SqlColumn {
    name: string
    type: string
}

export interface SqlResultSet {
    columns: SqlColumn[]
    rows: Array<Record<string, unknown>>
    truncated: boolean
}

export interface SqlQueryResult {
    // `resultSets` holds only the statements that returned columns, while `rowsAffected`
    // has one entry per executed statement. On a multi-statement script the two arrays
    // therefore have different lengths — treat `rowsAffected` as a total, never as an
    // index-for-index companion to `resultSets`.
    resultSets: SqlResultSet[]
    rowsAffected: number[]
    durationMs: number
}

export interface NoSqlItem {
    id: string
    key: Record<string, unknown>
    document: Record<string, unknown>
}

export interface KubernetesNodegroup {
    id: string
    name: string
    clusterId: string
    arn: string | null
    status: string | null
    version: string | null
    releaseVersion: string | null
    createdAt: string | null
    modifiedAt: string | null
    capacityType: string | null
    instanceTypes: string[]
    subnets: string[]
    nodeRole: string | null
    scalingConfig: {minSize?: number; maxSize?: number; desiredSize?: number} | null
    labels: Record<string, string>
    tags: Record<string, string>
}

export interface CreateKubernetesNodegroupInput {
    name: string
    nodeRole: string
    subnets: string[]
    instanceTypes?: string[]
    scalingConfig?: {minSize?: number; maxSize?: number; desiredSize?: number}
    labels?: Record<string, string>
    tags?: Record<string, string>
}

export interface KubernetesFargateProfile {
    id: string
    name: string
    clusterId: string
    arn: string | null
    status: string | null
    createdAt: string | null
    podExecutionRoleArn: string | null
    subnets: string[]
    selectors: Array<{namespace: string | null; labels: Record<string, string>}>
    tags: Record<string, string>
}

export interface CreateKubernetesFargateProfileInput {
    name: string
    podExecutionRoleArn: string
    subnets?: string[]
    selectors: Array<{namespace: string; labels?: Record<string, string>}>
    tags?: Record<string, string>
}
