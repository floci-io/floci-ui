import {
    azure,
    azureResourceGroup,
    type AzureRuntimeClient,
    azureSubscriptionId,
} from '../azure'
import {azureDatabaseSchema} from '../cloud-spi/databaseSchema'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
    SqlConnectionInput,
    SqlDatabase,
    SqlQueryResult,
    SqlTable,
} from '../cloud-spi/types'
import {MssqlDataClient, type SqlDataClient, type SqlDataConnection} from './MssqlDataClient'
import {azureSqlTlsMode} from './sqlTransport'
import {
    filterBySearch,
    isValidServerName,
    numberValue,
    rawStringValue,
    recordValue,
    stringValue,
    tagList,
    withApiVersion,
} from './sqlAdapterUtils'

const API_VERSION = '2021-11-01'
const RESOURCE_ID_PREFIX = 'sql-server:'
const LIST_DATABASES_QUERY = `
SELECT
    name,
    state_desc AS state,
    create_date AS createdAt,
    CAST(CASE WHEN database_id <= 4 THEN 1 ELSE 0 END AS bit) AS isSystem
FROM sys.databases
ORDER BY database_id`
const LIST_TABLES_QUERY = `
SELECT
    schemas.name AS [schemaName],
    tables.name,
    'table' AS [objectType],
    SUM(partitions.rows) AS [rowCount]
FROM sys.tables AS tables
INNER JOIN sys.schemas AS schemas ON schemas.schema_id = tables.schema_id
LEFT JOIN sys.partitions AS partitions
    ON partitions.object_id = tables.object_id AND partitions.index_id IN (0, 1)
GROUP BY schemas.name, tables.name
UNION ALL
SELECT schemas.name, views.name, 'view', NULL
FROM sys.views AS views
INNER JOIN sys.schemas AS schemas ON schemas.schema_id = views.schema_id
ORDER BY [schemaName], name`

interface AzureSqlListResponse {
    value?: AzureSqlRecord[]
}

interface AzureSqlRecord {
    id?: string
    name?: string
    type?: string
    location?: string
    kind?: string
    tags?: Record<string, string>
    properties?: Record<string, unknown>
}

