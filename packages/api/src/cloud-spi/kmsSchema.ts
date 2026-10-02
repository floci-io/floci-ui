import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

/**
 * A KMS key has no name — only an opaque uuid and an optional description — so
 * the description carries the identity in the table and in search.
 */
const kmsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Key ID', format: 'code'},
    {name: 'description', label: 'Description', path: 'metadata.description', emptyText: '—'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'keyUsage', label: 'Usage', path: 'metadata.keyUsage'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

const kmsFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/** Offered on create. Kept in sync with the adapter's validation. */
export const KMS_KEY_USAGES = ['ENCRYPT_DECRYPT', 'SIGN_VERIFY', 'GENERATE_VERIFY_MAC'] as const
export const KMS_KEY_SPECS = [
    'SYMMETRIC_DEFAULT',
    'RSA_2048',
    'RSA_4096',
    'ECC_NIST_P256',
    'HMAC_256',
] as const

/**
 * Which specs each usage can actually be created with, and the spec to use when
 * the caller picks a usage but no spec.
 *
 * KMS rejects a mismatched pair — a SIGN_VERIFY key cannot be SYMMETRIC_DEFAULT,
 * and only HMAC specs can generate MACs. The local runtime is more permissive and
 * returns 200 for pairs real KMS refuses, so this table, not the runtime, is the
 * authority. The first entry of each list is the default.
 */
export const KMS_SPECS_BY_USAGE = {
    ENCRYPT_DECRYPT: ['SYMMETRIC_DEFAULT', 'RSA_2048', 'RSA_4096'],
    SIGN_VERIFY: ['RSA_2048', 'RSA_4096', 'ECC_NIST_P256'],
    GENERATE_VERIFY_MAC: ['HMAC_256'],
} as const satisfies Record<(typeof KMS_KEY_USAGES)[number], readonly (typeof KMS_KEY_SPECS)[number][]>

/** KMS caps a key description at 8192 characters. */
export const KMS_DESCRIPTION_MAX_LENGTH = 8192

export function awsKmsSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'kms',
        displayName: 'AWS KMS',
        fields: [
            {
                name: 'description',
                label: 'Description',
                type: 'text',
                required: false,
                description: 'How this key is used. A key has no name, so this is how you will recognise it.',
                span: true,
                validation: {
                    maxLength: KMS_DESCRIPTION_MAX_LENGTH,
                    message: `Keep the description under ${KMS_DESCRIPTION_MAX_LENGTH} characters.`,
                },
            },
            {
                name: 'keyUsage',
                label: 'Key Usage',
                type: 'select',
                required: false,
                options: KMS_KEY_USAGES.map((value) => ({label: value, value})),
            },
            {
                name: 'keySpec',
                label: 'Key Spec',
                type: 'select',
                required: false,
                description:
                    'Must match the key usage: symmetric or RSA to encrypt, RSA or ECC to sign, HMAC to generate MACs. Left unset, a valid spec is chosen for the usage.',
                options: KMS_KEY_SPECS.map((value) => ({label: value, value})),
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List keys', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create key', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'delete',
                    label: 'Schedule key deletion',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {name: 'inspect', label: 'Inspect key', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'encrypt', label: 'Encrypt plaintext', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'decrypt', label: 'Decrypt ciphertext', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'updateTags', label: 'Edit tags', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: kmsFilters,
        columns: kmsColumns,
    }
}

/**
 * OCI Vault key shapes offered on create: the algorithm, its length in bytes (as
 * CreateKey's `keyShape.length` expects), and the curve for ECDSA.
 */
export const OCI_KEY_SHAPES = {
    AES_256: {algorithm: 'AES', length: 32},
    AES_192: {algorithm: 'AES', length: 24},
    AES_128: {algorithm: 'AES', length: 16},
    RSA_2048: {algorithm: 'RSA', length: 256},
    RSA_3072: {algorithm: 'RSA', length: 384},
    RSA_4096: {algorithm: 'RSA', length: 512},
    ECDSA_P256: {algorithm: 'ECDSA', length: 32, curveId: 'NIST_P256'},
    ECDSA_P384: {algorithm: 'ECDSA', length: 48, curveId: 'NIST_P384'},
    ECDSA_P521: {algorithm: 'ECDSA', length: 66, curveId: 'NIST_P521'},
} as const satisfies Record<string, {algorithm: string; length: number; curveId?: string}>

export type OciKeyShapeName = keyof typeof OCI_KEY_SHAPES

export const OCI_KMS_RESOURCE_TYPES = ['key', 'vault'] as const
export const OCI_VAULT_TYPES = ['DEFAULT', 'VIRTUAL_PRIVATE'] as const
export const OCI_PROTECTION_MODES = ['HSM', 'SOFTWARE'] as const

/** OCI caps a vault or key display name at 255 characters. */
export const OCI_DISPLAY_NAME_MAX_LENGTH = 255

/**
 * Vaults and their keys share one table, told apart by `Kind`. A key cannot
 * exist without a vault, so a keys-only table could not create the first key;
 * and the encrypt/decrypt panel acts on the selected resource, so each key has
 * to be a resource of its own rather than a child row of its vault.
 */
const ociKmsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'kind', label: 'Kind', path: 'type', format: 'badge'},
    {name: 'status', label: 'Lifecycle State', format: 'badge', emptyText: '—'},
    {name: 'keyShape', label: 'Key Shape', path: 'metadata.keyShapeLabel', emptyText: '—'},
    {name: 'vault', label: 'Vault', path: 'metadata.vaultName', emptyText: '—'},
    {
        name: 'timeOfDeletion',
        label: 'Deletion Date',
        path: 'metadata.timeOfDeletion',
        format: 'datetime',
        emptyText: '—',
    },
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

export function ociKmsSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'kms',
        displayName: 'OCI Vault',
        fields: [
            {
                name: 'resourceType',
                label: 'Resource Type',
                type: 'select',
                required: true,
                defaultValue: 'key',
                description: 'A key lives in a vault, so create a vault first.',
                options: [
                    {label: 'Key', value: 'key'},
                    {label: 'Vault', value: 'vault'},
                ],
            },
            {
                name: 'displayName',
                label: 'Name',
                type: 'text',
                required: true,
                validation: {
                    minLength: 1,
                    maxLength: OCI_DISPLAY_NAME_MAX_LENGTH,
                    message: `Use 1-${OCI_DISPLAY_NAME_MAX_LENGTH} characters.`,
                },
            },
            {
                name: 'vaultType',
                label: 'Vault Type',
                type: 'select',
                required: false,
                defaultValue: 'DEFAULT',
                visibleWhen: {field: 'resourceType', equals: 'vault'},
                options: OCI_VAULT_TYPES.map((value) => ({label: value, value})),
            },
            {
                name: 'vaultId',
                label: 'Vault OCID',
                type: 'text',
                required: false,
                visibleWhen: {field: 'resourceType', equals: 'key'},
                description: 'The vault that holds the key. Leave blank when the compartment has exactly one active vault.',
                span: true,
            },
            {
                name: 'keyShape',
                label: 'Key Shape',
                type: 'select',
                required: false,
                defaultValue: 'AES_256',
                visibleWhen: {field: 'resourceType', equals: 'key'},
                description: 'AES keys encrypt and decrypt. RSA keys encrypt or sign. ECDSA keys only sign.',
                options: (Object.keys(OCI_KEY_SHAPES) as OciKeyShapeName[]).map((value) => ({
                    label: value.replace('_', '-'),
                    value,
                })),
            },
            {
                name: 'protectionMode',
                label: 'Protection Mode',
                type: 'select',
                required: false,
                defaultValue: 'HSM',
                visibleWhen: {field: 'resourceType', equals: 'key'},
                options: OCI_PROTECTION_MODES.map((value) => ({label: value, value})),
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List vaults and keys', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create vault or key', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'delete',
                    label: 'Schedule deletion',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {name: 'inspect', label: 'Inspect vault or key', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'encrypt', label: 'Encrypt plaintext', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'decrypt', label: 'Decrypt ciphertext', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: kmsFilters,
        columns: ociKmsColumns,
    }
}

export function kmsSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsKmsSchema()
    if (cloud === 'oci') return ociKmsSchema()
    return null
}
