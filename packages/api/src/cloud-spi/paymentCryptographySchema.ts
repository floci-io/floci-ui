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
/**
 * The algorithms that make a key pair, and so a public half.
 *
 * <p>These are the two groups the asymmetric usages are built from, so the rule
 * is the one the usages already carry.
 */
const ASYMMETRIC_ALGORITHMS: readonly PaymentCryptographyKeyAlgorithm[] = [
    ...RSA_ALGORITHMS,
    ...ECC_ALGORITHMS,
]

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
<<<<<<< HEAD
 * The class of a key.
 *
 * The class says what shape the key has: a pair has a public half and a
 * symmetric key has none.
 */
export const PAYMENT_CRYPTOGRAPHY_KEY_CLASSES = {
    symmetric: 'SYMMETRIC_KEY',
    pair: 'ASYMMETRIC_KEY_PAIR',
} as const

export type PaymentCryptographyKeyClass =
    (typeof PAYMENT_CRYPTOGRAPHY_KEY_CLASSES)[keyof typeof PAYMENT_CRYPTOGRAPHY_KEY_CLASSES]

/**
 * The states the certificate of a key can be in.
 *
 * <p>The API names them and the console only picks the words: a state the
 * console had to work out for itself is a state that can drift from the one
 * the API means.
 */
export const PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES = {
    /** The service did not say what kind of key it is, so it has not said whether it has a public half. */
    unknown: 'unknown',
    /** The key has no public half, so it has no certificate. */
    noPublicHalf: 'no-public-half',
    /** The service signed a certificate for the key's public half. */
    signed: 'signed',
    /** The key has a public half, but the service signed no certificate. */
    unsigned: 'unsigned',
    /** The certificate was asked for and could not be read. */
    unreadable: 'unreadable',
} as const

export type PaymentCryptographyCertificateState =
    (typeof PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES)[keyof typeof PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES]
=======
 * The strength of a symmetric key, in bits, as the reference's matrix counts it.
 *
 * <p>The matrix is the reference's own, and a wrapping key has to be at least as
 * strong as the key it carries. The strength of a Triple DES key is the strength of
 * its key length, so a two-key key is weaker than a three-key one and may not carry
 * it.
 */
export const PAYMENT_CRYPTOGRAPHY_KEY_STRENGTH: Record<string, number> = {
    TDES_2KEY: 80,
    TDES_3KEY: 112,
    AES_128: 128,
    AES_192: 192,
    AES_256: 256,
}

/**
 * The wrapping keys each key may leave under, as the reference's matrix allows.
 *
 * <p>The matrix is a table of the key to protect against the wrapping key, and the
 * row of a key is what it may be carried by. The transports that are not a TR-31
 * block are not here, because a key that leaves under an RSA or an elliptic curve
 * key leaves as a cryptogram and not as a block.
 */
export const PAYMENT_CRYPTOGRAPHY_WRAPPING_ALGORITHMS: Record<string, string[]> = {
    TDES_2KEY: ['TDES_2KEY', 'TDES_3KEY', 'AES_128', 'AES_192', 'AES_256'],
    TDES_3KEY: ['TDES_3KEY', 'AES_128', 'AES_192', 'AES_256'],
    AES_128: ['AES_128', 'AES_192', 'AES_256'],
    AES_192: ['AES_192', 'AES_256'],
    AES_256: ['AES_256'],
}

/**
 * The usages a key may have when it wraps another key.
 *
 * <p>A key that wraps a block is a key encryption key or a key block protection
 * key, which are the two the reference names for the purpose.
 */
export const PAYMENT_CRYPTOGRAPHY_WRAPPING_USAGES = [
    'TR31_K0_KEY_ENCRYPTION_KEY',
    'TR31_K1_KEY_BLOCK_PROTECTION_KEY',
]

/**
 * Whether a key of one algorithm may be carried by a key of another.
 *
 * <p>The rule is the reference's matrix, and it is the same rule the local runtime
 * holds to, so the table and the runtime agree.
 */
export function mayWrapWith(carriedAlgorithm: string, wrappingAlgorithm: string): boolean {
    const allowed = PAYMENT_CRYPTOGRAPHY_WRAPPING_ALGORITHMS[carriedAlgorithm]
    return allowed ? allowed.includes(wrappingAlgorithm) : false
}
>>>>>>> b5174b9 (feat(paymentcryptography): the export form offers only the pairings allowed)

/**
 * The class a key of an algorithm has.
 *
 * The class says what shape the key has, and the algorithm says what material it
 * has, so the two agree: an asymmetric algorithm makes a key pair and a symmetric
 * one makes a symmetric key.
 */
export function keyClassForAlgorithm(algorithm: PaymentCryptographyKeyAlgorithm): PaymentCryptographyKeyClass {
    return ASYMMETRIC_ALGORITHMS.includes(algorithm)
        ? PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.pair
        : PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.symmetric
}

/**
 * The kinds of resource the service holds: the keys themselves, and the alias names
 * that point at them.
 *
 * The alias is a name for a key, so it is a resource of its own in the reference's
 * own listing, and the explorer holds both kinds in one table the way it holds IAM's
 * users, roles and policies.
 */
export const PAYMENT_CRYPTOGRAPHY_KINDS = ['keys', 'aliases'] as const

export type PaymentCryptographyKind = (typeof PAYMENT_CRYPTOGRAPHY_KINDS)[number]

/**
 * What the create form makes: a key, an alias, or a key that comes in under a
 * TR-31 block a key the account holds wraps.
 */
export const PAYMENT_CRYPTOGRAPHY_SOURCES = ['keys', 'aliases', 'import'] as const

