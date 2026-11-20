import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/**
 * The TR-31 usages a key may have, in the reference's own names.
 *
 * The usage says what the key is for, so it is the first thing a key is made with,
 * and it decides the algorithm and the modes of use the key may be made with.
 */
export const PAYMENT_CRYPTOGRAPHY_KEY_USAGES = [
    'TR31_B0_BASE_DERIVATION_KEY',
    'TR31_C0_CARD_VERIFICATION_KEY',
    'TR31_D0_SYMMETRIC_DATA_ENCRYPTION_KEY',
    'TR31_D1_ASYMMETRIC_KEY_FOR_DATA_ENCRYPTION',
    'TR31_E0_EMV_MKEY_APP_CRYPTOGRAMS',
    'TR31_E1_EMV_MKEY_CONFIDENTIALITY',
    'TR31_E2_EMV_MKEY_INTEGRITY',
    'TR31_E4_EMV_MKEY_DYNAMIC_NUMBERS',
    'TR31_E5_EMV_MKEY_CARD_PERSONALIZATION',
    'TR31_E6_EMV_MKEY_OTHER',
    'TR31_K0_KEY_ENCRYPTION_KEY',
    'TR31_K1_KEY_BLOCK_PROTECTION_KEY',
    'TR31_K2_TR34_ASYMMETRIC_KEY',
    'TR31_K3_ASYMMETRIC_KEY_FOR_KEY_AGREEMENT',
    'TR31_M0_ISO_16609_MAC_KEY',
    'TR31_M1_ISO_9797_1_MAC_KEY',
    'TR31_M3_ISO_9797_3_MAC_KEY',
    'TR31_M6_ISO_9797_5_CMAC_KEY',
    'TR31_M7_HMAC_KEY',
    'TR31_P0_PIN_ENCRYPTION_KEY',
    'TR31_P1_PIN_GENERATION_KEY',
    'TR31_S0_ASYMMETRIC_KEY_FOR_DIGITAL_SIGNATURE',
    'TR31_V1_IBM3624_PIN_VERIFICATION_KEY',
    'TR31_V2_VISA_PIN_VERIFICATION_KEY',
] as const

export type PaymentCryptographyKeyUsage = (typeof PAYMENT_CRYPTOGRAPHY_KEY_USAGES)[number]

/** The algorithms a key may be made of, symmetric, keyed hash and asymmetric alike. */
export const PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS = [
    'TDES_2KEY',
    'TDES_3KEY',
    'AES_128',
    'AES_192',
    'AES_256',
    'HMAC_SHA224',
    'HMAC_SHA256',
    'HMAC_SHA384',
    'HMAC_SHA512',
    'RSA_2048',
    'RSA_3072',
    'RSA_4096',
    'ECC_NIST_P256',
    'ECC_NIST_P384',
    'ECC_NIST_P521',
] as const

export type PaymentCryptographyKeyAlgorithm = (typeof PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS)[number]

/**
 * The operations a key may be allowed to perform, as the reference names them.
 *
 * A mode of use is what a caller may do with the key, so a key with none of them
 * does no work, and the reference asks for them when a key is made. They are in the
 * order the reference's own table writes its combinations in: the data family, the
 * derivation, the MAC, the signature, and the unrestricted form.
 */
export const PAYMENT_CRYPTOGRAPHY_MODES_OF_USE = [
    'Encrypt',
    'Decrypt',
    'Wrap',
    'Unwrap',
    'DeriveKey',
    'Generate',
    'Sign',
    'Verify',
    'NoRestrictions',
] as const

export type PaymentCryptographyModeOfUse = (typeof PAYMENT_CRYPTOGRAPHY_MODES_OF_USE)[number]

/** A set of modes of use a key may be allowed, as the reference's table lists them. */
export type ModeCombination = readonly PaymentCryptographyModeOfUse[]

