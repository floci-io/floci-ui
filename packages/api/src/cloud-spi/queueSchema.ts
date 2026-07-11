import type {ServiceSchema, FieldSchema, TableColumnSchema} from './types'

const queueColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Queue Name'},
    {name: 'type', label: 'Type'},
    {name: 'cloud', label: 'Cloud'},
    {name: 'messages', label: 'Messages'},
    {name: 'inFlight', label: 'In Flight'},
]

const queueFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsQueueSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'queue',
        displayName: 'AWS SQS',
        fields: [
            {
                name: 'queueName',
                label: 'Queue Name',
                type: 'text',
                required: true,
                description: 'Unique SQS queue name. FIFO queues must end in .fifo',
            },
            {
                name: 'fifo',
                label: 'Queue Type',
                type: 'select',
                required: false,
                options: [
                    {label: 'Standard', value: 'false'},
                    {label: 'FIFO', value: 'true'},
                ],
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: queueFilters,
        columns: queueColumns,
    }
}
