// Derived from SERVICE_CATALOG so a new catalog row is a new service type.
// This type-only cycle with serviceCatalog.ts is erased at compile time.
import type {CloudServiceType, ServiceGroup} from './serviceCatalog'
import type {
    CollectionActionName,
    DocumentStoreAdapter,
    ItemActionName,
    ItemStoreAdapter,
} from './childCollections'

export type {CloudServiceType, ServiceGroup}

export type CloudProvider = 'aws' | 'azure' | 'gcp'

export type CloudAvailability = 'available' | 'coming_soon'

export interface CloudDescriptor {
    id: CloudProvider
    displayName: string
    availability: CloudAvailability
}

/**
 * What the frontend needs to render a nav entry. Everything except
 * `availability` and `reason` comes from the service catalog; those two are
 * resolved per cloud at request time.
 */
export interface CloudServiceDescriptor {
    cloud: CloudProvider
    service: CloudServiceType
    displayName: string
    availability: CloudAvailability
    /** Why the service is unavailable. Always set when availability is coming_soon. */
    reason?: string
    /** Route slug, or an absolute path for a page outside Cloud Explorer. */
    route: string
    /** Icon hint; the frontend maps it to a component and falls back if unknown. */
    iconKey: string
    group: ServiceGroup
    order: number
}

export type RuntimeReachability = 'reachable' | 'unavailable' | 'coming_soon'

export interface CloudStatus {
    cloud: CloudProvider
    adapterRegistered: boolean
    runtime: RuntimeReachability
    endpoint: string | null
    checkedAt: string
    error: string | null
    /** Present only when the caller asks for per-service detail. */
    services?: CloudServiceStatus[]
}

/**
 * Health of one service rather than the whole cloud. Needed because a cloud can
 * be up while an individual service is not — the Azure runtime serves blob
 * storage but answers 501 for functions.
 */
export interface CloudServiceStatus {
    cloud: CloudProvider
    service: CloudServiceType
    adapterRegistered: boolean
    runtime: RuntimeReachability
    endpoint: string | null
    checkedAt: string
    latencyMs: number | null
    error: string | null
    /** The mapped error code, so the UI can tell "not implemented" from "down". */
    errorCode: string | null
}

export type FieldType = 'text' | 'textarea' | 'password' | 'select'

export interface FieldSchema {
    name: string
    label: string
    type: FieldType
    required: boolean
    requiredWhen?: {field: string; equals: string}
    description?: string
    group?: string
    span?: boolean
    valuePath?: string
    defaultValue?: string
    visibleWhen?: {field: string; equals: string}
    validation?: {
        pattern?: string
        minLength?: number
        maxLength?: number
        message?: string
    }
    options?: Array<{label: string; value: string}>
}

/**
 * Verbs a service can advertise. `ActionSchema` drives which controls the
 * generic view renders; `ResourceActionName` additionally covers lifecycle verbs
 * that a capability block can describe but that are not table-level controls.
 */
export type ActionSchema = 'list' | 'create' | 'update' | 'delete' | 'inspect'
export type ResourceActionName =
    | 'list'
    | 'create'
    | 'update'
    | 'delete'
    | 'inspect'
    | 'encrypt'
    | 'decrypt'
    | 'invoke'
    | 'start'
    | 'stop'
    | 'reboot'
    | 'updateTags'
export type ObjectActionName = 'list' | 'upload' | 'download' | 'delete' | 'createFolder' | 'copy'
export type DatabaseActionName = 'listSnapshots' | 'createSnapshot'
export type KubernetesActionName =
    | 'listNodegroups'
    | 'createNodegroup'
    | 'deleteNodegroup'
    | 'listFargateProfiles'
    | 'createFargateProfile'
    | 'deleteFargateProfile'
export type CapabilityStatus = 'available' | 'blocked' | 'partial' | 'coming_soon'

export interface CapabilitySchema<TAction extends string> {
    name: TAction
    label: string
    enabled: boolean
    status: CapabilityStatus
    reason?: string
    runtimeRequired?: boolean
}

/**
 * How a column is rendered. Everything past `label` is optional and every
 * default reproduces the previous behaviour, so existing schemas are unaffected.
 */
export type ColumnFormat = 'text' | 'datetime' | 'relative' | 'bytes' | 'boolean' | 'badge' | 'code' | 'list'

