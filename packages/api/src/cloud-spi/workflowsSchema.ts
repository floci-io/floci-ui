import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

/**
 * No `status` column, deliberately.
 *
 * ListStateMachines returns only the ARN, name, type and creation date — real Step
 * Functions does the same. Status lives on DescribeStateMachine, so putting it in
 * the table would mean one extra call per row. It is surfaced on inspect instead.
 */
const workflowColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'machineType', label: 'Type', path: 'metadata.machineType', format: 'badge'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

const workflowFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/**
 * Step Functions accepts a wider character set, but this is the subset AWS
 * recommends and the one that is unambiguous in an ARN.
 */
export const STATE_MACHINE_NAME_PATTERN = '^[a-zA-Z0-9_-]{1,80}$'

export function awsWorkflowsSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'workflows',
        displayName: 'AWS Step Functions',
        fields: [
            {
                name: 'name',
                label: 'State Machine Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: STATE_MACHINE_NAME_PATTERN,
                    minLength: 1,
                    maxLength: 80,
                    message: 'Up to 80 characters: letters, digits, hyphens and underscores.',
                },
            },
            {
                name: 'roleArn',
                label: 'Execution Role ARN',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'The IAM role the state machine assumes when it runs.',
                validation: {
                    pattern: '^arn:aws[a-z-]*:iam::\\d{12}:role/.+$',
                    message: 'Must be an IAM role ARN, e.g. arn:aws:iam::000000000000:role/my-role.',
                },
            },
            {
                name: 'definition',
                label: 'Definition (Amazon States Language)',
                type: 'textarea',
                required: true,
                span: true,
                group: 'Required',
                description: 'JSON with StartAt and States, e.g. {"StartAt":"Done","States":{"Done":{"Type":"Succeed"}}}',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List state machines', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'create',
                    label: 'Create state machine',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: workflowFilters,
        columns: workflowColumns,
    }
}
