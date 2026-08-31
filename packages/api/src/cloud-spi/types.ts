// Derived from SERVICE_CATALOG so a new catalog row is a new service type.
// This type-only cycle with serviceCatalog.ts is erased at compile time.
import type {CloudServiceType, ServiceGroup} from './serviceCatalog'

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

export type FieldType = 'text' | 'password' | 'select'

export interface FieldSchema {
    name: string
    label: string
    type: FieldType
    required: boolean
    description?: string
    group?: string
    span?: boolean
    defaultValue?: string
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
export type ActionSchema = 'list' | 'create' | 'delete' | 'inspect'
export type ResourceActionName =
    | 'list'
    | 'create'
    | 'delete'
    | 'inspect'
    | 'invoke'
    | 'start'
    | 'stop'
    | 'reboot'
    | 'updateTags'
export type ObjectActionName = 'list' | 'upload' | 'download' | 'delete' | 'createFolder' | 'copy'
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
        kubernetesActions?: CapabilitySchema<KubernetesActionName>[]
    }
    filters: FieldSchema[]
    columns: TableColumnSchema[]
}

export type KnownResourceType =
    | 'bucket' | 'container' | 'cluster' | 'db-instance' | 'cosmos-database' | 'dynamodb-table'
    | 'instance' | 'image' | 'vpc' | 'lambda' | 'azure-function' | 'gcp-function'
    | 'secret' | 'iam-user' | 'servicebus-namespace' | 'queue' | 'fifo-queue'
    | 'topic' | 'event-bus' | 'rest-api' | 'stack' | 'email' | 'sql-server'
    | 'postgres-flexible-server'

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

export interface ResourceQuery {
    search?: string
}

export interface CreateResourceInput {
    values: Record<string, unknown>
}
export interface ServerlessInvokeResult {
    statusCode: number
    payload: string
    functionError?: string
    logResult?: string
    executionDuration?: number
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
    delete(id: string): Promise<void>
    listObjects?(resourceId: string, prefix?: string): Promise<StorageObjectList>
    putObject?(resourceId: string, key: string, body: Uint8Array, contentType: string): Promise<void>
    getObject?(resourceId: string, key: string): Promise<StorageObjectDownload>
    deleteObject?(resourceId: string, key: string): Promise<void>
    invoke?(id: string, payload: string): Promise<ServerlessInvokeResult>
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
    listNoSqlItems?(resourceId: string): Promise<NoSqlItem[]>
    listKubernetesNodegroups?(clusterId: string): Promise<KubernetesNodegroup[]>
    createKubernetesNodegroup?(clusterId: string, input: CreateKubernetesNodegroupInput): Promise<KubernetesNodegroup>
    deleteKubernetesNodegroup?(clusterId: string, nodegroupId: string): Promise<void>
    listKubernetesFargateProfiles?(clusterId: string): Promise<KubernetesFargateProfile[]>
    createKubernetesFargateProfile?(clusterId: string, input: CreateKubernetesFargateProfileInput): Promise<KubernetesFargateProfile>
    deleteKubernetesFargateProfile?(clusterId: string, profileId: string): Promise<void>
    /** Clears the provider's locally captured email inbox, if it exposes one. */
    clearEmailInbox?(): Promise<void>
}
