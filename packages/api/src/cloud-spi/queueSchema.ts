import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const queueColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Queue Name'},
    {name: 'type', label: 'Type'},
    {name: 'cloud', label: 'Cloud'},
    {name: 'status', label: 'Status'},
    {name: 'createdAt', label: 'Created At'},
]

const queueFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsQueueSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'queue',
        displayName: 'Amazon SQS',
        fields: [
            {
                name: 'queueName',
                label: 'Queue Name',
                type: 'text',
                required: true,
                description: 'Up to 80 characters: alphanumeric, hyphens, and underscores. FIFO queues must end in ".fifo".',
            },
            {
                name: 'fifo',
                label: 'Queue Type',
                type: 'select',
                required: false,
                options: [
                    {label: 'Standard', value: 'standard'},
                    {label: 'FIFO', value: 'fifo'},
                ],
            },
            {
                name: 'visibilityTimeout',
                label: 'Visibility Timeout (seconds)',
                type: 'text',
                required: false,
                description: 'Default: 30.',
            },
            {
                name: 'delaySeconds',
                label: 'Delivery Delay (seconds)',
                type: 'text',
                required: false,
                description: 'Default: 0.',
            },
            {
                name: 'messageRetentionPeriod',
                label: 'Message Retention (seconds)',
                type: 'text',
                required: false,
                description: 'Default: 345600 (4 days).',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: queueFilters,
        columns: queueColumns,
    }
}

export function queueSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsQueueSchema()
    return null
}
