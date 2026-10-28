import {SECRET_NAME_PATTERN} from './secretsSchema'
import type {ServiceSchema, TableColumnSchema} from './types'

/**
 * Self-signed certificate shapes Floci-AZ issues. Key Vault takes the key type and size or
 * curve in the policy, so each name maps to those two fields.
 */
export const AZURE_CERTIFICATE_SHAPES = {
    RSA_2048: {kty: 'RSA', keySize: 2048},
    RSA_3072: {kty: 'RSA', keySize: 3072},
    RSA_4096: {kty: 'RSA', keySize: 4096},
    EC_P256: {kty: 'EC', curve: 'P-256'},
    EC_P384: {kty: 'EC', curve: 'P-384'},
    EC_P521: {kty: 'EC', curve: 'P-521'},
} as const satisfies Record<string, {kty: 'RSA' | 'EC'; keySize?: number; curve?: string}>

export type AzureCertificateShapeName = keyof typeof AZURE_CERTIFICATE_SHAPES

export const AZURE_CERTIFICATE_CONTENT_TYPES = {
    PKCS12: 'application/x-pkcs12',
    PEM: 'application/x-pem-file',
} as const

export type AzureCertificateContentTypeName = keyof typeof AZURE_CERTIFICATE_CONTENT_TYPES

export const AZURE_CERTIFICATE_VALIDITY_MONTHS = [1, 3, 6, 12, 24, 36] as const

export const AZURE_CERTIFICATE_NAME_PATTERN = SECRET_NAME_PATTERN
export const AZURE_CERTIFICATE_NAME_MESSAGE =
    'Use a valid Key Vault certificate name: 1-127 letters, numbers, or hyphens.'

// Key Vault soft-deletes certificates like secrets and keys, so the deleted namespace is a view facet.
export const AZURE_CERTIFICATE_STATES = ['active', 'deleted'] as const

// The list endpoint returns identifiers and attributes only, so subject and key type are shown on inspect.
const azureCertificateColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Certificate Name'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

export function azureCertificatesSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'certificates',
        displayName: 'Key Vault Certificates',
        fields: [
            {
                name: 'certificateName',
                label: 'Certificate Name',
                type: 'text',
                required: true,
                description: 'Unique Key Vault certificate name.',
                validation: {
                    minLength: 1,
                    maxLength: 127,
                    pattern: AZURE_CERTIFICATE_NAME_PATTERN,
                    message: AZURE_CERTIFICATE_NAME_MESSAGE,
                },
            },
            {
                name: 'subject',
                label: 'Subject',
                type: 'text',
                required: false,
                description: 'X.500 subject, for example CN=app.local. Defaults to CN=<certificate name>.',
            },
            {
                name: 'dnsNames',
                label: 'DNS names',
                type: 'text',
                required: false,
                description: 'Subject alternative names, separated by commas.',
            },
            {
                name: 'keyShape',
                label: 'Key Shape',
                type: 'select',
                required: false,
                defaultValue: 'RSA_2048',
                options: Object.keys(AZURE_CERTIFICATE_SHAPES).map((value) => ({label: value.replace('_', ' '), value})),
            },
            {
                name: 'validityMonths',
                label: 'Validity (months)',
                type: 'select',
                required: false,
                defaultValue: '12',
                options: AZURE_CERTIFICATE_VALIDITY_MONTHS.map((value) => ({label: String(value), value: String(value)})),
            },
            {
                name: 'contentType',
                label: 'Secret format',
                type: 'select',
                required: false,
                defaultValue: 'PKCS12',
                description: 'Format of the secret that carries the certificate and its private key.',
                options: Object.keys(AZURE_CERTIFICATE_CONTENT_TYPES).map((value) => ({label: value, value})),
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List certificates', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create self-signed certificate', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete certificate (soft-delete)', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'recover', label: 'Recover deleted certificate', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'purgeDeleted', label: 'Purge deleted certificate', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect certificate and versions', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: [
            {name: 'search', label: 'Search', type: 'text', required: false},
            {
                name: 'state',
                label: 'View',
                type: 'select',
                required: false,
                defaultValue: 'active',
                options: [
                    {label: 'Active certificates', value: 'active'},
                    {label: 'Deleted certificates', value: 'deleted'},
                ],
            },
        ],
        columns: azureCertificateColumns,
    }
}

