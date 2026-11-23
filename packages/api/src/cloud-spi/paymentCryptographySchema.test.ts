import {describe, expect, test} from 'bun:test'
import {awsPaymentCryptographySchema} from './paymentCryptographySchema'

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
