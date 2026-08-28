import {describe, expect, test} from 'bun:test'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'
import {toHttpError} from '../cloud-spi/errors'
import {AzureSqlAdapter} from './AzureSqlAdapter'
import type {SqlDataClient, SqlDataConnection} from './MssqlDataClient'

const SERVERS_PATH = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/floci-local/providers/Microsoft.Sql/servers'
const API_VERSION = '?api-version=2021-11-01'

describe('AzureSqlAdapter', () => {
    test('normalizes Azure SQL servers as cloud database resources', async () => {
        const adapter = new AzureSqlAdapter(testClient({
            [`${SERVERS_PATH}${API_VERSION}`]: {
                value: [{
                    id: `${SERVERS_PATH}/app-sql`,
                    name: 'app-sql',
                    type: 'Microsoft.Sql/servers',
                    location: 'eastus',
                    kind: 'v12.0',
                    tags: {environment: 'test'},
                    properties: {
                        administratorLogin: 'sa',
                        version: '12.0',
                        state: 'Ready',
                        fullyQualifiedDomainName: 'localhost',
                        localPort: 14330,
                        publicNetworkAccess: 'Enabled',
                    },
                }],
            },
        }))

        await expect(adapter.list()).resolves.toEqual([{
            id: 'sql-server:app-sql',
            name: 'app-sql',
            cloud: 'azure',
            service: 'database',
            type: 'sql-server',
            region: 'eastus',
            createdAt: null,
            status: 'Ready',
            engine: 'azure-sql',
            version: '12.0',
            instanceClass: 'v12.0',
            metadata: {
                provider: 'azure',
                databaseService: 'sql',
                resourceKind: 'server',
                armId: `${SERVERS_PATH}/app-sql`,
                serverName: 'app-sql',
                administratorLogin: 'sa',
                fullyQualifiedDomainName: 'localhost',
                publicNetworkAccess: 'Enabled',
                minimalTlsVersion: undefined,
                endpoint: {address: 'localhost', port: 14330},
                tags: [{key: 'environment', value: 'test'}],
            },
        }])
    })

    test('creates an Azure SQL server through the ARM contract', async () => {
        const calls: Array<{path: string; init: RequestInit}> = []
        const serverPath = `${SERVERS_PATH}/app-sql${API_VERSION}`
        const adapter = new AzureSqlAdapter(testClient({
            [serverPath]: {
                id: `${SERVERS_PATH}/app-sql`,
                name: 'app-sql',
                location: 'uksouth',
                properties: {state: 'Ready', version: '12.0'},
            },
        }, calls))

        const resource = await adapter.create({values: {
            serverName: 'app-sql',
            location: 'uksouth',
            administratorLogin: 'sqladmin',
            administratorLoginPassword: 'StrongPassw0rd!',
        }})

        expect(resource.id).toBe('sql-server:app-sql')
        expect(calls).toHaveLength(1)
        expect(calls[0].path).toBe(serverPath)
        expect(calls[0].init.method).toBe('PUT')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            location: 'uksouth',
            properties: {
                administratorLogin: 'sqladmin',
                administratorLoginPassword: 'StrongPassw0rd!',
            },
        })
    })

    test('gets and deletes a SQL server by its normalized id', async () => {
        const calls: Array<{path: string; init: RequestInit}> = []
        const serverPath = `${SERVERS_PATH}/app-sql${API_VERSION}`
        const adapter = new AzureSqlAdapter(testClient({
            [serverPath]: {name: 'app-sql', location: 'eastus', properties: {state: 'Ready'}},
        }, calls))

        await expect(adapter.get('sql-server:app-sql')).resolves.toMatchObject({name: 'app-sql', type: 'sql-server'})
        await adapter.delete('sql-server:app-sql')

        expect(calls.map((call) => [call.init.method, call.path])).toEqual([
            ['GET', serverPath],
            ['DELETE', serverPath],
        ])
    })

    test('returns null when an Azure SQL server is not found', async () => {
        const adapter = new AzureSqlAdapter(testClient({}))
        await expect(adapter.get('sql-server:missing')).resolves.toBeNull()
    })

    test('browses databases and tables and runs T-SQL through the server endpoint', async () => {
        const serverPath = `${SERVERS_PATH}/app-sql${API_VERSION}`
        const dataCalls: Array<{connection: SqlDataConnection; query: string}> = []
        const dataClient: SqlDataClient = {
            async query(connection, query) {
                dataCalls.push({connection, query})
                if (query.includes('FROM sys.databases')) {
                    return sqlResult([{name: 'master', state: 'ONLINE', createdAt: '2026-01-01T00:00:00.000Z', isSystem: true}])
                }
                if (query.includes('FROM sys.tables')) {
                    return sqlResult([{schemaName: 'dbo', name: 'orders', objectType: 'table', rowCount: '42'}])
                }
                return sqlResult([{orderId: 1042}], [1])
            },
        }
        const adapter = new AzureSqlAdapter(testClient({
            [serverPath]: {
                name: 'app-sql',
                properties: {
                    fullyQualifiedDomainName: 'app-sql.local',
                    localPort: 1433,
                    minimalTlsVersion: 'None',
                },
            },
        }), dataClient)
        const credentials = {username: 'sa', password: 'LocalDev!2026'}

        await expect(adapter.listSqlDatabases('sql-server:app-sql', credentials)).resolves.toEqual([{
            name: 'master',
            state: 'ONLINE',
            createdAt: '2026-01-01T00:00:00.000Z',
            isSystem: true,
        }])
        await expect(adapter.listSqlTables('sql-server:app-sql', {...credentials, database: 'ordersdb'})).resolves.toEqual([{
            schema: 'dbo',
            name: 'orders',
            type: 'table',
            rowCount: 42,
        }])
        await expect(adapter.querySql('sql-server:app-sql', {...credentials, database: 'ordersdb'}, 'SELECT * FROM dbo.orders')).resolves.toEqual(
            sqlResult([{orderId: 1042}], [1]),
        )

        expect(dataCalls).toHaveLength(3)
        expect(dataCalls[0].connection).toEqual({
            server: 'app-sql.local',
            port: 1433,
            database: 'master',
            username: 'sa',
            password: 'LocalDev!2026',
            tlsMode: 'trust-server-certificate',
        })
        expect(dataCalls[1].connection.database).toBe('ordersdb')
        expect(dataCalls[2].query).toBe('SELECT * FROM dbo.orders')
    })

    test('rejects a blank query before looking the server up', async () => {
        const calls: Array<{path: string; init: RequestInit}> = []
        const adapter = new AzureSqlAdapter(testClient({}, calls))

        await expect(adapter.querySql('sql-server:missing', {username: 'sa', password: 'LocalDev!2026'}, '   '))
            .rejects.toThrow('SQL query is required')
        expect(calls).toEqual([])
    })

    test('reports bad input as 400 and a missing server as 404', async () => {
        const existing = new AzureSqlAdapter(testClient({
            [`${SERVERS_PATH}/app-sql${API_VERSION}`]: {
                name: 'app-sql',
                properties: {fullyQualifiedDomainName: 'app-sql.local', localPort: 1433},
            },
        }))
        const missing = new AzureSqlAdapter(testClient({}))

        expect(await httpStatusOf(() => existing.create({values: {}}))).toBe(400)
        expect(await httpStatusOf(() => existing.create({values: {serverName: 'App_SQL'}}))).toBe(400)
        expect(await httpStatusOf(() => existing.create({values: {serverName: 'app-sql'}}))).toBe(400)
        expect(await httpStatusOf(() => existing.querySql('sql-server:app-sql', {username: 'sa', password: 'x'}, ''))).toBe(400)
        expect(await httpStatusOf(() => existing.querySql('sql-server:app-sql', {username: '', password: ''}, 'SELECT 1'))).toBe(400)
        expect(await httpStatusOf(() => existing.get(''))).toBe(400)

        expect(await httpStatusOf(() => missing.querySql('sql-server:gone', {username: 'sa', password: 'x'}, 'SELECT 1'))).toBe(404)
    })
})

async function httpStatusOf(operation: () => Promise<unknown>): Promise<number> {
    const failure = await operation().then(() => null, (err: unknown) => err)
    expect(failure).not.toBeNull()
    return toHttpError(failure).status
}

function sqlResult(rows: Array<Record<string, unknown>>, rowsAffected: number[] = []) {
    return {
        resultSets: [{
            columns: Object.keys(rows[0] ?? {}).map((name) => ({name, type: 'nvarchar'})),
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
