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

/**
 * Queue message verbs shared by SQS and OCI Queue. Pub/Sub's pull semantics
 * (acks, subscriptions) differ, so these are not offered on the GCP schema.
 */
const queueMessageCapabilities: CapabilitySchema<ResourceActionName>[] = [
    {name: 'sendMessage', label: 'Send Message', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'receiveMessages', label: 'Receive Messages', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'deleteMessage', label: 'Delete Message', enabled: true, status: 'available', runtimeRequired: true},
]

const sqsMessageCapabilities: CapabilitySchema<ResourceActionName>[] = [
    ...queueMessageCapabilities,
    {name: 'purgeQueue', label: 'Purge Queue', enabled: true, status: 'available', runtimeRequired: true},
]

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
                description: 'Up to 80 alphanumeric characters, hyphens, or underscores (FIFO queues must end in .fifo).',
                validation: {
                    pattern: '^([A-Za-z0-9_-]{1,80}|[A-Za-z0-9_-]{1,75}\\.fifo)$',
                    message: 'Use a valid SQS queue name: up to 80 alphanumeric characters, hyphens, or underscores.',
                },
            },
            {
                name: 'visibilityTimeout',
                label: 'Visibility Timeout',
                type: 'text',
                required: false,
                description: 'Seconds a received message stays hidden (0-43200). Defaults to 30.',
                validation: {
                    pattern: '^(0|[1-9][0-9]{0,3}|[1-3][0-9]{4}|4[0-2][0-9]{3}|43[01][0-9]{2}|43200)$',
                    message: 'Use a whole number of seconds between 0 and 43200.',
                },
            },
            {
                name: 'messageRetentionPeriod',
                label: 'Retention Period',
                type: 'text',
                required: false,
                description: 'Seconds a message is kept (60-1209600). Defaults to 345600 (4 days).',
                validation: {
                    pattern: '^([6-9][0-9]|[1-9][0-9]{2,5}|1[01][0-9]{5}|120[0-8][0-9]{3}|1209[0-5][0-9]{2}|1209600)$',
                    message: 'Use a whole number of seconds between 60 and 1209600.',
                },
            },
            {
                name: 'delaySeconds',
                label: 'Delivery Delay',
                type: 'text',
                required: false,
                description: 'Delivery delay for all messages sent to the queue (0-900 seconds). Defaults to 0.',
                validation: {
                    pattern: '^(0|[1-9][0-9]?|[1-8][0-9]{2}|900)$',
                    message: 'Use a whole number of seconds between 0 and 900.',
                },
            },
            {
                name: 'maximumMessageSizeKb',
                label: 'Maximum Message Size (KB)',
                type: 'text',
                required: false,
                description: 'Maximum message size in KB (1-1024). Defaults to 1024 (1 MB).',
                validation: {
                    pattern: '^([1-9][0-9]{0,2}|10[01][0-9]|102[0-4])$',
                    message: 'Use a whole number of KB between 1 and 1024.',
                },
            },
            {
                name: 'receiveMessageWaitTimeSeconds',
                label: 'Receive Wait Time',
                type: 'text',
                required: false,
                description: 'Wait time for ReceiveMessage calls (0-20 seconds). Defaults to 0.',
                validation: {pattern: '^(0|[1-9]|1[0-9]|20)$', message: 'Use a whole number of seconds between 0 and 20.'},
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: messagingFilters,
        columns: messagingColumns,
        capabilities: {resourceActions: [...crudCapabilities('queue'), ...sqsMessageCapabilities]},
    }
}

const ociQueueColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'messages', label: 'Visible Messages', path: 'metadata.approximateMessages'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

export function ociMessagingSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'messaging',
        displayName: 'OCI Queue',
        fields: [
            {
                name: 'displayName',
                label: 'Queue Name',
                type: 'text',
                required: true,
                description: 'Up to 255 characters. Created in the tenancy root compartment.',
                validation: {maxLength: 255, message: 'Use at most 255 characters.'},
            },
            {
                name: 'visibilityInSeconds',
                label: 'Visibility Timeout',
                type: 'text',
                required: false,
                description: 'Seconds a received message stays hidden (0-43200). Defaults to 30.',
                validation: {pattern: '^[0-9]{1,5}$', message: 'Use a whole number of seconds from 0 to 43200.'},
            },
            {
                name: 'retentionInSeconds',
                label: 'Retention Period',
                type: 'text',
                required: false,
                description: 'Seconds a message is kept (10-604800). Defaults to 86400 (1 day). Cannot be changed later.',
                validation: {pattern: '^[0-9]{2,6}$', message: 'Use a whole number of seconds from 10 to 604800.'},
            },
            {
                name: 'deadLetterQueueDeliveryCount',
                label: 'Dead Letter Delivery Count',
                type: 'text',
                required: false,
                description: 'Deliveries before a message moves to the dead letter queue (0-20). 0 disables it.',
                validation: {pattern: '^[0-9]{1,2}$', message: 'Use a whole number from 0 to 20.'},
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: messagingFilters,
        columns: ociQueueColumns,
        capabilities: {resourceActions: [...crudCapabilities('queue'), ...queueMessageCapabilities]},
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
