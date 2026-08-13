import type {CloudProvider, CloudServiceType} from './cloud'

export interface CloudResource {
    id: string
    name: string
    cloud: CloudProvider
    service: CloudServiceType
    type: 'bucket' | 'container' | 'cluster' | 'db-instance' | 'cosmos-database' | 'sql-server' | 'postgres-flexible-server' | 'instance' | 'image' | 'vpc' | 'lambda' | "azure-function" | 'gcp-function' | 'secret';
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