export class AzureSqlAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'database' as const

    constructor(
        private readonly client: AzureRuntimeClient = azure,
        private readonly dataClient: SqlDataClient = new MssqlDataClient(),
    ) {}

    schema(): ServiceSchema {
        return azureDatabaseSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.sqlJson<AzureSqlListResponse>(sqlServersPath(), {method: 'GET'}, true)
        return filterBySearch((body?.value ?? []).map(toSqlServerResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const serverName = sqlServerName(id)
        const body = await this.sqlJson<AzureSqlRecord>(sqlServerPath(serverName), {method: 'GET'}, true)
        return body ? toSqlServerResource(body) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const serverName = stringValue(input.values.serverName)
        const location = stringValue(input.values.location) || 'eastus'
        const administratorLogin = stringValue(input.values.administratorLogin)
        const administratorLoginPassword = stringValue(input.values.administratorLoginPassword)

        if (!serverName) throw new ValidationError('serverName is required')
        if (!isValidServerName(serverName)) throw new ValidationError('Use a valid Azure SQL server name.')
        if (!administratorLogin) throw new ValidationError('administratorLogin is required')
        if (!administratorLoginPassword) throw new ValidationError('administratorLoginPassword is required')

        const body = await this.sqlJson<AzureSqlRecord>(sqlServerPath(serverName), {
            method: 'PUT',
            body: JSON.stringify({
                location,
                properties: {administratorLogin, administratorLoginPassword},
            }),
        })
        if (!body) throw new RuntimeError('Azure SQL server creation returned an empty response')
        return toSqlServerResource(body)
    }

    async delete(id: string): Promise<void> {
        await this.sqlFetch(sqlServerPath(sqlServerName(id)), {method: 'DELETE'})
    }

    async listSqlDatabases(serverId: string, connection: SqlConnectionInput): Promise<SqlDatabase[]> {
        const result = await this.querySql(serverId, {...connection, database: 'master'}, LIST_DATABASES_QUERY)
        return (result.resultSets[0]?.rows ?? []).flatMap((row) => {
            const name = stringValue(row.name)
            if (!name) return []
            return [{
                name,
                state: stringValue(row.state) || 'UNKNOWN',
                createdAt: stringValue(row.createdAt) || null,
                isSystem: row.isSystem === true || row.isSystem === 1,
            }]
        })
    }

    async listSqlTables(serverId: string, connection: SqlConnectionInput): Promise<SqlTable[]> {
        const result = await this.querySql(serverId, connection, LIST_TABLES_QUERY)
        return (result.resultSets[0]?.rows ?? []).flatMap((row) => {
            const schema = stringValue(row.schemaName)
            const name = stringValue(row.name)
            if (!schema || !name) return []
            return [{
                schema,
                name,
                type: row.objectType === 'view' ? 'view' as const : 'table' as const,
                rowCount: integerValue(row.rowCount),
            }]
        })
    }

    async querySql(serverId: string, connection: SqlConnectionInput, query: string): Promise<SqlQueryResult> {
        if (!query.trim()) throw new ValidationError('SQL query is required')
        return this.dataClient.query(await this.dataConnection(serverId, connection), query)
    }

    private sqlFetch(path: string, init: RequestInit, emptyOnNotFound = false): Promise<Response | null> {
        return this.client.fetch(withApiVersion(path, API_VERSION), {
            ...init,
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                ...(init.headers ?? {}),
            },
        }, {emptyOnNotFound})
    }

    private async sqlJson<T>(path: string, init: RequestInit, emptyOnNotFound = false): Promise<T | null> {
        const response = await this.sqlFetch(path, init, emptyOnNotFound)
        if (!response || response.status === 204) return null
        return await response.json() as T
    }

    private async dataConnection(serverId: string, input: SqlConnectionInput): Promise<SqlDataConnection> {
        const resource = await this.get(serverId)
        if (!resource) throw new NotFoundError('Azure SQL server not found')

        const endpoint = recordValue(resource.metadata.endpoint)
        const server = stringValue(endpoint?.address)
        const port = numberValue(endpoint?.port)
        const username = rawStringValue(input.username)
        const password = rawStringValue(input.password)
        const database = stringValue(input.database) || 'master'
        const minimalTlsVersion = stringValue(resource.metadata.minimalTlsVersion) || null
        const hasLocalPort = endpoint?.port !== undefined && endpoint.port !== null

        // The endpoint comes from the resource the runtime returned, so a missing
        // address is a runtime problem rather than something the caller sent.
        if (!server || port === null) throw new RuntimeError('Azure SQL server endpoint is not available')
        if (!username) throw new ValidationError('SQL username is required')
        if (!password) throw new ValidationError('SQL password is required')

        return {
            server,
            port,
            database,
            username,
            password,
            tlsMode: azureSqlTlsMode(server, minimalTlsVersion, hasLocalPort),
        }
    }
}

export function isSqlServerResourceId(id: string): boolean {
    return id.startsWith(RESOURCE_ID_PREFIX)
}

function sqlServersPath(): string {
    return `/subscriptions/${encodeURIComponent(azureSubscriptionId())}/resourceGroups/${encodeURIComponent(azureResourceGroup())}/providers/Microsoft.Sql/servers`
}

function sqlServerPath(serverName: string): string {
    return `${sqlServersPath()}/${encodeURIComponent(serverName)}`
}

function sqlServerName(id: string): string {
    const name = isSqlServerResourceId(id) ? id.slice(RESOURCE_ID_PREFIX.length) : id
    if (!name) throw new ValidationError('Azure SQL server id is required')
    return name
}

function toSqlServerResource(server: AzureSqlRecord): CloudResource {
    const name = stringValue(server.name)
    const properties = server.properties ?? {}
    return {
        id: `${RESOURCE_ID_PREFIX}${name}`,
        name,
        cloud: 'azure',
        service: 'database',
        type: 'sql-server',
        region: stringValue(server.location) || null,
        createdAt: null,
        status: stringValue(properties.state) || null,
        engine: 'azure-sql',
        version: stringValue(properties.version) || null,
        instanceClass: stringValue(server.kind) || null,
        metadata: {
            provider: 'azure',
            databaseService: 'sql',
            resourceKind: 'server',
            armId: server.id,
            serverName: name,
            administratorLogin: properties.administratorLogin,
            fullyQualifiedDomainName: properties.fullyQualifiedDomainName,
            publicNetworkAccess: properties.publicNetworkAccess,
            minimalTlsVersion: properties.minimalTlsVersion,
            endpoint: {
                address: properties.fullyQualifiedDomainName,
                port: numberValue(properties.localPort),
            },
            tags: tagList(server.tags),
        },
    }
}

function integerValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
}
