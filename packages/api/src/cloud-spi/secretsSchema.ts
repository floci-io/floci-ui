import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

// The hyphen is escaped so the pattern also compiles under the `v` flag used for
// HTML pattern validation in the browser.
export const SECRET_NAME_PATTERN = '^[0-9A-Za-z\\-]{1,127}$'
export const SECRET_NAME_MESSAGE = 'Use a valid Key Vault secret name: 1-127 letters, numbers, or hyphens.'

const secretsFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

// The list endpoint returns base secret identifiers without a version, so a Version
// column would be blank for every row. Versions are surfaced on inspect instead.
const secretsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Secret Name'},
    {name: 'status', label: 'Status'},
    {name: 'createdAt', label: 'Created At'},
]

export function azureSecretsSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'secrets',
        displayName: 'Key Vault',
        fields: [
            {
                name: 'secretName',
                label: 'Secret Name',
                type: 'text',
                required: true,
                description: 'Unique Key Vault secret name.',
                validation: {
                    minLength: 1,
                    maxLength: 127,
                    pattern: SECRET_NAME_PATTERN,
                    message: SECRET_NAME_MESSAGE,
                },
            },
            {
                name: 'secretValue',
                label: 'Secret Value',
                type: 'password',
                required: true,
                description: 'Value stored in the secret.',
                span: true,
            },
            {
                name: 'contentType',
                label: 'Content Type',
                type: 'text',
                required: false,
                description: 'Optional content type, for example application/json.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List secrets', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create secret', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete secret', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect metadata', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: secretsFilters,
        columns: secretsColumns,
    }
}

// AWS list/describe return metadata only; the value is deliberately never read,
// so this schema advertises no value field and no create action.
const awsSecretsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Secret Name'},
    {name: 'status', label: 'Status'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

export function awsSecretsSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'secrets',
        displayName: 'AWS Secrets Manager',
        fields: [],
        actions: ['list', 'inspect'],
        filters: secretsFilters,
        columns: awsSecretsColumns,
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List secrets', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect metadata', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}
