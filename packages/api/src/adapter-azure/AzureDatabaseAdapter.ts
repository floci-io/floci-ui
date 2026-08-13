import {azureDatabaseSchema} from '../cloud-spi/databaseSchema'
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
import {AzurePostgresAdapter, isPostgresServerResourceId} from './AzurePostgresAdapter'
import {AzureSqlAdapter, isSqlServerResourceId} from './AzureSqlAdapter'

interface AzureDatabaseEngineAdapter {
    list(query?: ResourceQuery): Promise<CloudResource[]>
    get(id: string): Promise<CloudResource | null>
    create(input: CreateResourceInput): Promise<CloudResource>
    delete(id: string): Promise<void>
    listSqlDatabases(serverId: string, connection: SqlConnectionInput): Promise<SqlDatabase[]>
    listSqlTables(serverId: string, connection: SqlConnectionInput): Promise<SqlTable[]>
    querySql(serverId: string, connection: SqlConnectionInput, query: string): Promise<SqlQueryResult>
}

export class AzureDatabaseAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'database' as const

    constructor(
        private readonly sql: AzureDatabaseEngineAdapter = new AzureSqlAdapter(),
        private readonly postgres: AzureDatabaseEngineAdapter = new AzurePostgresAdapter(),
    ) {}

    schema(): ServiceSchema {
        return azureDatabaseSchema()
    }

    // The two engines are independent resource groups. A deployment that runs only one of
    // them must still list that one, so a single engine failing is tolerated; both failing
    // still surfaces, and so does any failure once the other engine has answered nothing.
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const [sqlServers, postgresServers] = await Promise.allSettled([
            this.sql.list(query),
            this.postgres.list(query),
        ])

        if (sqlServers.status === 'rejected' && postgresServers.status === 'rejected') {
            throw sqlServers.reason
        }

        return [
            ...(sqlServers.status === 'fulfilled' ? sqlServers.value : []),
            ...(postgresServers.status === 'fulfilled' ? postgresServers.value : []),
        ]
    }

    async get(id: string): Promise<CloudResource | null> {
        if (isPostgresServerResourceId(id)) return this.postgres.get(id)
        if (isSqlServerResourceId(id)) return this.sql.get(id)
        const sqlServer = await this.sql.get(id)
        return sqlServer ?? this.postgres.get(id)
    }

    create(input: CreateResourceInput): Promise<CloudResource> {
        return input.values.engine === 'postgresql'
            ? this.postgres.create(input)
            : this.sql.create(input)
    }

    delete(id: string): Promise<void> {
        return isPostgresServerResourceId(id)
            ? this.postgres.delete(id)
            : this.sql.delete(id)
    }

    listSqlDatabases(serverId: string, connection: SqlConnectionInput): Promise<SqlDatabase[]> {
        return this.dataAdapter(serverId, connection).listSqlDatabases(serverId, connection)
    }

    listSqlTables(serverId: string, connection: SqlConnectionInput): Promise<SqlTable[]> {
        return this.dataAdapter(serverId, connection).listSqlTables(serverId, connection)
    }

    querySql(serverId: string, connection: SqlConnectionInput, query: string): Promise<SqlQueryResult> {
        return this.dataAdapter(serverId, connection).querySql(serverId, connection, query)
    }

    private dataAdapter(serverId: string, connection: SqlConnectionInput): AzureDatabaseEngineAdapter {
        return connection.engine === 'postgresql' || isPostgresServerResourceId(serverId)
            ? this.postgres
            : this.sql
    }
}
