import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/**
 * One category for queue- and topic-shaped services.
 *
 * SQS queues and Pub/Sub topics differ in delivery semantics but present the
 * same way in a console — a named endpoint with a depth and a few settings — so
 * splitting them into separate categories would double the nav for no gain.
 */

const messagingColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Type'},
    {name: 'messages', label: 'Messages', path: 'metadata.approximateMessages'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

const pubSubColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Type'},
    {name: 'path', label: 'Resource Path', path: 'metadata.resourcePath', format: 'code'},
]

const messagingFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

function crudCapabilities(noun: string): CapabilitySchema<ResourceActionName>[] {
    return [
        {name: 'list', label: `List ${noun}s`, enabled: true, status: 'available', runtimeRequired: true},
        {name: 'create', label: `Create ${noun}`, enabled: true, status: 'available', runtimeRequired: true},
        {name: 'delete', label: `Delete ${noun}`, enabled: true, status: 'available', runtimeRequired: true},
        {name: 'inspect', label: `Inspect ${noun}`, enabled: true, status: 'available', runtimeRequired: false},
    ]
}

export function awsMessagingSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'messaging',
        displayName: 'AWS SQS',
        fields: [
            {
                name: 'queueName',
                label: 'Queue Name',
                type: 'text',
                required: true,
                description: 'Up to 80 alphanumeric characters, hyphens, or underscores.',
            },
            {
                name: 'visibilityTimeout',
                label: 'Visibility Timeout',
                type: 'text',
                required: false,
                description: 'Seconds a received message stays hidden. Defaults to 30.',
            },
            {
                name: 'messageRetentionPeriod',
                label: 'Retention Period',
                type: 'text',
                required: false,
                description: 'Seconds a message is kept. Defaults to 345600 (4 days).',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: messagingFilters,
        columns: messagingColumns,
        capabilities: {resourceActions: crudCapabilities('queue')},
    }
}

export function gcpMessagingSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'messaging',
        displayName: 'Cloud Pub/Sub',
        fields: [
            {
                name: 'topicName',
                label: 'Topic Name',
                type: 'text',
                required: true,
                description: 'Letters, numbers, hyphens, underscores, periods, tildes, plus, or percent signs.',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: messagingFilters,
        columns: pubSubColumns,
        capabilities: {resourceActions: crudCapabilities('topic')},
    }
}
