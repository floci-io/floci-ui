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
import type {SqlDataClient, SqlDataConnection} from './MssqlDataClient'
import {PostgresDataClient} from './PostgresDataClient'
import {postgresTlsMode} from './sqlTransport'
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

const API_VERSION = '2025-08-01'
const RESOURCE_ID_PREFIX = 'postgres-flexible-server:'
const LIST_DATABASES_QUERY = `
SELECT
    datname AS name,
    CASE WHEN datallowconn THEN 'ONLINE' ELSE 'OFFLINE' END AS state,
    NULL::text AS "createdAt",
    datname IN ('postgres', 'template0', 'template1') AS "isSystem"
FROM pg_database
WHERE datallowconn
ORDER BY "isSystem" DESC, datname`
const LIST_TABLES_QUERY = `
SELECT
    namespace.nspname AS "schemaName",
    relation.relname AS name,
    CASE WHEN relation.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END AS "objectType",
    CASE
        WHEN relation.relkind IN ('r', 'p') AND relation.reltuples >= 0
        THEN relation.reltuples::bigint
        ELSE NULL
    END AS "rowCount"
FROM pg_class AS relation
INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
  AND namespace.nspname NOT LIKE 'pg_toast%'
  AND relation.relkind IN ('r', 'p', 'v', 'm')
ORDER BY namespace.nspname, relation.relname`

interface AzurePostgresListResponse {
    value?: AzurePostgresRecord[]
}

interface AzurePostgresRecord {
    id?: string
    name?: string
    type?: string
    location?: string
    tags?: Record<string, string>
    sku?: Record<string, unknown>
    properties?: Record<string, unknown>
}

export class AzurePostgresAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'database' as const

    constructor(
        private readonly client: AzureRuntimeClient = azure,
        private readonly dataClient: SqlDataClient = new PostgresDataClient(),
    ) {}

    schema(): ServiceSchema {
        return azureDatabaseSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.postgresJson<AzurePostgresListResponse>(postgresServersPath(), {method: 'GET'}, true)
        return filterBySearch((body?.value ?? []).map(toPostgresResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const serverName = postgresServerName(id)
        const body = await this.postgresJson<AzurePostgresRecord>(postgresServerPath(serverName), {method: 'GET'}, true)
        return body ? toPostgresResource(body) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const serverName = stringValue(input.values.serverName)
        const location = stringValue(input.values.location) || 'eastus'
        const administratorLogin = stringValue(input.values.administratorLogin)
        const administratorLoginPassword = stringValue(input.values.administratorLoginPassword)

        if (!serverName) throw new ValidationError('serverName is required')
        if (!isValidServerName(serverName)) throw new ValidationError('Use a valid PostgreSQL flexible server name.')
        if (!administratorLogin) throw new ValidationError('administratorLogin is required')
        if (!administratorLoginPassword) throw new ValidationError('administratorLoginPassword is required')

        const body = await this.postgresJson<AzurePostgresRecord>(postgresServerPath(serverName), {
            method: 'PUT',
            body: JSON.stringify({
                location,
                sku: {name: 'Standard_B1ms', tier: 'Burstable'},
                properties: {
                    administratorLogin,
                    administratorLoginPassword,
                    version: '17',
                    storage: {storageSizeGB: 32},
                },
            }),
        })
        if (!body) throw new RuntimeError('PostgreSQL flexible server creation returned an empty response')
        return toPostgresResource(body)
    }

    async delete(id: string): Promise<void> {
        await this.postgresFetch(postgresServerPath(postgresServerName(id)), {method: 'DELETE'})
    }

    async listSqlDatabases(serverId: string, connection: SqlConnectionInput): Promise<SqlDatabase[]> {
        const result = await this.querySql(serverId, {...connection, database: 'postgres'}, LIST_DATABASES_QUERY)
        return (result.resultSets[0]?.rows ?? []).flatMap((row) => {
            const name = stringValue(row.name)
            if (!name) return []
            return [{
                name,
                state: stringValue(row.state) || 'UNKNOWN',
                createdAt: stringValue(row.createdAt) || null,
                isSystem: row.isSystem === true,
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

    private postgresFetch(path: string, init: RequestInit, emptyOnNotFound = false): Promise<Response | null> {
        return this.client.fetch(withApiVersion(path, API_VERSION), {
            ...init,
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                ...(init.headers ?? {}),
            },
        }, {emptyOnNotFound})
    }

    private async postgresJson<T>(path: string, init: RequestInit, emptyOnNotFound = false): Promise<T | null> {
        const response = await this.postgresFetch(path, init, emptyOnNotFound)
        if (!response || response.status === 204) return null
        return await response.json() as T
    }

    private async dataConnection(serverId: string, input: SqlConnectionInput): Promise<SqlDataConnection> {
        const resource = await this.get(serverId)
        if (!resource) throw new NotFoundError('PostgreSQL flexible server not found')

        const endpoint = recordValue(resource.metadata.endpoint)
        const server = stringValue(endpoint?.address)
        const port = numberValue(endpoint?.port)
        const username = rawStringValue(input.username)
        const password = rawStringValue(input.password)
        const database = stringValue(input.database) || 'postgres'
        const hasLocalPort = endpoint?.port !== undefined && endpoint.port !== null

        // The endpoint comes from the resource the runtime returned, so a missing
        // address is a runtime problem rather than something the caller sent.
        if (!server || port === null) throw new RuntimeError('PostgreSQL server endpoint is not available')
        if (!username) throw new ValidationError('PostgreSQL username is required')
        if (!password) throw new ValidationError('PostgreSQL password is required')

        return {
            server,
            port,
            database,
            username,
            password,
            tlsMode: postgresTlsMode(server, hasLocalPort),
        }
    }
}

export function isPostgresServerResourceId(id: string): boolean {
    return id.startsWith(RESOURCE_ID_PREFIX)
}

function postgresServersPath(): string {
    return `/subscriptions/${encodeURIComponent(azureSubscriptionId())}/resourceGroups/${encodeURIComponent(azureResourceGroup())}/providers/Microsoft.DBforPostgreSQL/flexibleServers`
}

function postgresServerPath(serverName: string): string {
    return `${postgresServersPath()}/${encodeURIComponent(serverName)}`
}

function postgresServerName(id: string): string {
    const name = isPostgresServerResourceId(id) ? id.slice(RESOURCE_ID_PREFIX.length) : id
    if (!name) throw new ValidationError('PostgreSQL flexible server id is required')
    return name
}

function toPostgresResource(server: AzurePostgresRecord): CloudResource {
    const name = stringValue(server.name)
    const properties = server.properties ?? {}
    const sku = recordValue(server.sku)
    const network = recordValue(properties.network)
    const storage = recordValue(properties.storage)
    return {
        id: `${RESOURCE_ID_PREFIX}${name}`,
        name,
        cloud: 'azure',
        service: 'database',
        type: 'postgres-flexible-server',
        region: stringValue(server.location) || null,
        createdAt: null,
        status: stringValue(properties.state) || stringValue(properties.provisioningState) || null,
        engine: 'postgresql',
        version: stringValue(properties.version) || null,
        instanceClass: stringValue(sku?.name) || null,
        metadata: {
            provider: 'azure',
            databaseService: 'postgresql',
            resourceKind: 'flexible-server',
            armId: server.id,
            serverName: name,
            administratorLogin: properties.administratorLogin,
            fullyQualifiedDomainName: properties.fullyQualifiedDomainName,
            publicNetworkAccess: network?.publicNetworkAccess,
            storageSizeGB: storage?.storageSizeGB,
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
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}
