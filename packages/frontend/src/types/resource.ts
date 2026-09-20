import type {CloudProvider, CloudServiceType} from './cloud'

export type KnownResourceType =
    | 'bucket' | 'container' | 'cluster' | 'db-instance' | 'cosmos-database'
    | 'instance' | 'image' | 'vpc' | 'lambda' | 'azure-function' | 'gcp-function'
    | 'dynamodb-table' | 'secret' | 'iam-user' | 'servicebus-namespace'
    | 'queue' | 'fifo-queue' | 'topic' | 'event-bus' | 'rest-api' | 'stack' | 'email'
    | 'sql-server' | 'postgres-flexible-server' | 'load-balancer' | 'state-machine' | 'scheduler-job' | 'key' | 'parameter' | 'cloud-run-service';

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

export interface DatabaseSnapshot {
    id: string
    name: string
    instanceIdentifier: string | null
    status: string | null
    engine: string | null
    version: string | null
    createdAt: string | null
    metadata: Record<string, unknown>
}

export interface CreateDatabaseSnapshotInput {
    instanceIdentifier: string
    snapshotIdentifier: string
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

/** The generic child-collections SPI: the middle level (a log stream, a Cosmos container). */
export interface ChildCollection {
    id: string
    name: string
    parentId: string
    createdAt: string | null
    metadata: Record<string, unknown>
}

/** The generic child-collections SPI: the leaf (a log event, a document). */
export interface ChildItem {
    id: string
    collectionId: string | null
    timestamp: string | null
    body: Record<string, unknown>
    metadata: Record<string, unknown>
}

export interface CollectionPage<T> {
    items: T[]
    nextCursor: string | null
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

export interface LogsInsightsQueryInput {
    queryString: string
    startTime: number
    endTime: number
    limit?: number
}

export interface LogsInsightsQueryResult {
    queryId: string
    status: string
    rows: Array<Record<string, string>>
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

export interface AppConfigEnvironment {
  id: string
  applicationId: string
  name: string
  description: string | null
  state: string | null
}

export interface AppConfigConfigurationProfile {
  id: string
  applicationId: string
  name: string
  description: string | null
  locationUri: string | null
  type: string | null
}

export interface AppConfigHostedConfigurationVersion {
  id: string
  applicationId: string
  configurationProfileId: string
  versionNumber: number
  description: string | null
  contentType: string | null
  content: string | null
}

export interface AppConfigDeploymentStrategy {
  id: string
  name: string
  description: string | null
  deploymentDurationInMinutes: number | null
  growthType: string | null
  growthFactor: number | null
  finalBakeTimeInMinutes: number | null
  replicateTo: string | null
}

export interface AppConfigDeployment {
  applicationId: string
  environmentId: string
  deploymentNumber: number
  configurationProfileId: string | null
  configurationVersion: string | null
  deploymentStrategyId: string | null
  state: string | null
  percentageComplete: number | null
  startedAt: string | null
  completedAt: string | null
  description: string | null
}
