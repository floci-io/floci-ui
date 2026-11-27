import {describe, expect, test} from 'bun:test'
import {isNotFound} from './paymentCryptographyErrors'

describe('the refusal that says a resource is not there', () => {
    test('the name the reference answers with', () => {
        // Payment Cryptography answers a missing key with
        // `ResourceNotFoundException` and HTTP **400**, the way KMS does, so
        // the name is the signal.
        expect(isNotFound({name: 'ResourceNotFoundException'})).toBe(true)
        expect(isNotFound(Object.assign(new Error('The key was not found.'), {name: 'ResourceNotFoundException'}))).toBe(true)
    })

    test('the status the runtime answers with, when the name says nothing', () => {
        expect(isNotFound({$metadata: {httpStatusCode: 404}})).toBe(true)
    })

    test('a runtime that does not serve the operation keeps its own meaning', () => {
        // The runtime answers 404 with this name when it does not serve the
        // operation at all, and the shared mapper reads that as a gap in the
        // runtime rather than as a resource that is not there.
        expect(isNotFound({name: 'UnknownOperationException', $metadata: {httpStatusCode: 404}})).toBe(false)
        expect(isNotFound({name: 'NotImplementedException', $metadata: {httpStatusCode: 404}})).toBe(false)
    })

    test('a refusal that is not about a missing resource', () => {
        expect(isNotFound({name: 'AccessDeniedException'})).toBe(false)
        expect(isNotFound({name: 'ThrottlingException'})).toBe(false)
        expect(isNotFound({$metadata: {httpStatusCode: 400}})).toBe(false)
        expect(isNotFound({})).toBe(false)
    })

    test('something that is not an object at all', () => {
        expect(isNotFound(null)).toBe(false)
        expect(isNotFound(undefined)).toBe(false)
        expect(isNotFound('The key was not found.')).toBe(false)
        expect(isNotFound(404)).toBe(false)
    })
})