export interface TableColumnSchema {
    /** Column identity and sort key. */
    name: string
    label: string
    /**
     * Dotted accessor into the resource, defaulting to `name`. Needed because
     * most provider detail lives under `metadata`, which a top-level lookup
     * cannot reach — those columns previously rendered blank for every row.
     */
    path?: string
    format?: ColumnFormat
    emptyText?: string
    width?: string
}

export interface ServiceSchema {
    cloud: CloudProvider
    service: CloudServiceType
    displayName: string
    fields: FieldSchema[]
    actions: ActionSchema[]
    capabilities?: {
        resourceActions?: CapabilitySchema<ResourceActionName>[]
        objectActions?: CapabilitySchema<ObjectActionName>[]
        databaseActions?: CapabilitySchema<DatabaseActionName>[]
        kubernetesActions?: CapabilitySchema<KubernetesActionName>[]
        // Child levels advertise separately from the resource level because a
        // store can be readable at the leaf and writable at the collection —
        // CloudWatch Logs creates streams but cannot delete an event.
        collectionActions?: CapabilitySchema<CollectionActionName>[]
        itemActions?: CapabilitySchema<ItemActionName>[]
    }
    filters: FieldSchema[]
    columns: TableColumnSchema[]
    updateFields?: FieldSchema[]
}

export type KnownResourceType =
    | 'bucket' | 'container' | 'cluster' | 'db-instance' | 'cosmos-database' | 'dynamodb-table'
    | 'instance' | 'image' | 'vpc' | 'lambda' | 'azure-function' | 'gcp-function'
    | 'secret' | 'iam-user' | 'servicebus-namespace' | 'queue' | 'fifo-queue'
    | 'topic' | 'kinesis-stream' | 'event-bus' | 'rest-api' | 'stack' | 'email' | 'sql-server'
    | 'postgres-flexible-server' | 'load-balancer' | 'state-machine' | 'scheduler-job' | 'key' | 'parameter' | 'cloud-run-service' | 'log-group'

