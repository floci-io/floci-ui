import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const eventBusColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Resource Type'},
    {name: 'region', label: 'Region'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

const eventBusFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsEventBridgeSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'events',
        displayName: 'EventBridge',
        fields: [
            {
                name: 'name',
                label: 'Event Bus Name',
                type: 'text',
                required: true,
                description: 'Letters, numbers, periods, hyphens, and underscores.',
                validation: {
                    pattern: '^[A-Za-z0-9._\\-]+$',
                    maxLength: 256,
                    message: 'Use letters, numbers, periods, hyphens, or underscores.',
                },
            },
            {name: 'description', label: 'Description', type: 'text', required: false},
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        filters: eventBusFilters,
        columns: eventBusColumns,
    }
}
