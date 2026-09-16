import {Client, types} from 'pg'
import type {QueryResult} from 'pg'
import type {SqlColumn, SqlQueryResult, SqlResultSet} from '../cloud-spi/types'
import type {SqlDataConnection, SqlDataClient} from './MssqlDataClient'
import {mapSqlDataError, type SqlDataPhase} from './sqlDataErrors'
import {normalizeSqlRow} from './sqlValues'

const MAX_ROWS_PER_RESULT_SET = 500
const TYPE_NAMES = new Map(
    Object.entries(types.builtins)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([name, oid]) => [oid, name.toLowerCase()]),
)

export class PostgresDataClient implements SqlDataClient {
    async query(connection: SqlDataConnection, query: string): Promise<SqlQueryResult> {
        const client = new Client({
            host: connection.server,
            port: connection.port,
            database: connection.database,
            user: connection.username,
            password: connection.password,
            ssl: connection.tlsMode === 'disable'
                ? false
                : {rejectUnauthorized: connection.tlsMode === 'verify'},
            connectionTimeoutMillis: 10_000,
            query_timeout: 30_000,
            statement_timeout: 30_000,
            application_name: 'Floci UI',
        })
        const startedAt = performance.now()
        let phase: SqlDataPhase = 'connect'

        try {
            await client.connect()
            phase = 'query'
            const rawResult = await client.query<Record<string, unknown>>(query)
            phase = 'result'
            const results = (Array.isArray(rawResult) ? rawResult : [rawResult]) as QueryResult<Record<string, unknown>>[]
            return {
                resultSets: results.filter((result) => result.fields.length > 0).map(toResultSet),
                rowsAffected: results.map((result) => result.rowCount ?? 0),
                durationMs: Math.round(performance.now() - startedAt),
            }
        } catch (error) {
            throw mapSqlDataError('PostgreSQL', phase, error)
        } finally {
            await client.end().catch(() => undefined)
        }
    }
}

function toResultSet(result: QueryResult<Record<string, unknown>>): SqlResultSet {
    return {
        columns: result.fields.map((field): SqlColumn => ({
            name: field.name,
            type: TYPE_NAMES.get(field.dataTypeID) ?? `oid:${field.dataTypeID}`,
        })),
        rows: result.rows.slice(0, MAX_ROWS_PER_RESULT_SET).map(normalizeSqlRow),
        truncated: result.rows.length > MAX_ROWS_PER_RESULT_SET,
    }
}