export interface CloudResource {
    id: string
    name: string
    cloud: CloudProvider
    service: CloudServiceType
    /** Provider resource kind. Open so adapters can evolve independently. */
    type: KnownResourceType | (string & {})
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

export interface StorageObjectDownload {
    body: BodyInit
    contentType: string
    contentLength: number | null
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

export interface SqlConnectionInput {
    username: string
    password: string
    database?: string
    engine?: 'azure-sql' | 'postgresql'
}

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

/** Mirrors the real StartQuery contract: epoch seconds, inclusive range. */
export interface LogsInsightsQueryInput {
    queryString: string
    startTime: number
    endTime: number
    limit?: number
}

export interface LogsInsightsQueryResult {
    /**
     * Always present, including when `status` is still Running/Scheduled after
     * the poll deadline — dropping it in that case would leave no way to ever
     * check back on that query again, even though it is still running server-side.
     */
    queryId: string
    /** CloudWatch Logs' own QueryStatus: Complete, Running, Failed, Timeout, ... */
    status: string
    rows: Array<Record<string, string>>
}

export interface NoSqlItem {
    id: string
    key: Record<string, unknown>
    document: Record<string, unknown>
}

/** Provider-neutral representation of a managed Kubernetes node pool. */
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
    /** Decoded configuration payload; only GetHostedConfigurationVersion returns it. */
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

export interface ResourceQuery {
    search?: string
    /**
     * Values for the non-search facets a schema declares in `filters`.
     *
     * Needed because some services hold several kinds of resource in one category,
     * IAM lists users, roles and policies, and a free-text search cannot express
     * "only roles". The route populates this from query params, but only for
     * names the service's own schema declares, so an unknown param is ignored
     * rather than reaching an adapter that never asked for it.
     */
    filters?: Record<string, string>
}

export interface CreateResourceInput {
    values: Record<string, unknown>
}

export interface UpdateResourceInput {
    values: Record<string, unknown>
}
export interface LambdaTriggerDetails {
    events?: string[]
    prefix?: string
    suffix?: string
    batchSize?: number
    startingPosition?: string
    filterCriteria?: Record<string, unknown>
}

export interface LambdaTrigger {
    id: string
    type: 's3' | 'dynamodb' | 'sqs' | 'kinesis'
    sourceArn: string
    sourceName: string
    status: string
    createdAt?: string | null
    details: LambdaTriggerDetails
}

export interface CreateLambdaTriggerInput {
    type: 's3' | 'dynamodb' | 'sqs' | 'kinesis'
    bucketName?: string
    events?: string[]
    prefix?: string
    suffix?: string
    tableName?: string
    queueNameOrUrl?: string
    streamName?: string
    batchSize?: number
    startingPosition?: 'LATEST' | 'TRIM_HORIZON' | 'AT_TIMESTAMP'
    enabled?: boolean
    filterCriteria?: Record<string, unknown>
}

export interface DeleteLambdaTriggerOptions {
    type?: string
    bucket?: string
}

export interface ServerlessInvokeResult {
    statusCode: number
    payload: string
    functionError?: string
    logResult?: string
    executionDuration?: number
}

export type KmsEncryptionAlgorithm =
    | 'SYMMETRIC_DEFAULT'
    | 'RSAES_OAEP_SHA_1'
    | 'RSAES_OAEP_SHA_256'

export interface KmsEncryptInput {
    plaintext: Uint8Array
    encryptionAlgorithm: KmsEncryptionAlgorithm
    encryptionContext?: Record<string, string>
}

export interface KmsEncryptResult {
    ciphertextBlob: Uint8Array
    keyId: string
    encryptionAlgorithm: KmsEncryptionAlgorithm
}

export interface KmsDecryptInput {
    ciphertextBlob: Uint8Array
    encryptionAlgorithm: KmsEncryptionAlgorithm
    encryptionContext?: Record<string, string>
}

export interface KmsDecryptResult {
    plaintext: Uint8Array
    keyId: string
    encryptionAlgorithm: KmsEncryptionAlgorithm
}
/**
 * Lets a registered adapter correct its own advertised availability.
 *
 * Needed because "an adapter exists" and "the local runtime implements it" are
 * different facts: floci-az ships no /functions endpoint, so the Azure
 * serverless adapter is registered but cannot serve a request. Declaring that
 * here keeps the sidebar, the console card and the explorer surface consistent
 * from one string.
 */
export interface CloudServiceDescriptorOverride {
    availability?: CloudAvailability
    reason?: string
    displayName?: string
}

export interface CloudServiceAdapter {
    readonly cloud: CloudProvider
    readonly service: CloudServiceType
    schema(): ServiceSchema
    descriptorOverride?(): CloudServiceDescriptorOverride
    list(query?: ResourceQuery): Promise<CloudResource[]>
    get(id: string): Promise<CloudResource | null>
    create(input: CreateResourceInput): Promise<CloudResource>
    update?(id: string, input: UpdateResourceInput): Promise<CloudResource>
    delete(id: string): Promise<void>
    listObjects?(resourceId: string, prefix?: string): Promise<StorageObjectList>
    putObject?(resourceId: string, key: string, body: Uint8Array, contentType: string): Promise<void>
    getObject?(resourceId: string, key: string): Promise<StorageObjectDownload>
    deleteObject?(resourceId: string, key: string): Promise<void>
    listDatabaseSnapshots?(instanceIdentifier?: string): Promise<DatabaseSnapshot[]>
    createDatabaseSnapshot?(input: CreateDatabaseSnapshotInput): Promise<DatabaseSnapshot>
    listDatabaseOrderableInstanceClasses?(engine?: string): Promise<string[]>
    invoke?(id: string, payload: string): Promise<ServerlessInvokeResult>
    encrypt?(id: string, input: KmsEncryptInput): Promise<KmsEncryptResult>
    decrypt?(id: string, input: KmsDecryptInput): Promise<KmsDecryptResult>
    // Lifecycle verbs. Optional because most categories have no notion of them;
    // an adapter that advertises one in `capabilities` must implement it, which
    // cloudProxy.test.ts enforces.
    start?(id: string): Promise<void>
    stop?(id: string, force?: boolean): Promise<void>
    reboot?(id: string): Promise<void>
    updateTags?(id: string, tags: Record<string, string | null>): Promise<void>
    /**
     * Cheap liveness check. Defaults to `list()`, which is a valid probe for
     * every current adapter; override where listing is expensive.
     */
    health?(): Promise<void>
    copyObject?(srcResourceId: string, srcKey: string, destKey: string, destResourceId?: string): Promise<void>
    /**
     * Child collections. An adapter implements at most one: `documents` when the
     * resource holds collections that hold items, `items` when the resource is
     * itself the collection. Both is a contract violation — the flat item routes
     * would be ambiguous — and cloudProxy.test.ts enforces that.
     */
    documents?: DocumentStoreAdapter
    items?: ItemStoreAdapter
    listCosmosContainers?(databaseId: string): Promise<CosmosContainer[]>
    createCosmosContainer?(databaseId: string, input: CreateResourceInput): Promise<CosmosContainer>
    deleteCosmosContainer?(databaseId: string, containerId: string): Promise<void>
    listCosmosItems?(databaseId: string, containerId: string): Promise<CosmosItem[]>
    upsertCosmosItem?(databaseId: string, containerId: string, document: Record<string, unknown>): Promise<CosmosItem>
    deleteCosmosItem?(databaseId: string, containerId: string, itemId: string, partitionKey?: string | null): Promise<void>
    queryCosmosItems?(databaseId: string, containerId: string, query: string): Promise<CosmosQueryResult>
    listSqlDatabases?(serverId: string, connection: SqlConnectionInput): Promise<SqlDatabase[]>
    listSqlTables?(serverId: string, connection: SqlConnectionInput): Promise<SqlTable[]>
    querySql?(serverId: string, connection: SqlConnectionInput, query: string): Promise<SqlQueryResult>
    queryLogs?(logGroupName: string, input: LogsInsightsQueryInput): Promise<LogsInsightsQueryResult>
    listNoSqlItems?(resourceId: string): Promise<NoSqlItem[]>
    putNoSqlItem?(resourceId: string, document: Record<string, unknown>): Promise<NoSqlItem>
    listKubernetesNodegroups?(clusterId: string): Promise<KubernetesNodegroup[]>
    createKubernetesNodegroup?(clusterId: string, input: CreateKubernetesNodegroupInput): Promise<KubernetesNodegroup>
    deleteKubernetesNodegroup?(clusterId: string, nodegroupId: string): Promise<void>
    listKubernetesFargateProfiles?(clusterId: string): Promise<KubernetesFargateProfile[]>
    createKubernetesFargateProfile?(clusterId: string, input: CreateKubernetesFargateProfileInput): Promise<KubernetesFargateProfile>
    deleteKubernetesFargateProfile?(clusterId: string, profileId: string): Promise<void>
    /** Clears the provider's locally captured email inbox, if it exposes one. */
    clearEmailInbox?(): Promise<void>
    // AppConfig nested resources, keyed by the ids the provider needs. Inspect
    // reuses the full list payloads; only hosted versions (whose content is not
    // in List*) and deployments (which are polled) get a getter.
    listAppConfigEnvironments?(applicationId: string): Promise<AppConfigEnvironment[]>
    createAppConfigEnvironment?(applicationId: string, input: CreateResourceInput): Promise<AppConfigEnvironment>
    deleteAppConfigEnvironment?(applicationId: string, environmentId: string): Promise<void>
    listAppConfigConfigurationProfiles?(applicationId: string): Promise<AppConfigConfigurationProfile[]>
    createAppConfigConfigurationProfile?(applicationId: string, input: CreateResourceInput): Promise<AppConfigConfigurationProfile>
    deleteAppConfigConfigurationProfile?(applicationId: string, profileId: string): Promise<void>
    listAppConfigHostedConfigurationVersions?(applicationId: string, profileId: string): Promise<AppConfigHostedConfigurationVersion[]>
    getAppConfigHostedConfigurationVersion?(applicationId: string, profileId: string, versionNumber: number): Promise<AppConfigHostedConfigurationVersion | null>
    createAppConfigHostedConfigurationVersion?(applicationId: string, profileId: string, input: CreateResourceInput): Promise<AppConfigHostedConfigurationVersion>
    deleteAppConfigHostedConfigurationVersion?(applicationId: string, profileId: string, versionNumber: number): Promise<void>
    listAppConfigDeploymentStrategies?(): Promise<AppConfigDeploymentStrategy[]>
    createAppConfigDeploymentStrategy?(input: CreateResourceInput): Promise<AppConfigDeploymentStrategy>
    deleteAppConfigDeploymentStrategy?(strategyId: string): Promise<void>
    startAppConfigDeployment?(applicationId: string, environmentId: string, input: CreateResourceInput): Promise<AppConfigDeployment>
    getAppConfigDeployment?(applicationId: string, environmentId: string, deploymentNumber: number): Promise<AppConfigDeployment | null>
    listLambdaTriggers?(functionName: string): Promise<LambdaTrigger[]>
    createLambdaTrigger?(functionName: string, input: CreateLambdaTriggerInput): Promise<LambdaTrigger>
    deleteLambdaTrigger?(functionName: string, triggerId: string, options?: DeleteLambdaTriggerOptions): Promise<void>
}
