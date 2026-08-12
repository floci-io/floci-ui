import {describe, expect, test} from 'bun:test'
import {ValidationError} from './errors'
import {DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, clampLimit} from './childCollections'

describe('clampLimit', () => {
    test('defaults when the caller sends nothing', () => {
        expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT)
        expect(clampLimit('')).toBe(DEFAULT_PAGE_LIMIT)
    })

    test('accepts a value inside the range', () => {
        expect(clampLimit('25')).toBe(25)
        expect(clampLimit(String(MAX_PAGE_LIMIT))).toBe(MAX_PAGE_LIMIT)
    })

    // Rejecting rather than silently clamping: a truncated page that looks
    // complete is the failure mode this contract exists to avoid.
    test('rejects out-of-range and non-numeric values', () => {
        expect(() => clampLimit('0')).toThrow(ValidationError)
        expect(() => clampLimit('-1')).toThrow(ValidationError)
        expect(() => clampLimit(String(MAX_PAGE_LIMIT + 1))).toThrow(ValidationError)
        expect(() => clampLimit('abc')).toThrow(ValidationError)
        expect(() => clampLimit('1.5')).toThrow(ValidationError)
    })
})
