import {describe, expect, test} from 'bun:test'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'
import {toHttpError} from '../cloud-spi/errors'
import {AzurePostgresAdapter} from './AzurePostgresAdapter'
import type {SqlDataClient, SqlDataConnection} from './MssqlDataClient'

const SERVERS_PATH = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/floci-local/providers/Microsoft.DBforPostgreSQL/flexibleServers'
const API_VERSION = '?api-version=2025-08-01'

describe('AzurePostgresAdapter', () => {
    test('normalizes PostgreSQL flexible servers', async () => {
        const adapter = new AzurePostgresAdapter(testClient({
            [`${SERVERS_PATH}${API_VERSION}`]: {
                value: [postgresRecord()],
            },
        }))

        await expect(adapter.list()).resolves.toEqual([{
            id: 'postgres-flexible-server:app-postgres',
            name: 'app-postgres',
            cloud: 'azure',
            service: 'database',
            type: 'postgres-flexible-server',
            region: 'eastus',
            createdAt: null,
            status: 'Ready',
            engine: 'postgresql',
            version: '17',
            instanceClass: 'Standard_B1ms',
            metadata: {
                provider: 'azure',
                databaseService: 'postgresql',
                resourceKind: 'flexible-server',
                armId: `${SERVERS_PATH}/app-postgres`,
                serverName: 'app-postgres',
                administratorLogin: 'pgadmin',
                fullyQualifiedDomainName: 'app-postgres.local',
                publicNetworkAccess: 'Enabled',
                storageSizeGB: 32,
                endpoint: {address: 'app-postgres.local', port: 5432},
                tags: [{key: 'environment', value: 'test'}],
            },
        }])
    })

    test('creates a PostgreSQL flexible server through the ARM contract', async () => {
        const calls: Array<{path: string; init: RequestInit}> = []
        const serverPath = `${SERVERS_PATH}/app-postgres${API_VERSION}`
        const adapter = new AzurePostgresAdapter(testClient({
            [serverPath]: postgresRecord(),
        }, calls))

        await expect(adapter.create({values: {
            serverName: 'app-postgres',
            location: 'eastus',
            administratorLogin: 'pgadmin',
            administratorLoginPassword: 'StrongPassw0rd!',
        }})).resolves.toMatchObject({
            id: 'postgres-flexible-server:app-postgres',
            engine: 'postgresql',
        })

        expect(calls[0].path).toBe(serverPath)
        expect(calls[0].init.method).toBe('PUT')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            location: 'eastus',
            sku: {name: 'Standard_B1ms', tier: 'Burstable'},
            properties: {
                administratorLogin: 'pgadmin',
                administratorLoginPassword: 'StrongPassw0rd!',
                version: '17',
                storage: {storageSizeGB: 32},
            },
        })
    })

    test('browses databases and tables and runs PostgreSQL SQL', async () => {
        const serverPath = `${SERVERS_PATH}/app-postgres${API_VERSION}`
        const dataCalls: Array<{connection: SqlDataConnection; query: string}> = []
        const dataClient: SqlDataClient = {
            async query(connection, query) {
                dataCalls.push({connection, query})
                if (query.includes('FROM pg_database')) {
                    return sqlResult([{name: 'postgres', state: 'ONLINE', createdAt: null, isSystem: true}])
                }
                if (query.includes('FROM pg_class')) {
                    return sqlResult([{schemaName: 'public', name: 'orders', objectType: 'table', rowCount: '3'}])
                }
                return sqlResult([{order_id: 1042}], [1])
            },
        }
        const adapter = new AzurePostgresAdapter(testClient({
            [serverPath]: postgresRecord(),
        }), dataClient)
        const connection = {
            username: 'pgadmin',
            password: 'StrongPassw0rd!',
            engine: 'postgresql' as const,
        }

        await expect(adapter.listSqlDatabases('app-postgres', connection)).resolves.toEqual([{
            name: 'postgres',
            state: 'ONLINE',
            createdAt: null,
            isSystem: true,
        }])
        await expect(adapter.listSqlTables('app-postgres', {...connection, database: 'appdb'})).resolves.toEqual([{
            schema: 'public',
            name: 'orders',
            type: 'table',
            rowCount: 3,
        }])
        await expect(adapter.querySql('app-postgres', {...connection, database: 'appdb'}, 'SELECT * FROM orders')).resolves.toEqual(
            sqlResult([{order_id: 1042}], [1]),
        )

        expect(dataCalls[0].connection).toEqual({
            server: 'app-postgres.local',
            port: 5432,
            database: 'postgres',
            username: 'pgadmin',
            password: 'StrongPassw0rd!',
            tlsMode: 'disable',
        })
        expect(dataCalls[1].connection.database).toBe('appdb')
        expect(dataCalls[2].query).toBe('SELECT * FROM orders')
    })

    test('reports bad input as 400 and a missing server as 404', async () => {
        const existing = new AzurePostgresAdapter(testClient({
            [`${SERVERS_PATH}/app-postgres${API_VERSION}`]: postgresRecord(),
        }))
        const missing = new AzurePostgresAdapter(testClient({}))

        expect(await httpStatusOf(() => existing.create({values: {}}))).toBe(400)
        expect(await httpStatusOf(() => existing.create({values: {serverName: 'App_Postgres'}}))).toBe(400)
        expect(await httpStatusOf(() => existing.create({values: {serverName: 'app-postgres'}}))).toBe(400)
        expect(await httpStatusOf(() => existing.querySql('app-postgres', {username: 'pgadmin', password: 'x'}, ''))).toBe(400)
        expect(await httpStatusOf(() => existing.querySql('app-postgres', {username: '', password: ''}, 'SELECT 1'))).toBe(400)
        expect(await httpStatusOf(() => existing.get(''))).toBe(400)

        expect(await httpStatusOf(() => missing.querySql('gone', {username: 'pgadmin', password: 'x'}, 'SELECT 1'))).toBe(404)
    })
})

