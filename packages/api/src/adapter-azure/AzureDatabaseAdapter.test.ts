import {describe, expect, test} from 'bun:test'
import type {
    CloudResource,
    CreateResourceInput,
    ResourceQuery,
    SqlConnectionInput,
    SqlDatabase,
    SqlQueryResult,
    SqlTable,
} from '../cloud-spi/types'
import {AzureDatabaseAdapter} from './AzureDatabaseAdapter'

describe('AzureDatabaseAdapter', () => {
    test('combines engines and dispatches create and data operations', async () => {
        const calls: string[] = []
        const sql = engineAdapter('sql-server', 'azure-sql', calls)
        const postgres = engineAdapter('postgres-flexible-server', 'postgresql', calls)
        const adapter = new AzureDatabaseAdapter(sql, postgres)

        await expect(adapter.list()).resolves.toHaveLength(2)
        await expect(adapter.create({values: {engine: 'postgresql'}})).resolves.toMatchObject({engine: 'postgresql'})
        await adapter.querySql('postgres-server', {
            username: 'pgadmin',
            password: 'password',
            engine: 'postgresql',
        }, 'SELECT 1')

        expect(calls).toEqual([
            'azure-sql:list',
            'postgresql:list',
            'postgresql:create',
            'postgresql:query',
        ])
    })

    test('still lists one engine when the other is unavailable', async () => {
        const calls: string[] = []
        const sql = engineAdapter('sql-server', 'azure-sql', calls)
        const postgres = engineAdapter('postgres-flexible-server', 'postgresql', calls)
        postgres.list = async () => {
            throw new Error('PostgreSQL is not configured on this runtime')
        }

        const resources = await new AzureDatabaseAdapter(sql, postgres).list()

        expect(resources.map((resource) => resource.type)).toEqual(['sql-server'])
    })

    test('surfaces the failure when both engines are unavailable', async () => {
        const calls: string[] = []
        const sql = engineAdapter('sql-server', 'azure-sql', calls)
        const postgres = engineAdapter('postgres-flexible-server', 'postgresql', calls)
        sql.list = async () => {
            throw new Error('Cannot reach Floci-AZ')
        }
        postgres.list = async () => {
            throw new Error('PostgreSQL is not configured on this runtime')
        }

        await expect(new AzureDatabaseAdapter(sql, postgres).list()).rejects.toThrow('Cannot reach Floci-AZ')
    })
})

function engineAdapter(
    type: 'sql-server' | 'postgres-flexible-server',
    engine: 'azure-sql' | 'postgresql',
    calls: string[],
) {
    const resource: CloudResource = {
        id: `${type}:server`,
        name: 'server',
        cloud: 'azure',
        service: 'database',
        type,
        region: 'eastus',
        createdAt: null,
        engine,
        metadata: {},
    }
    return {
        async list(_query?: ResourceQuery): Promise<CloudResource[]> {
            calls.push(`${engine}:list`)
            return [resource]
        },
        async get(): Promise<CloudResource> {
            return resource
        },
        async create(_input: CreateResourceInput): Promise<CloudResource> {
            calls.push(`${engine}:create`)
            return resource
        },
        async delete(): Promise<void> {},
        async listSqlDatabases(_serverId: string, _connection: SqlConnectionInput): Promise<SqlDatabase[]> {
            return []
        },
        async listSqlTables(_serverId: string, _connection: SqlConnectionInput): Promise<SqlTable[]> {
            return []
        },
        async querySql(_serverId: string, _connection: SqlConnectionInput, _query: string): Promise<SqlQueryResult> {
            calls.push(`${engine}:query`)
            return {resultSets: [], rowsAffected: [], durationMs: 0}
        },
    }
}
