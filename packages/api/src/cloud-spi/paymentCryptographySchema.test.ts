import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {
    algorithmsForUsage,
    awsPaymentCryptographySchema,
    keyClassForAlgorithm,
    PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES,
    PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS,
    PAYMENT_CRYPTOGRAPHY_KEY_CLASSES,
    PAYMENT_CRYPTOGRAPHY_KEY_USAGES,
    PAYMENT_CRYPTOGRAPHY_SOURCES,
} from './paymentCryptographySchema'
import {mayWrapWith} from './paymentCryptographySchema'
import {mayWrapKey} from './paymentCryptographySchema'
import {wrappingAlgorithmsFor} from './paymentCryptographySchema'
import type {PairingRule} from './types'

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

    test('every field that names a key says where the name comes from', () => {
        const schema = awsPaymentCryptographySchema()

        // A key has no name of its own, so a field that names a key offers an
        // ARN unless the schema says where the name the operator knows it by
        // comes from. A field that forgets says so here.
        for (const field of schema.fields) {
            if (field.optionsFrom !== 'key') continue
            expect({
                field: field.name,
                labelFrom: field.optionsLabelFrom,
            }).toEqual({field: field.name, labelFrom: 'aliasNames'})
        }
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

    test('the import form offers only the keys the service says may wrap', () => {
        const schema = awsPaymentCryptographySchema()
        const wrapping = schema.fields.find(field => field.name === 'wrappingKeyArn')

        expect(wrapping?.optionsFrom).toBe('key')
        // The state is the one the service publishes with every key, so the
        // choices are the keys the service accepts.
        expect(wrapping?.optionsState).toBe('mayWrap')
    })

    test('the import form offers its own enabled choice', () => {
        const schema = awsPaymentCryptographySchema()
        const importEnabled = schema.fields.find(field => field.name === 'importEnabled')
        const enabled = schema.fields.find(field => field.name === 'enabled')

        expect(importEnabled?.group).toBe('Import')
        expect(importEnabled?.visibleWhen).toEqual({field: 'source', equals: 'import'})
        expect(importEnabled?.defaultValue).toBe('true')
        // The choice in the Key group is not shown for an imported key, so the
        // import path must not read it: a field hidden by another answer keeps
        // its value, and a stale one would make the key disabled without the
        // reader having chosen that.
        expect(enabled?.visibleWhen).toEqual({field: 'source', equals: 'keys'})
    })

    test('the form offers the sources the service names', () => {
        const schema = awsPaymentCryptographySchema()
        const source = schema.fields.find(field => field.name === 'source')

        // The options come from the one list of the sources, so the form and
        // the adapter cannot disagree about what may be made.
        expect(source?.options?.map(option => option.value)).toEqual([...PAYMENT_CRYPTOGRAPHY_SOURCES])
        expect(source?.defaultValue).toBe('keys')
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

    test('the row of the matrix is a copy of it', () => {
        const row = wrappingAlgorithmsFor('AES_192') as string[]

        // The matrix is the table the schema publishes, so a caller that
        // changed the row it was given would change what every other caller
        // believes.
        row.push('TDES_2KEY')

        expect(wrappingAlgorithmsFor('AES_192')).toEqual(['AES_192', 'AES_256'])
    })

    test('the strength of a key is not a table of its own', () => {
        const source = readFileSync(new URL('./paymentCryptographySchema.ts', import.meta.url), 'utf8')

        // The strength rule is the matrix, and a second table of strengths
        // beside it is a second source of truth that can drift from it.
        expect(source).not.toContain('PAYMENT_CRYPTOGRAPHY_KEY_STRENGTH')
    })

    test('the published matrix is a value and not a handle', () => {
        const schema = awsPaymentCryptographySchema()

        // The table the schema publishes is the very one the adapter validates
        // against, so a consumer that changed it in process would change what
        // the adapter accepts. The change is never made here: the compiler is
        // what refuses it.
        const change = () => {
            // @ts-expect-error the published matrix is read-only
            schema.pairings![0].allowed['AES_256'].push('TDES_2KEY')
        }

        expect(change).toBeInstanceOf(Function)
        expect(schema.pairings?.[0].allowed['AES_256']).toEqual(['AES_256'])
    })

    test('the rule names the discriminator the panel reads', () => {
        // The discriminator is part of the wire contract, so a rule under
        // another one is a mistake the compiler catches where it is published.
        // @ts-expect-error the console reads one discriminator
        const other: PairingRule = {discriminator: 'keyClass', allowed: {}}

        expect(other).toBeDefined()
    })

    test('the rule says which way round the map is', () => {
        const doc = readFileSync(new URL('./types.ts', import.meta.url), 'utf8')
            .replace(/\*/g, ' ')
            .replace(/\s+/g, ' ')

        // The doc says which side of the map is the carried one, and that a
        // value the map does not name may not be carried at all.
        expect(doc).toContain('the resource that is carried')
        expect(doc).toContain('may not be carried at all')
    })

    test('the absence of a rule is a rule of its own', () => {
        const doc = readFileSync(new URL('./types.ts', import.meta.url), 'utf8')
            .replace(/\*/g, ' ')
            .replace(/\s+/g, ' ')

        // The doc says that no rule means that nothing may carry the resource,
        // so a panel cannot read the absence as "anything goes".
        expect(doc).toContain('nothing may carry the resource')
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