export const ACM_SOURCES = ['REQUEST', 'IMPORT'] as const
export type AcmSource = (typeof ACM_SOURCES)[number]

// Floci-core issues these shapes with real keys; ACM's RSA_1024 is not offered.
export const ACM_KEY_ALGORITHMS = [
    'RSA_2048',
    'RSA_3072',
    'RSA_4096',
    'EC_prime256v1',
    'EC_secp384r1',
    'EC_secp521r1',
] as const

export const ACM_VALIDATION_METHODS = ['DNS', 'EMAIL'] as const

// ACM caps a domain name at 253 characters and a certificate at 100 names.
export const ACM_DOMAIN_NAME_MAX_LENGTH = 253
export const ACM_MAX_SUBJECT_ALTERNATIVE_NAMES = 99

// The list summary already carries every column, so only inspect needs DescribeCertificate.
const awsCertificateColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Domain'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'type', label: 'Type', path: 'metadata.type'},
    {name: 'keyAlgorithm', label: 'Key Algorithm', path: 'metadata.keyAlgorithm'},
    {name: 'notAfter', label: 'Expires', path: 'metadata.notAfter', format: 'datetime'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

export function awsCertificatesSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'certificates',
        displayName: 'AWS Certificate Manager',
        fields: [
            {
                name: 'source',
                label: 'Source',
                type: 'select',
                required: false,
                defaultValue: 'REQUEST',
                description: 'Request a new certificate, or import one you already hold with its private key.',
                options: [
                    {label: 'Request a certificate', value: 'REQUEST'},
                    {label: 'Import a certificate', value: 'IMPORT'},
                ],
            },
            {
                name: 'domainName',
                label: 'Domain name',
                type: 'text',
                required: false,
                requiredWhen: {field: 'source', equals: 'REQUEST'},
                visibleWhen: {field: 'source', equals: 'REQUEST'},
                description: 'Fully qualified name, for example app.example.com or *.example.com.',
                validation: {minLength: 1, maxLength: ACM_DOMAIN_NAME_MAX_LENGTH},
            },
            {
                name: 'subjectAlternativeNames',
                label: 'Additional names',
                type: 'text',
                required: false,
                visibleWhen: {field: 'source', equals: 'REQUEST'},
                description: 'Subject alternative names, separated by commas.',
            },
            {
                name: 'validationMethod',
                label: 'Validation method',
                type: 'select',
                required: false,
                defaultValue: 'DNS',
                visibleWhen: {field: 'source', equals: 'REQUEST'},
                options: ACM_VALIDATION_METHODS.map((value) => ({label: value, value})),
            },
            {
                name: 'keyAlgorithm',
                label: 'Key algorithm',
                type: 'select',
                required: false,
                defaultValue: 'RSA_2048',
                visibleWhen: {field: 'source', equals: 'REQUEST'},
                options: ACM_KEY_ALGORITHMS.map((value) => ({label: value.replace('_', ' '), value})),
            },
            {
                name: 'certificate',
                label: 'Certificate body',
                type: 'textarea',
                required: false,
                requiredWhen: {field: 'source', equals: 'IMPORT'},
                visibleWhen: {field: 'source', equals: 'IMPORT'},
                description: 'PEM-encoded certificate.',
                span: true,
            },
            {
                name: 'privateKey',
                label: 'Private key',
                type: 'textarea',
                required: false,
                requiredWhen: {field: 'source', equals: 'IMPORT'},
                visibleWhen: {field: 'source', equals: 'IMPORT'},
                description: 'PEM-encoded, unencrypted private key.',
                span: true,
            },
            {
                name: 'certificateChain',
                label: 'Certificate chain',
                type: 'textarea',
                required: false,
                visibleWhen: {field: 'source', equals: 'IMPORT'},
                description: 'Optional PEM-encoded intermediate certificates.',
                span: true,
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List certificates', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Request or import certificate', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete certificate', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect certificate', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: awsCertificateColumns,
    }
}
