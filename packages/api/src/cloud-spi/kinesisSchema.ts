import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const streamFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const streamColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Stream Name'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'mode', label: 'Mode', path: 'metadata.streamMode'},
    {name: 'shards', label: 'Open Shards', path: 'metadata.openShardCount'},
    {name: 'retention', label: 'Retention (hours)', path: 'metadata.retentionPeriodHours'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

const streamActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List streams', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create stream', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect stream', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete stream', enabled: true, status: 'available', runtimeRequired: true},
]

export function awsKinesisSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'streams',
        displayName: 'Kinesis',
        fields: [
            {
                name: 'name',
                label: 'Stream Name',
                type: 'text',
                required: true,
                description: '1-128 letters, numbers, underscores, hyphens, or periods.',
                validation: {
                    pattern: '^[A-Za-z0-9_.-]+$',
                    minLength: 1,
                    maxLength: 128,
                    message: 'Use 1-128 letters, numbers, underscores, hyphens, or periods.',
                },
            },
            {
                name: 'streamMode',
                label: 'Capacity Mode',
                type: 'select',
                required: true,
                defaultValue: 'PROVISIONED',
                options: [
                    {label: 'Provisioned', value: 'PROVISIONED'},
                    {label: 'On-demand', value: 'ON_DEMAND'},
                ],
            },
            {
                name: 'shardCount',
                label: 'Shard Count',
                type: 'text',
                required: false,
                requiredWhen: {field: 'streamMode', equals: 'PROVISIONED'},
                defaultValue: '1',
                description: 'Required for provisioned streams and ignored for on-demand streams.',
                validation: {
                    pattern: '^[1-9][0-9]*$',
                    message: 'Shard count must be a positive whole number.',
                },
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {resourceActions: streamActions},
        filters: streamFilters,
        columns: streamColumns,
    }
}