/** What a usage allows a key of it to be made of. */
export interface PaymentCryptographyUsageRule {
    /** The algorithms the key may be made of. */
    algorithms: readonly PaymentCryptographyKeyAlgorithm[]
    /** The combinations of modes of use the key may be allowed. */
    modes: readonly ModeCombination[]
}

const TDES_ALGORITHMS = ['TDES_2KEY', 'TDES_3KEY'] as const
const SYMMETRIC_ALGORITHMS = [...TDES_ALGORITHMS, 'AES_128', 'AES_192', 'AES_256'] as const
const HMAC_ALGORITHMS = ['HMAC_SHA224', 'HMAC_SHA256', 'HMAC_SHA384', 'HMAC_SHA512'] as const
const RSA_ALGORITHMS = ['RSA_2048', 'RSA_3072', 'RSA_4096'] as const
const ECC_ALGORITHMS = ['ECC_NIST_P256', 'ECC_NIST_P384', 'ECC_NIST_P521'] as const

/** A key that derives another key, and nothing else. */
const DERIVE_ONLY: readonly ModeCombination[] = [['DeriveKey'], ['NoRestrictions']]

/** A key that generates or verifies, the MAC and verification family. */
const GENERATE_OR_VERIFY: readonly ModeCombination[] = [
    ['Generate'],
    ['Verify'],
    ['Generate', 'Verify'],
    ['NoRestrictions'],
]

/** A key that encrypts and wraps, the data and key family. */
const ENCRYPT_AND_WRAP: readonly ModeCombination[] = [
    ['Encrypt', 'Decrypt', 'Wrap', 'Unwrap'],
    ['Encrypt', 'Wrap'],
    ['Decrypt', 'Unwrap'],
    ['NoRestrictions'],
]

/** The same, without the unrestricted form, which the asymmetric usages do not take. */
const ENCRYPT_AND_WRAP_ONLY: readonly ModeCombination[] = [
    ['Encrypt', 'Decrypt', 'Wrap', 'Unwrap'],
    ['Encrypt', 'Wrap'],
    ['Decrypt', 'Unwrap'],
]

/**
 * The algorithms and the modes of use each usage allows.
 *
 * This is the reference's own table of valid key attributes. The reference refuses a
 * key whose attributes are not a valid combination, and this table says which
 * combinations are valid.
 *
 * The local runtime is more permissive in two places: it lets an asymmetric usage take
 * either family of algorithm, and it does not check the modes of use at all, only the
 * algorithm the usage serves. So this table, not the runtime, is the authority, the
 * same way the KMS adapter takes the reference's table of key specs.
 *
 * Two usages are in the model's list of usages but not in the reference's table: the
 * ISO 16609 MAC key and the PIN generation key. They take the rule of the family they
 * belong to, which is what the local runtime makes of them.
 */
