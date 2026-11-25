import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {
    algorithmsForUsage,
    awsPaymentCryptographySchema,
    isWrappingUsage,
    keyClassForAlgorithm,
    mayWrapKey,
    mayWrapWith,
    modesAllowWrapping,
    wrappingAlgorithmsFor,
    PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES,
    PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS,
    PAYMENT_CRYPTOGRAPHY_KEY_CLASSES,
    PAYMENT_CRYPTOGRAPHY_KEY_USAGES,
} from './paymentCryptographySchema'

describe('awsPaymentCryptographySchema', () => {
    test('a field that names a key is offered under the name the key was given', () => {
        const schema = awsPaymentCryptographySchema()

        const wrapping = schema.fields.find(field => field.name === 'wrappingKeyArn')
        const target = schema.fields.find(field => field.name === 'aliasTargetKey')

        // A key has no name of its own, so an ARN is all the console could
        // offer, and an ARN is not something an operator remembers.
        expect(wrapping?.optionsLabelFrom).toEqual('aliasNames')
        expect(target?.optionsLabelFrom).toEqual('aliasNames')
    })

    test('offers the tag editor for a key and not for an alias', () => {
        const schema = awsPaymentCryptographySchema()
        const updateTags = schema.capabilities?.resourceActions?.find(capability => capability.name === 'updateTags')

        expect(updateTags?.enabled).toBe(true)
        // An alias carries no tags of its own, so the tag editor is the key's.
        expect(updateTags?.excludedTypes).toEqual(['alias'])
    })

    test('names the kind a field that names another resource takes its options from', () => {
        const schema = awsPaymentCryptographySchema()
        const target = schema.fields.find(field => field.name === 'aliasTargetKey')

        expect(target?.optionsFrom).toBe('key')
    })

    test('the import form offers only the keys that may wrap', () => {
        const schema = awsPaymentCryptographySchema()
        const wrapping = schema.fields.find(field => field.name === 'wrappingKeyArn')

        // The service refuses a key that may not wrap, so the form does not
        // offer one.
        expect(wrapping?.optionsFrom).toBe('key')
        expect(wrapping?.optionsState).toBe('mayWrap')
    })

    test('the matrix says which key may carry which', () => {
        expect(mayWrapWith('AES_256', 'AES_256')).toBe(true)
        expect(mayWrapWith('AES_256', 'AES_128')).toBe(false)
        expect(mayWrapWith('TDES_3KEY', 'TDES_2KEY')).toBe(false)
        // The matrix names the symmetric keys, so a key it does not name may not
        // be carried by any.
        expect(mayWrapWith('RSA_2048', 'AES_256')).toBe(false)
    })

    test('the matrix is not read through the prototype chain', () => {
        // The algorithm comes from the service, so a name the prototype chain
        // answers for is not a row of the matrix.
        for (const name of ['__proto__', 'constructor', 'toString']) {
            expect(mayWrapWith(name, 'AES_256')).toBe(false)
        }
    })

    test('the row handed out is a copy of the row of the matrix', () => {
        const row = wrappingAlgorithmsFor('AES_256') as string[]
        row.push('AES_128')

        // The matrix is the very table the schema publishes to the console, so a
        // caller that changed the row would change what every later caller
        // believes.
        expect(wrappingAlgorithmsFor('AES_256')).toEqual(['AES_256'])
    })

    test('the keyed-hash keys are not rows of the matrix, and the table says why', () => {
        // The reference's own table of what may be wrapped by what names the
        // encryption keys alone, so a key whose algorithm is a hash leaves under
        // no key at all.
        expect(mayWrapWith('HMAC_SHA256', 'AES_256')).toBe(false)
        expect(mayWrapWith('HMAC_SHA512', 'AES_256')).toBe(false)

        const source = readFileSync(join(import.meta.dir, 'paymentCryptographySchema.ts'), 'utf8')
        expect(source).toContain('keyed-hash')
    })

    test('the strength of a key is stated once', () => {
        const source = readFileSync(join(import.meta.dir, 'paymentCryptographySchema.ts'), 'utf8')

        // The matrix already says which key may carry which, so a second table
        // of strengths is a second source of truth that can drift from it.
        expect(source).not.toMatch(/PAYMENT_CRYPTOGRAPHY_KEY_STRENGTH/)
    })
})

