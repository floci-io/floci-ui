import sql from 'mssql'
import type {config as MssqlConfig, IRecordSet} from 'mssql'
import type {SqlColumn, SqlQueryResult, SqlResultSet} from '../cloud-spi/types'
import {mapSqlDataError, type SqlDataPhase} from './sqlDataErrors'
import type {SqlTlsMode} from './sqlTransport'
import {normalizeSqlRow} from './sqlValues'

const MAX_ROWS_PER_RESULT_SET = 500

export interface SqlDataConnection {
    server: string
    port: number
    database: string
    username: string
    password: string
    tlsMode: SqlTlsMode
}

export interface SqlDataClient {
    query(connection: SqlDataConnection, query: string): Promise<SqlQueryResult>
}

export class MssqlDataClient implements SqlDataClient {
    async query(connection: SqlDataConnection, query: string): Promise<SqlQueryResult> {
        const pool = new sql.ConnectionPool(connectionConfig(connection))
        const startedAt = performance.now()
        let phase: SqlDataPhase = 'connect'

        try {
            await pool.connect()
            phase = 'query'
            const result = await pool.request().query<Record<string, unknown>>(query)
            phase = 'result'
            return {
                resultSets: result.recordsets.map(toResultSet),
                rowsAffected: result.rowsAffected,
                durationMs: Math.round(performance.now() - startedAt),
            }
        } catch (error) {
            throw mapSqlDataError('Azure SQL', phase, error)
        } finally {
            await pool.close().catch(() => undefined)
        }
    }
}

function connectionConfig(connection: SqlDataConnection): MssqlConfig {
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
            encrypt: connection.tlsMode !== 'disable',
            trustServerCertificate: connection.tlsMode !== 'verify',
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
