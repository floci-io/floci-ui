import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/**
 * EventBridge V2 holds event buses and the subscribers that deliver a bus's
 * events, so the table lists both kinds side by side, like IAM.
 */
export const EVENTBRIDGE_V2_KINDS = ['buses', 'subscribers'] as const
export type EventBridgeV2Kind = (typeof EVENTBRIDGE_V2_KINDS)[number]

export const EVENTBRIDGE_V2_NAME_PATTERN = '^[A-Za-z0-9][.\\-_A-Za-z0-9]*$'
export const EVENTBRIDGE_V2_NAME_MAX_LENGTH = 256

const IS_SUBSCRIBER = {field: 'kind', equals: 'subscribers'}

const eventBridgeV2Columns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Kind', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'eventBus', label: 'Event Bus', path: 'metadata.eventBusName', emptyText: '-'},
    {name: 'target', label: 'Target ARN', path: 'metadata.targetArn', format: 'code', emptyText: '-'},
    {name: 'region', label: 'Region'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

/** `kind` is API-only today, for the same reason as the AWS IAM facet. */
const eventBridgeV2Filters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: false,
        description: 'Leave unset to list event buses and subscribers together.',
        options: EVENTBRIDGE_V2_KINDS.map((value) => ({label: value, value})),
    },
]

const resourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List event buses and subscribers', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
]

export function awsEventBridgeV2Schema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'eventsv2',
        displayName: 'EventBridge V2',
        fields: [
            {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                defaultValue: 'buses',
                options: [
                    {label: 'Event bus', value: 'buses'},
                    {label: 'Subscriber', value: 'subscribers'},
                ],
            },
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                description: 'Starts with a letter or number, then letters, numbers, periods, hyphens, or underscores.',
                validation: {
                    pattern: EVENTBRIDGE_V2_NAME_PATTERN,
                    minLength: 1,
                    maxLength: EVENTBRIDGE_V2_NAME_MAX_LENGTH,
                    message: 'Start with a letter or number, then use letters, numbers, periods, hyphens, or underscores.',
                },
            },
            {name: 'description', label: 'Description', type: 'text', required: false, validation: {maxLength: 512}},
            {
                name: 'eventBus',
                label: 'Event Bus',
                type: 'text',
                required: false,
                requiredWhen: IS_SUBSCRIBER,
                visibleWhen: IS_SUBSCRIBER,
                description: 'Name or ARN of the event bus to subscribe to.',
            },
            {
                name: 'targetArn',
                label: 'Target Queue ARN',
                type: 'text',
                required: false,
                requiredWhen: IS_SUBSCRIBER,
                visibleWhen: IS_SUBSCRIBER,
                description: 'ARN of the Amazon SQS queue that receives matching events.',
            },
            {
                name: 'roleArn',
                label: 'Delivery Role ARN',
                type: 'text',
                required: false,
                requiredWhen: IS_SUBSCRIBER,
                visibleWhen: IS_SUBSCRIBER,
                description: 'IAM role EventBridge assumes to deliver to the target.',
            },
            {
                name: 'filterPattern',
                label: 'Event Pattern (JSON)',
                type: 'textarea',
                required: false,
                span: true,
                visibleWhen: IS_SUBSCRIBER,
                description: 'Optional DATA-scope pattern, for example {"source":["com.shop"]}. Leave empty to receive every event.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions},
        filters: eventBridgeV2Filters,
        columns: eventBridgeV2Columns,
    }
}