export const PAYMENT_CRYPTOGRAPHY_USAGE_RULES: Record<PaymentCryptographyKeyUsage, PaymentCryptographyUsageRule> = {
    TR31_B0_BASE_DERIVATION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: DERIVE_ONLY},
    TR31_C0_CARD_VERIFICATION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: GENERATE_OR_VERIFY},
    TR31_D0_SYMMETRIC_DATA_ENCRYPTION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: ENCRYPT_AND_WRAP},
    TR31_D1_ASYMMETRIC_KEY_FOR_DATA_ENCRYPTION: {algorithms: RSA_ALGORITHMS, modes: ENCRYPT_AND_WRAP_ONLY},
    TR31_E0_EMV_MKEY_APP_CRYPTOGRAMS: {algorithms: SYMMETRIC_ALGORITHMS, modes: DERIVE_ONLY},
    TR31_E1_EMV_MKEY_CONFIDENTIALITY: {algorithms: SYMMETRIC_ALGORITHMS, modes: DERIVE_ONLY},
    TR31_E2_EMV_MKEY_INTEGRITY: {algorithms: SYMMETRIC_ALGORITHMS, modes: DERIVE_ONLY},
    TR31_E4_EMV_MKEY_DYNAMIC_NUMBERS: {algorithms: SYMMETRIC_ALGORITHMS, modes: DERIVE_ONLY},
    TR31_E5_EMV_MKEY_CARD_PERSONALIZATION: {algorithms: SYMMETRIC_ALGORITHMS, modes: DERIVE_ONLY},
    TR31_E6_EMV_MKEY_OTHER: {algorithms: SYMMETRIC_ALGORITHMS, modes: DERIVE_ONLY},
    TR31_K0_KEY_ENCRYPTION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: ENCRYPT_AND_WRAP},
    TR31_K1_KEY_BLOCK_PROTECTION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: ENCRYPT_AND_WRAP},
    // The TR-34 key is an RSA key, not an elliptic curve one.
    TR31_K2_TR34_ASYMMETRIC_KEY: {
        algorithms: RSA_ALGORITHMS,
        modes: [['DeriveKey'], ...ENCRYPT_AND_WRAP_ONLY],
    },
    // The key agreement key is an elliptic curve key, not an RSA one.
    TR31_K3_ASYMMETRIC_KEY_FOR_KEY_AGREEMENT: {algorithms: ECC_ALGORITHMS, modes: [['DeriveKey']]},
    TR31_M0_ISO_16609_MAC_KEY: {algorithms: TDES_ALGORITHMS, modes: GENERATE_OR_VERIFY},
    TR31_M1_ISO_9797_1_MAC_KEY: {algorithms: TDES_ALGORITHMS, modes: GENERATE_OR_VERIFY},
    TR31_M3_ISO_9797_3_MAC_KEY: {algorithms: TDES_ALGORITHMS, modes: GENERATE_OR_VERIFY},
    TR31_M6_ISO_9797_5_CMAC_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: GENERATE_OR_VERIFY},
    // The hash usage also takes the keyed hash keys, whose algorithm is the hash they carry.
    TR31_M7_HMAC_KEY: {
        algorithms: [...SYMMETRIC_ALGORITHMS, ...HMAC_ALGORITHMS],
        modes: GENERATE_OR_VERIFY,
    },
    TR31_P0_PIN_ENCRYPTION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: ENCRYPT_AND_WRAP},
    TR31_P1_PIN_GENERATION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: GENERATE_OR_VERIFY},
    TR31_S0_ASYMMETRIC_KEY_FOR_DIGITAL_SIGNATURE: {algorithms: RSA_ALGORITHMS, modes: [['Sign'], ['Verify']]},
    TR31_V1_IBM3624_PIN_VERIFICATION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: GENERATE_OR_VERIFY},
    TR31_V2_VISA_PIN_VERIFICATION_KEY: {algorithms: SYMMETRIC_ALGORITHMS, modes: GENERATE_OR_VERIFY},
}

/**
 * The algorithms a usage may be made of.
 *
 * The usage binds the key to its purpose, so a key whose algorithm does not serve
 * that purpose is refused.
 */
export function algorithmsForUsage(usage: PaymentCryptographyKeyUsage): readonly PaymentCryptographyKeyAlgorithm[] {
    return PAYMENT_CRYPTOGRAPHY_USAGE_RULES[usage].algorithms
}

/**
 * The class a key of an algorithm has.
 *
 * The class says what shape the key has, and the algorithm says what material it
 * has, so the two agree: an asymmetric algorithm makes a key pair and a symmetric
 * one makes a symmetric key.
 */
export function keyClassForAlgorithm(algorithm: PaymentCryptographyKeyAlgorithm): 'SYMMETRIC_KEY' | 'ASYMMETRIC_KEY_PAIR' {
    return algorithm.startsWith('RSA_') || algorithm.startsWith('ECC_') ? 'ASYMMETRIC_KEY_PAIR' : 'SYMMETRIC_KEY'
}

/**
 * A key has no name of its own: the ARN is its identity, and the attributes the
 * table shows are the ones the reference's own key list shows.
 */
const paymentCryptographyColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Key ARN', format: 'code'},
    {name: 'keyClass', label: 'Key Type', path: 'metadata.keyClass', format: 'badge'},
    {name: 'keyUsage', label: 'Key Usage', path: 'metadata.keyUsage'},
    {name: 'keyAlgorithm', label: 'Key Algorithm', path: 'metadata.keyAlgorithm'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'enabled', label: 'Enabled', path: 'metadata.enabled', format: 'boolean'},
    {name: 'exportable', label: 'Exportable', path: 'metadata.exportable', format: 'boolean'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

const paymentCryptographyFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/** The two answers a yes-or-no member of a create form may have. */
const ALLOWED_OPTIONS = [
    {label: 'Allowed', value: 'true'},
    {label: 'Not allowed', value: 'false'},
]

/**
 * The modes of use the form offers, one field each.
 *
 * The form has no checkbox, so a mode is a select of the two answers. They are
 * grouped under one heading, because they are one thing: what the key may be used
 * for. The reference allows a fixed set of combinations of them per usage, and a
 * combination that is not one of them is refused.
 */
function modeFields(): FieldSchema[] {
    return PAYMENT_CRYPTOGRAPHY_MODES_OF_USE.map((mode) => ({
        name: `mode${mode}`,
        label: mode,
        type: 'select',
        required: false,
        group: 'Key modes of use',
        defaultValue: 'false',
        options: ALLOWED_OPTIONS,
    }))
}

const paymentCryptographyResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List keys', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create key', enabled: true, status: 'available', runtimeRequired: true},
    {
        name: 'delete',
        label: 'Schedule key deletion',
        enabled: true,
        status: 'available',
        runtimeRequired: true,
    },
    {name: 'inspect', label: 'Inspect key', enabled: true, status: 'available', runtimeRequired: false},
    {name: 'updateTags', label: 'Edit tags', enabled: true, status: 'available', runtimeRequired: true},
]

export function awsPaymentCryptographySchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'paymentcryptography',
        displayName: 'Payment Cryptography',
        fields: [
            {
                name: 'keyUsage',
                label: 'Key Usage',
                type: 'select',
                required: true,
                group: 'Key',
                description:
                    'What the key is for, as TR-31 names it. It decides which algorithms the key may be made of ' +
                    'and which combinations of modes of use it may have. The default is the first usage, ' +
                    'TR31_B0_BASE_DERIVATION_KEY.',
                defaultValue: 'TR31_B0_BASE_DERIVATION_KEY',
                options: PAYMENT_CRYPTOGRAPHY_KEY_USAGES.map((value) => ({label: value, value})),
            },
            {
                name: 'keyAlgorithm',
                label: 'Key Algorithm',
                type: 'select',
                required: false,
                group: 'Key',
                description:
                    'The algorithm the key is made of. It has to be one the usage allows. Left unset, the first ' +
                    'algorithm the usage allows is chosen.',
                options: PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS.map((value) => ({label: value, value})),
            },
            {
                name: 'exportable',
                label: 'Exportable',
                type: 'select',
                required: false,
                group: 'Key',
                description: 'Whether the key may leave the service. It cannot be changed once the key is made.',
                defaultValue: 'false',
                options: ALLOWED_OPTIONS,
            },
            {
                name: 'enabled',
                label: 'Enabled',
                type: 'select',
                required: false,
                group: 'Key',
                description: 'Whether the key does any work. A disabled key is refused by every operation that runs under it.',
                defaultValue: 'true',
                options: ALLOWED_OPTIONS,
            },
            ...modeFields(),
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: paymentCryptographyResourceActions,
        },
        filters: paymentCryptographyFilters,
        columns: paymentCryptographyColumns,
        notice:
            'The keys a payment operator holds: their attributes, their check value and their state. ' +
            'Aliases, key replication and Multi-Party Approval are not in this view.',
    }
}
