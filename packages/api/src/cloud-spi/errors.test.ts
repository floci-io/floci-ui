import {describe, expect, test} from 'bun:test'
import {
    AccessDeniedError,
    type CloudError,
    type CloudErrorCode,
    type CloudErrorStatus,
    ConflictError,
    NotFoundError,
    NotImplementedByRuntimeError,
    NotSupportedError,
    RateLimitedError,
    RuntimeError,
    RuntimeUnavailableError,
    ValidationError,
    httpStatusToCloudError,
    isUnreachableCause,
    toHttpError,
} from './errors'

describe('CloudError wire shape', () => {
    test('keeps the generic label in message and the raw text in detail', () => {
        const body = new RuntimeUnavailableError('Cannot reach Floci-AZ at http://localhost:4577').toBody()

        expect(body.code).toBe('runtime_unavailable')
        expect(body.message).toBe('Runtime unavailable')
        expect(body.error).toBe(body.message)
        expect(body.detail).toBe('Cannot reach Floci-AZ at http://localhost:4577')
    })

    test('omits detail when it would duplicate the message', () => {
        // ValidationError intentionally uses its own message as the label, so a
        // field-level complaint reaches the UI verbatim instead of being generified.
        const body = new ValidationError('bucketName is required').toBody()

        expect(body.message).toBe('bucketName is required')
        expect(body.detail).toBeUndefined()
    })

    test('preserves the cause chain for debugging', () => {
        const cause = new Error('socket hang up')
        expect(new RuntimeError('wrapped', {cause}).cause).toBe(cause)
    })

    const statuses: Array<[CloudError, CloudErrorStatus, CloudErrorCode]> = [
        [new ValidationError('x'), 400, 'invalid_request'],
        [new AccessDeniedError('x'), 403, 'access_denied'],
        [new NotFoundError('x'), 404, 'resource_not_found'],
        [new ConflictError('x'), 409, 'resource_conflict'],
        [new RateLimitedError('x'), 429, 'rate_limited'],
        [new NotSupportedError('x'), 501, 'operation_not_supported'],
        [new NotImplementedByRuntimeError('x'), 501, 'operation_not_implemented'],
        [new RuntimeError('x'), 502, 'runtime_error'],
        [new RuntimeUnavailableError('x'), 503, 'runtime_unavailable'],
    ]

    for (const [error, status, code] of statuses) {
        test(`${error.name} carries ${status}/${code}`, () => {
            expect(error.status).toBe(status)
            expect(error.code).toBe(code)
            expect(toHttpError(error).status).toBe(status)
        })
    }
})

describe('httpStatusToCloudError', () => {
    const cases: Array<[number, CloudErrorStatus, CloudErrorCode]> = [
        [400, 400, 'invalid_request'],
        [401, 403, 'access_denied'],
        [403, 403, 'access_denied'],
        [404, 404, 'resource_not_found'],
        [409, 409, 'resource_conflict'],
        [429, 429, 'rate_limited'],
        [501, 501, 'operation_not_implemented'],
        [502, 503, 'runtime_unavailable'],
        [503, 503, 'runtime_unavailable'],
        [504, 503, 'runtime_unavailable'],
        [418, 502, 'runtime_error'],
    ]

    for (const [runtimeStatus, expectedStatus, expectedCode] of cases) {
        test(`HTTP ${runtimeStatus} becomes ${expectedStatus}`, () => {
            const error = httpStatusToCloudError(runtimeStatus, `HTTP ${runtimeStatus}`)
            expect(error.status).toBe(expectedStatus)
            expect(error.code).toBe(expectedCode)
        })
    }
})

describe('isUnreachableCause', () => {
    test('detects a nested transport failure code', () => {
        const inner = Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})
        expect(isUnreachableCause(new Error('fetch failed', {cause: inner}))).toBe(true)
    })

    test('detects an aborted or timed-out request by name', () => {
        const timeout = new Error('timed out')
        timeout.name = 'TimeoutError'
        expect(isUnreachableCause(timeout)).toBe(true)
    })

    test('does not treat an ordinary error as unreachable', () => {
        expect(isUnreachableCause(new Error('bucket already exists'))).toBe(false)
        expect(isUnreachableCause('not an error')).toBe(false)
    })
})

describe('toHttpError', () => {
    test('defaults an unknown failure to 502 rather than guessing', () => {
        const {status, body} = toHttpError(new Error('something odd happened'))

        expect(status).toBe(502)
        expect(body.code).toBe('runtime_error')
        expect(body.detail).toBe('something odd happened')
    })

    test('promotes a transport failure to 503 without any message matching', () => {
        const inner = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4566'), {code: 'ECONNREFUSED'})
        expect(toHttpError(new Error('fetch failed', {cause: inner})).status).toBe(503)
    })

    test('lets a vendor mapper win over the generic fallback', () => {
        const {status} = toHttpError(new Error('vendor specific'), () => new ConflictError('already exists'))
        expect(status).toBe(409)
    })

    test('a CloudError outranks the vendor mapper', () => {
        const {status} = toHttpError(new NotFoundError('missing'), () => new ConflictError('nope'))
        expect(status).toBe(404)
    })

    test('handles a non-Error throw', () => {
        expect(toHttpError('boom').status).toBe(502)
    })
})