async function httpStatusOf(operation: () => Promise<unknown>): Promise<number> {
    const failure = await operation().then(() => null, (err: unknown) => err)
    expect(failure).not.toBeNull()
    return toHttpError(failure).status
}

function postgresRecord() {
    return {
        id: `${SERVERS_PATH}/app-postgres`,
        name: 'app-postgres',
        type: 'Microsoft.DBforPostgreSQL/flexibleServers',
        location: 'eastus',
        tags: {environment: 'test'},
        sku: {name: 'Standard_B1ms', tier: 'Burstable'},
        properties: {
            administratorLogin: 'pgadmin',
            version: '17',
            state: 'Ready',
            fullyQualifiedDomainName: 'app-postgres.local',
            localPort: 5432,
            storage: {storageSizeGB: 32},
            network: {publicNetworkAccess: 'Enabled'},
        },
    }
}

function sqlResult(rows: Array<Record<string, unknown>>, rowsAffected: number[] = []) {
    return {
        resultSets: [{
            columns: Object.keys(rows[0] ?? {}).map((name) => ({name, type: 'text'})),
            rows,
            truncated: false,
        }],
        rowsAffected,
        durationMs: 1,
    }
}

function testClient(responses: Record<string, unknown>, calls: Array<{path: string; init: RequestInit}> = []): AzureRuntimeClient {
    return {
        endpoint: 'http://localhost:4577',
        accountName: 'devstoreaccount1',
        async fetch(path: string, init: RequestInit, options: AzureRuntimeFetchOptions = {}) {
            calls.push({path, init})
            if (!(path in responses)) {
                if (options.emptyOnNotFound) return null
                throw new Error(`Unexpected Azure runtime request: ${path}`)
            }
            return new Response(JSON.stringify(responses[path]), {status: 200, headers: {'content-type': 'application/json'}})
        },
    }
}
