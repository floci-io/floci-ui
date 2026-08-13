import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

export const SCHEDULE_NAME_MAX_LENGTH = 64
export const SCHEDULE_NAME_LENGTH_MESSAGE = `Use a valid schedule name: ${SCHEDULE_NAME_MAX_LENGTH} characters or fewer.`
export const RESOURCE_TYPE_MESSAGE = 'Use a valid resourceType: event-bus or schedule.'

const eventbridgeColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Resource Type'},
    {name: 'status', label: 'Status'},
    {name: 'region', label: 'Region'},
    {name: 'createdAt', label: 'Created At'},
]

const eventbridgeFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsEventbridgeSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'messaging',
        displayName: 'EventBridge',
        fields: [
            {
                name: 'resourceType',
                label: 'Resource Type',
                type: 'select',
                required: true,
                options: [
                    {label: 'Event bus', value: 'event-bus'},
                    {label: 'Scheduler schedule', value: 'schedule'},
                ],
            },
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                description: 'Letters, numbers, periods, hyphens, and underscores.',
                validation: {
                    pattern: '^[A-Za-z0-9._\\-]+$',
                    maxLength: 256,
                    maxLengthWhen: {
                        field: 'resourceType',
                        equals: 'schedule',
                        value: SCHEDULE_NAME_MAX_LENGTH,
                        message: SCHEDULE_NAME_LENGTH_MESSAGE,
                    },
                    message: 'Use letters, numbers, periods, hyphens, or underscores.',
                },
            },
            {
                name: 'description',
                label: 'Description',
                type: 'text',
                required: false,
            },
            {
                name: 'groupName',
                label: 'Schedule Group',
                type: 'text',
                required: false,
                description: 'Schedules only. Defaults to the default schedule group.',
            },
            {
                name: 'scheduleExpression',
                label: 'Schedule Expression',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'schedule'},
                description: 'Schedules only. Example: rate(1 hour) or cron(0 12 * * ? *).',
                span: true,
            },
            {
                name: 'scheduleExpressionTimezone',
                label: 'Schedule Time Zone',
                type: 'text',
                required: false,
                description: 'Schedules only. Defaults to UTC.',
            },
            {
                name: 'state',
                label: 'Schedule State',
                type: 'select',
                required: false,
                options: [
                    {label: 'Enabled', value: 'ENABLED'},
                    {label: 'Disabled', value: 'DISABLED'},
                ],
            },
            {
                name: 'targetArn',
                label: 'Target ARN',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'schedule'},
                description: 'Schedules only. Lambda, SQS, SNS, or EventBridge target ARN.',
                span: true,
            },
            {
                name: 'roleArn',
                label: 'Target Role ARN',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'schedule'},
                description: 'Schedules only. IAM role assumed by EventBridge Scheduler.',
                span: true,
            },
            {
                name: 'targetInput',
                label: 'Target Input',
                type: 'text',
                required: false,
                description: 'Schedules only. Optional JSON or text payload.',
                span: true,
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        filters: eventbridgeFilters,
        columns: eventbridgeColumns,
    }
}
