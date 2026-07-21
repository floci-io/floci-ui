import type {CapabilitySchema, CloudProvider, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const queueColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Type'},
    {name: 'cloud', label: 'Cloud'},
    {name: 'region', label: 'Region'},
    {name: 'createdAt', label: 'Created At'},
]

const queueFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const queueResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List resources', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create resource', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete resource', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect resource', enabled: true, status: 'available', runtimeRequired: false},
    {name: 'send', label: 'Send message', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'receive', label: 'Receive messages', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'deleteMessage', label: 'Delete message', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'purge', label: 'Purge queue', enabled: true, status: 'available', runtimeRequired: true},
]

export function awsQueueSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'queue',
        displayName: 'SQS Queue',
        fields: [
            {
                name: 'queueName',
                label: 'Queue Name',
                type: 'text',
                required: true,
                description: '1-80 characters. Letters, numbers, hyphens, and underscores. FIFO queues must end with .fifo.',
                validation: {
                    pattern: '^[a-zA-Z0-9_-]{1,75}(\\.fifo)?$',
                    minLength: 1,
                    maxLength: 80,
                    message: 'Use a valid SQS queue name: 1-80 characters using letters, numbers, hyphens, and underscores. FIFO queues must end with .fifo.',
                },
            },
            {
                name: 'visibilityTimeout',
                label: 'Visibility Timeout (seconds)',
                type: 'text',
                required: false,
                description: 'How long a message is hidden after being received. 0-43200. Default: 30.',
            },
            {
                name: 'messageRetentionPeriod',
                label: 'Message Retention (seconds)',
                type: 'text',
                required: false,
                description: 'How long messages persist. 60-1209600. Default: 345600 (4 days).',
            },
            {
                name: 'delaySeconds',
                label: 'Delivery Delay (seconds)',
                type: 'text',
                required: false,
                description: 'Delay before messages become available. 0-900. Default: 0.',
            },
            {
                name: 'fifoQueue',
                label: 'FIFO Queue',
                type: 'select',
                required: false,
                options: [
                    {label: 'Standard', value: 'false'},
                    {label: 'FIFO', value: 'true'},
                ],
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect', 'send', 'receive', 'deleteMessage', 'purge'],
        capabilities: {
            resourceActions: queueResourceActions,
        },
        filters: queueFilters,
        columns: queueColumns,
    }
}

export function queueSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsQueueSchema()
    return null
}