describe('the class of a payment key', () => {
    test('every algorithm is classified, and classified once', () => {
        const seen = new Set<string>()

        for (const algorithm of PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS) {
            const keyClass = keyClassForAlgorithm(algorithm)
            expect(seen.has(algorithm)).toBe(false)
            seen.add(algorithm)
            expect([
                PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.symmetric,
                PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.pair,
            ]).toContain(keyClass)
        }

        expect(seen.size).toBe(PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS.length)
    })

    test('the class of an algorithm is the class the usage it belongs to implies', () => {
        // The usages that name an asymmetric algorithm take a key pair, and the
        // ones that take a symmetric or a hash algorithm take a symmetric key.
        const asymmetricUsages = new Set([
            'TR31_D1_ASYMMETRIC_KEY_FOR_DATA_ENCRYPTION',
            'TR31_K2_TR34_ASYMMETRIC_KEY',
            'TR31_K3_ASYMMETRIC_KEY_FOR_KEY_AGREEMENT',
            'TR31_S0_ASYMMETRIC_KEY_FOR_DIGITAL_SIGNATURE',
        ])

        for (const usage of PAYMENT_CRYPTOGRAPHY_KEY_USAGES) {
            const expected = asymmetricUsages.has(usage)
                ? PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.pair
                : PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.symmetric

            for (const algorithm of algorithmsForUsage(usage)) {
                expect(keyClassForAlgorithm(algorithm)).toBe(expected)
            }
        }
    })

    test('a key of a hash algorithm is not a pair', () => {
        expect(keyClassForAlgorithm('HMAC_SHA256')).toBe(PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.symmetric)
    })

    test('the certificate states are the ones the console reads', () => {
        expect(new Set(Object.values(PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES))).toEqual(
            new Set(['unknown', 'no-public-half', 'signed', 'unsigned', 'unreadable']),
        )
    })
})

describe('the keys that may carry another key', () => {
    test('a key with no restrictions may wrap', () => {
        // The reference's own table of valid attributes lists NoRestrictions as
        // a combination the wrapping usages may take, and a key with no
        // restrictions may do anything at all.
        expect(modesAllowWrapping({NoRestrictions: true})).toBe(true)
        expect(
            mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {NoRestrictions: true}, true),
        ).toBe(true)
        expect(
            mayWrapKey('TR31_K1_KEY_BLOCK_PROTECTION_KEY', {NoRestrictions: true}, true),
        ).toBe(true)
    })

    test('a key that may wrap may wrap', () => {
        expect(modesAllowWrapping({Wrap: true, Unwrap: true})).toBe(true)
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {Wrap: true}, true)).toBe(true)
    })

    test('a key that may not wrap does not wrap', () => {
        // A key that may only encrypt may not wrap a block.
        expect(modesAllowWrapping({Encrypt: true, Decrypt: true})).toBe(false)
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {Encrypt: true}, true)).toBe(false)
        // The usage says what the key is for, and a key with another one may not
        // wrap a key.
        expect(isWrappingUsage('TR31_P0_PIN_ENCRYPTION_KEY')).toBe(false)
        expect(mayWrapKey('TR31_P0_PIN_ENCRYPTION_KEY', {Wrap: true}, true)).toBe(false)
        // A disabled key does no work at all.
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {Wrap: true}, false)).toBe(false)
    })

    test('the modes of use that were not read are not a permission to wrap', () => {
        expect(modesAllowWrapping(undefined)).toBe(false)
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', undefined, true)).toBe(false)
    })
})
