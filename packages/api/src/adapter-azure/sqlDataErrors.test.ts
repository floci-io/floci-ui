import {describe, expect, test} from 'bun:test'
import {toHttpError} from '../cloud-spi/errors'
import {mapSqlDataError} from './sqlDataErrors'

describe('mapSqlDataError', () => {
    test('maps connection failures to runtime unavailable', () => {
        expect(toHttpError(mapSqlDataError('Azure SQL', 'connect', new Error('login failed')))).toMatchObject({
            status: 503,
            body: {code: 'runtime_unavailable'},
        })
    })

    test('maps query errors to invalid requests', () => {
        expect(toHttpError(mapSqlDataError('PostgreSQL', 'query', new Error('syntax error')))).toMatchObject({
            status: 400,
            body: {code: 'invalid_request'},
        })
    })

    test('keeps transport failures unavailable during queries', () => {
        const error = Object.assign(new Error('connection reset'), {code: 'ECONNRESET'})

        expect(toHttpError(mapSqlDataError('PostgreSQL', 'query', error))).toMatchObject({
            status: 503,
            body: {code: 'runtime_unavailable'},
        })
    })

    test('maps result-processing failures to runtime errors', () => {
        expect(toHttpError(mapSqlDataError('Azure SQL', 'result', new Error('invalid result')))).toMatchObject({
            status: 502,
            body: {code: 'runtime_error'},
        })
    })
})
