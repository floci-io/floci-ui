import sql from 'mssql'
import type {config as MssqlConfig, IRecordSet} from 'mssql'
import type {SqlColumn, SqlQueryResult, SqlResultSet} from '../cloud-spi/types'
import {isLoopbackSqlHost} from './sqlTransport'
import {normalizeSqlRow} from './sqlValues'

const MAX_ROWS_PER_RESULT_SET = 500

export interface SqlDataConnection {
    server: string
    port: number
    database: string
    username: string
    password: string
}

export interface SqlDataClient {
    query(connection: SqlDataConnection, query: string): Promise<SqlQueryResult>
}

export class MssqlDataClient implements SqlDataClient {
    async query(connection: SqlDataConnection, query: string): Promise<SqlQueryResult> {
        const pool = new sql.ConnectionPool(connectionConfig(connection))
        const startedAt = performance.now()

        try {
            await pool.connect()
            const result = await pool.request().query<Record<string, unknown>>(query)
            return {
                resultSets: result.recordsets.map(toResultSet),
                rowsAffected: result.rowsAffected,
                durationMs: Math.round(performance.now() - startedAt),
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown SQL Server error'
            throw new Error(`Azure SQL data request failed: ${message}`, {cause: error})
        } finally {
            await pool.close().catch(() => undefined)
        }
    }
}

function connectionConfig(connection: SqlDataConnection): MssqlConfig {
    // A local emulator serves plain TCP, so TLS is relaxed only for loopback.
    const local = isLoopbackSqlHost(connection.server)
    return {
        user: connection.username,
        password: connection.password,
        server: connection.server,
        port: connection.port,
        database: connection.database,
        connectionTimeout: 10_000,
        requestTimeout: 30_000,
        pool: {min: 0, max: 1, idleTimeoutMillis: 5_000},
        options: {
            encrypt: !local,
            trustServerCertificate: local,
            appName: 'Floci UI',
        },
    }
}

function toResultSet(recordset: IRecordSet<Record<string, unknown>>): SqlResultSet {
    return {
        columns: Object.values(recordset.columns)
            .sort((left, right) => left.index - right.index)
            .map((column): SqlColumn => ({
                name: column.name,
                type: sqlTypeName(column.type),
            })),
        rows: recordset.slice(0, MAX_ROWS_PER_RESULT_SET).map(normalizeSqlRow),
        truncated: recordset.length > MAX_ROWS_PER_RESULT_SET,
    }
}

function sqlTypeName(type: unknown): string {
    if (type && (typeof type === 'object' || typeof type === 'function') && 'declaration' in type) {
        const declaration = (type as {declaration?: unknown}).declaration
        if (typeof declaration === 'string') return declaration
    }
    return 'unknown'
}