export type PaymentCryptographySource = (typeof PAYMENT_CRYPTOGRAPHY_SOURCES)[number]

/** The prefix a kind's resource ids carry, as the explorer holds several kinds in one table. */
export const PAYMENT_CRYPTOGRAPHY_KIND_PREFIX: Record<PaymentCryptographyKind, string> = {
    keys: 'key',
    aliases: 'alias',
}

/**
 * A key has no name of its own: the ARN is its identity, and the attributes the
 * table shows are the ones the reference's own key list shows.
 */
const paymentCryptographyColumns: TableColumnSchema[] = [
    {name: 'kind', label: 'Kind', path: 'type', format: 'badge'},
    {name: 'name', label: 'Name', format: 'code'},
    {name: 'keyClass', label: 'Key Type', path: 'metadata.keyClass', format: 'badge', emptyText: '—'},
    {name: 'keyUsage', label: 'Key Usage', path: 'metadata.keyUsage', emptyText: '—'},
    {name: 'keyAlgorithm', label: 'Key Algorithm', path: 'metadata.keyAlgorithm', emptyText: '—'},
    {name: 'targetKey', label: 'Target Key', path: 'metadata.targetKeyArn', format: 'code', emptyText: '—'},
    {name: 'status', label: 'State', format: 'badge', emptyText: '—'},
    {name: 'enabled', label: 'Enabled', path: 'metadata.enabled', format: 'boolean', emptyText: '—'},
    {name: 'exportable', label: 'Exportable', path: 'metadata.exportable', format: 'boolean', emptyText: '—'},
    {name: 'createdAt', label: 'Created', format: 'datetime', emptyText: '—'},
]

const paymentCryptographyFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: false,
        description: 'Leave unset to list the keys and their aliases together.',
        options: PAYMENT_CRYPTOGRAPHY_KINDS.map((value) => ({label: value, value})),
    },
]

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
        visibleWhen: {field: 'source', equals: 'keys'},
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
    // An alias carries no tags of its own: the tags belong to the key it names,
    // and the reference's own tagging takes a key ARN. The tag editor is the
    // key's, so the alias row does not offer it.
    {name: 'updateTags', label: 'Edit tags', enabled: true, status: 'available', runtimeRequired: true, excludedTypes: ['alias']},
]

export function awsPaymentCryptographySchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'paymentcryptography',
        displayName: 'Payment Cryptography',
        fields: [
            {
                name: 'source',
                label: 'What to make',
                type: 'select',
                required: true,
                group: 'Required',
                description: 'A key, an alias name that points at one, or a key that comes in under a TR-31 block.',
                defaultValue: 'keys',
                options: [
                    {label: 'A new key', value: 'keys', submitLabel: 'Create key'},
                    {label: 'An alias', value: 'aliases', submitLabel: 'Create alias'},
                    {label: 'An imported key', value: 'import', submitLabel: 'Import key'},
                ],
            },
            {
                name: 'keyUsage',
                label: 'Key Usage',
                type: 'select',
                required: true,
                group: 'Key',
                visibleWhen: {field: 'source', equals: 'keys'},
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
                visibleWhen: {field: 'source', equals: 'keys'},
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
                visibleWhen: {field: 'source', equals: 'keys'},
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
                visibleWhen: {field: 'source', equals: 'keys'},
                description: 'Whether the key does any work. A disabled key is refused by every operation that runs under it.',
                defaultValue: 'true',
                options: ALLOWED_OPTIONS,
            },
            ...modeFields(),
            {
                name: 'wrappingKeyArn',
                label: 'Wrapping Key',
                type: 'select',
                required: false,
                group: 'Import',
                visibleWhen: {field: 'source', equals: 'import'},
                requiredWhen: {field: 'source', equals: 'import'},
                description:
                    'The key the block is wrapped under. It has to be a key encryption key that may wrap, and at ' +
                    'least as strong as the key it carries.',
                optionsFrom: 'key',
            },
            {
                name: 'wrappedKeyBlock',
                label: 'Wrapped Key Block',
                type: 'textarea',
                required: false,
                group: 'Import',
                visibleWhen: {field: 'source', equals: 'import'},
                requiredWhen: {field: 'source', equals: 'import'},
                description: 'The TR-31 block the key comes in under, as the service wrote it.',
            },
            {
                name: 'aliasName',
                label: 'Alias Name',
                type: 'text',
                required: false,
                group: 'Alias',
                visibleWhen: {field: 'source', equals: 'aliases'},
                requiredWhen: {field: 'source', equals: 'aliases'},
                description: 'The name of the alias. It has to begin with "alias/".',
                validation: {
                    pattern: '^alias/[A-Za-z0-9/_-]+$',
                    message: 'Use an alias name that begins with "alias/" and holds only letters, digits, slashes, underscores and dashes.',
                },
            },
            {
                name: 'aliasTargetKey',
                label: 'Target Key',
                type: 'select',
                required: false,
                group: 'Alias',
                visibleWhen: {field: 'source', equals: 'aliases'},
                requiredWhen: {field: 'source', equals: 'aliases'},
                description: 'The key the alias points at. An alias names a key that exists.',
                optionsFrom: 'key',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: paymentCryptographyResourceActions,
        },
        filters: paymentCryptographyFilters,
        columns: paymentCryptographyColumns,
        pairings: [
            {
                discriminator: 'keyAlgorithm',
                allowed: PAYMENT_CRYPTOGRAPHY_WRAPPING_ALGORITHMS,
            },
        ],
        notice:
            'The keys a payment operator holds and the alias names that point at them: their attributes, ' +
            'their check value and their state. Key replication and Multi-Party Approval are not in this view.',
    }
}
