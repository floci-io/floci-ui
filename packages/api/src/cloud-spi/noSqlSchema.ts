import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const noSqlFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const noSqlColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'engine', label: 'Engine'},
    {name: 'status', label: 'Status'},
    {name: 'createdAt', label: 'Created At'},
]

export function azureNoSqlSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'nosql',
        displayName: 'Azure Cosmos DB NoSQL',
        fields: [
            {
                name: 'databaseName',
                label: 'Database Name',
                type: 'text',
                required: true,
                validation: {
                    minLength: 1,
                    maxLength: 255,
                    pattern: '^[A-Za-z0-9._-]+$',
                    message: 'Use letters, numbers, dot, underscore, or dash.',
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List Cosmos databases', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create Cosmos database', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete Cosmos database', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect metadata', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: noSqlFilters,
        columns: noSqlColumns,
    }
}
