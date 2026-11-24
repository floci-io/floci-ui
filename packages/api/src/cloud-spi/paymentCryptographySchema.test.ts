import {describe, expect, test} from 'bun:test'
<<<<<<< HEAD
<<<<<<< HEAD
import {
    algorithmsForUsage,
    awsPaymentCryptographySchema,
    keyClassForAlgorithm,
    PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES,
    PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS,
    PAYMENT_CRYPTOGRAPHY_KEY_CLASSES,
    PAYMENT_CRYPTOGRAPHY_KEY_USAGES,
} from './paymentCryptographySchema'
=======
<<<<<<< HEAD
import {awsPaymentCryptographySchema} from './paymentCryptographySchema'
>>>>>>> d7092c2 (feat(paymentcryptography): the material a key leaves under)

describe('awsPaymentCryptographySchema', () => {
    test('offers the tag editor for a key and not for an alias', () => {
        const schema = awsPaymentCryptographySchema()
        const updateTags = schema.capabilities?.resourceActions?.find(capability => capability.name === 'updateTags')

        expect(updateTags?.enabled).toBe(true)
        // An alias carries no tags of its own, so the tag editor is the key's.
        expect(updateTags?.excludedTypes).toEqual(['alias'])
    })

=======
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
import {awsPaymentCryptographySchema, mayWrapWith} from './paymentCryptographySchema'

describe('awsPaymentCryptographySchema', () => {
    test('names the kind a field that names another resource takes its options from', () => {
        const schema = awsPaymentCryptographySchema()
        const target = schema.fields.find(field => field.name === 'aliasTargetKey')

        expect(target?.optionsFrom).toBe('key')
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
