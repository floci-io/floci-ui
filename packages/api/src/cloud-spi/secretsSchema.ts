import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const secretsFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const secretsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Secret Name'},
    {name: 'status', label: 'Status'},
    {name: 'createdAt', label: 'Created At'},
    {name: 'version', label: 'Version'},
]

export function azureSecretsSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'secrets',
        displayName: 'Azure Key Vault',
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
                    pattern: '^(?:[0-9A-Za-z]|-)+$',
                    message: 'Use letters, numbers, or hyphens.',
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

export function secretsSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'azure') return azureSecretsSchema()
    return null
}
