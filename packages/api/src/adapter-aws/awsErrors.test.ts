import {describe, expect, test} from 'bun:test'
import type {CloudErrorCode, CloudErrorStatus} from '../cloud-spi/errors'
import {isAwsSdkError, mapAwsSdkError} from './awsErrors'

/** Build an error shaped like an AWS SDK v3 failure. */
function sdkError(name: string, extra: Record<string, unknown> = {}): Error {
    const err = new Error(`${name} from the runtime`)
    err.name = name
    return Object.assign(err, {$fault: 'client', $metadata: {httpStatusCode: 500}, ...extra})
}

describe('isAwsSdkError', () => {
    test('recognises the SDK envelope', () => {
        expect(isAwsSdkError(sdkError('NoSuchBucket'))).toBe(true)
        expect(isAwsSdkError(Object.assign(new Error('x'), {$retryable: {}}))).toBe(true)
    })

    test('rejects anything else so the generic mapper can handle it', () => {
        expect(isAwsSdkError(new Error('plain'))).toBe(false)
        expect(isAwsSdkError(null)).toBe(false)
        expect(isAwsSdkError('string')).toBe(false)
    })
})

describe('mapAwsSdkError', () => {
    test('returns null for a non-SDK error', () => {
        expect(mapAwsSdkError(new Error('plain'))).toBeNull()
    })

    const cases: Array<[string, CloudErrorStatus, CloudErrorCode]> = [
        // throttling — must win over everything, including the 500 metadata status
        ['ThrottlingException', 429, 'rate_limited'],
        ['ProvisionedThroughputExceededException', 429, 'rate_limited'],
        ['SlowDown', 429, 'rate_limited'],
        // conflicts — previously all 502
        ['BucketAlreadyExists', 409, 'resource_conflict'],
        ['BucketAlreadyOwnedByYou', 409, 'resource_conflict'],
        ['EntityAlreadyExists', 409, 'resource_conflict'],
        ['ResourceExistsException', 409, 'resource_conflict'],
        ['StateMachineAlreadyExists', 409, 'resource_conflict'],
        ['ResourceInUseException', 409, 'resource_conflict'],
        ['QueueNameExists', 409, 'resource_conflict'],
        // access
        ['AccessDenied', 403, 'access_denied'],
        ['UnauthorizedOperation', 403, 'access_denied'],
        ['SignatureDoesNotMatch', 403, 'access_denied'],
        // validation
        ['ValidationException', 400, 'invalid_request'],
        ['InvalidParameterValue', 400, 'invalid_request'],
        ['MalformedPolicyDocument', 400, 'invalid_request'],
        // A bad parameter set, not an existing-resource clash.
        ['InvalidParameterCombination', 400, 'invalid_request'],
        // not found
        ['NoSuchBucket', 404, 'resource_not_found'],
        ['NoSuchKey', 404, 'resource_not_found'],
        ['ResourceNotFoundException', 404, 'resource_not_found'],
        ['QueueDoesNotExist', 404, 'resource_not_found'],
        // EC2 uses a dotted suffix convention
        ['InvalidVpcID.NotFound', 404, 'resource_not_found'],
        ['InvalidInstanceID.NotFound', 404, 'resource_not_found'],
        // runtime gaps
        ['NotImplemented', 501, 'operation_not_implemented'],
        ['UnsupportedOperation', 501, 'operation_not_implemented'],
        ['ServiceUnavailable', 503, 'runtime_unavailable'],
    ]

    for (const [name, status, code] of cases) {
        test(`${name} maps to ${status}`, () => {
            const mapped = mapAwsSdkError(sdkError(name))
            expect(mapped?.status).toBe(status)
            expect(mapped?.code).toBe(code)
            expect(mapped?.message).toContain(name)
        })
    }

    test('matches the AlreadyExists suffix convention for unlisted names', () => {
        expect(mapAwsSdkError(sdkError('WidgetAlreadyExistsException'))?.status).toBe(409)
    })

    test('honours the $retryable throttling flag even for an unknown name', () => {
        const mapped = mapAwsSdkError(sdkError('SomeNewException', {$retryable: {throttling: true}}))
        expect(mapped?.status).toBe(429)
    })

    test('falls back to the metadata status only when the name is unknown', () => {
        expect(mapAwsSdkError(sdkError('MysteryFailure', {$metadata: {httpStatusCode: 404}}))?.status).toBe(404)
        expect(mapAwsSdkError(sdkError('MysteryFailure', {$metadata: {httpStatusCode: 409}}))?.status).toBe(409)
    })

    test('prefers the error name over a misleading metadata status', () => {
        // Local emulators frequently answer 500 for what is really a conflict.
        const mapped = mapAwsSdkError(sdkError('BucketAlreadyExists', {$metadata: {httpStatusCode: 500}}))
        expect(mapped?.status).toBe(409)
    })

    test('defaults to 502 when neither name nor status is informative', () => {
        expect(mapAwsSdkError(sdkError('MysteryFailure'))?.status).toBe(502)
    })
})
