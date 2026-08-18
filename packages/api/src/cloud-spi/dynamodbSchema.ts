import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const dynamodbColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Table'},
    {name: 'status', label: 'Status'},
    {name: 'region', label: 'Region'},
    {name: 'createdAt', label: 'Created At'},
]

const dynamodbFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const attributeTypeOptions = [
    {label: 'String', value: 'S'},
    {label: 'Number', value: 'N'},
    {label: 'Binary', value: 'B'},
]

export function awsDynamoDbSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'nosql',
        displayName: 'DynamoDB',
        fields: [
            {
                name: 'tableName',
                label: 'Table Name',
                type: 'text',
                required: true,
                description: '3-255 characters. Letters, numbers, underscores, dots, and hyphens.',
                validation: {
                    pattern: '^(?:[A-Za-z0-9_.]|-){3,255}$',
                    minLength: 3,
                    maxLength: 255,
                    message: 'Use a valid DynamoDB table name: 3-255 letters, numbers, underscores, dots, or hyphens.',
                },
            },
            {
                name: 'partitionKey',
                label: 'Partition Key',
                type: 'text',
                required: true,
                group: 'Primary key',
                validation: {
                    minLength: 1,
                    maxLength: 255,
                    message: 'Partition key must contain 1-255 characters.',
                },
            },
            {
                name: 'partitionKeyType',
                label: 'Partition Key Type',
                type: 'select',
                required: true,
                options: attributeTypeOptions,
            },
            {
                name: 'sortKey',
                label: 'Sort Key',
                type: 'text',
                required: false,
                description: 'Optional range key.',
                validation: {
                    minLength: 1,
                    maxLength: 255,
                    message: 'Sort key must contain 1-255 characters.',
                },
            },
            {
                name: 'sortKeyType',
                label: 'Sort Key Type',
                type: 'select',
                required: false,
                options: attributeTypeOptions,
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List tables', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create table', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete table', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect table', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: dynamodbFilters,
        columns: dynamodbColumns,
    }
}
