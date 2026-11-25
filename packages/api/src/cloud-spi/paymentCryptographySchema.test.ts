import {describe, expect, test} from 'bun:test'
import {
    algorithmsForUsage,
    awsPaymentCryptographySchema,
    keyClassForAlgorithm,
    PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES,
    PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS,
    PAYMENT_CRYPTOGRAPHY_KEY_CLASSES,
    PAYMENT_CRYPTOGRAPHY_KEY_USAGES,
} from './paymentCryptographySchema'
import {mayWrapWith} from './paymentCryptographySchema'
import {mayWrapKey} from './paymentCryptographySchema'

describe('awsPaymentCryptographySchema', () => {
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

    test('the import form offers only the keys the service says may wrap', () => {
        const schema = awsPaymentCryptographySchema()
        const wrapping = schema.fields.find(field => field.name === 'wrappingKeyArn')

        expect(wrapping?.optionsFrom).toBe('key')
        // The state is the one the service publishes with every key, so the
        // choices are the keys the service accepts.
        expect(wrapping?.optionsState).toBe('mayWrap')
    })

    test('the rule of a wrapping key is one rule', () => {
        // A key encryption key that may wrap and is enabled may wrap; the ones
        // that do not hold are not.
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {Wrap: true}, true)).toBe(true)
        expect(mayWrapKey('TR31_K1_KEY_BLOCK_PROTECTION_KEY', {Wrap: true}, true)).toBe(true)
        // A key with no restrictions may do anything at all.
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {NoRestrictions: true}, true)).toBe(true)
        // A usage that is not a wrapping one, a mode of use that does not allow
        // wrapping and a disabled key are each a reason.
        expect(mayWrapKey('TR31_D0_SYMMETRIC_DATA_ENCRYPTION_KEY', {Wrap: true}, true)).toBe(false)
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {Encrypt: true}, true)).toBe(false)
        expect(mayWrapKey('TR31_K0_KEY_ENCRYPTION_KEY', {Wrap: true}, false)).toBe(false)
        // A key whose attributes were not read is not a wrapping key either.
        expect(mayWrapKey(undefined, undefined, undefined)).toBe(false)
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
