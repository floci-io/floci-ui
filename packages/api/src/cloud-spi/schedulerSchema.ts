import type {CapabilitySchema, CloudProvider, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const schedulerColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'schedule', label: 'Schedule', path: 'metadata.schedule'},
    {name: 'timeZone', label: 'Time Zone', path: 'metadata.timeZone'},
    {name: 'target', label: 'Target URI', path: 'metadata.target'},
    {name: 'status', label: 'State'},
    {name: 'region', label: 'Region'},
    {name: 'createdAt', label: 'Created / Updated At'},
]

const schedulerFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const schedulerResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List jobs', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create job', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete job', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect job', enabled: true, status: 'available', runtimeRequired: false},
]

export function gcpSchedulerSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'scheduler',
        displayName: 'Cloud Scheduler',
        fields: [
            {
                name: 'jobName',
                label: 'Job Name',
                type: 'text',
                required: true,
                description: 'Unique identifier for the job.',
                validation: {
                    pattern: '^[a-zA-Z0-9_-]{1,500}$',
                    minLength: 1,
                    maxLength: 500,
                    message: 'Use a valid job name: 1-500 alphanumeric characters, underscores, or hyphens.',
                },
            },
            {
                name: 'schedule',
                label: 'Schedule (Cron)',
                type: 'text',
                required: true,
                description: 'Cron schedule syntax (e.g. * * * * * or 0 9 * * 1).',
            },
            {
                name: 'timeZone',
                label: 'Time Zone',
                type: 'text',
                required: false,
                description: 'Timezone (e.g. UTC, America/New_York). Defaults to UTC.',
            },
            {
                name: 'targetUri',
                label: 'Target HTTP URI',
                type: 'text',
                required: true,
                description: 'Target URL invoked when the job fires.',
            },
            {
                name: 'httpMethod',
                label: 'HTTP Method',
                type: 'select',
                required: false,
                options: [
                    {label: 'POST', value: 'POST'},
                    {label: 'GET', value: 'GET'},
                    {label: 'PUT', value: 'PUT'},
                    {label: 'DELETE', value: 'DELETE'},
                ],
            },
            {
                name: 'description',
                label: 'Description',
                type: 'text',
                required: false,
                description: 'Optional description of the job.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: schedulerResourceActions,
        },
        filters: schedulerFilters,
        columns: schedulerColumns,
    }
}

export function schedulerSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'gcp') return gcpSchedulerSchema()
    return null
}
