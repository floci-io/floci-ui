import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const applicationColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'description', label: 'Description', path: 'metadata.description', emptyText: '—'},
    {name: 'id', label: 'Application Id'},
]

const applicationFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsAppConfigSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'configuration',
        displayName: 'AppConfig',
        fields: [
            {
                name: 'name',
                label: 'Application Name',
                type: 'text',
                required: true,
                validation: {
                    pattern: '^[A-Za-z0-9._\\-]+$',
                    maxLength: 255,
                    message: 'Use letters, numbers, periods, hyphens, or underscores.',
                },
            },
            {name: 'description', label: 'Description', type: 'textarea', required: false},
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        filters: applicationFilters,
        columns: applicationColumns,
    }
}
