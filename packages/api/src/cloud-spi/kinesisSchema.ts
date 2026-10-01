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

const ociStreamColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Stream Name'},
    {name: 'status', label: 'Lifecycle State', format: 'badge'},
    {name: 'partitions', label: 'Partitions', path: 'metadata.partitions'},
    {name: 'ocid', label: 'OCID', path: 'metadata.ocid', format: 'code'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

/** OCI Streaming control plane; streams are created in the tenancy root compartment. */
export function ociStreamingSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'streams',
        displayName: 'OCI Streaming',
        fields: [
            {
                name: 'name',
                label: 'Stream Name',
                type: 'text',
                required: true,
                description: '1-255 characters. Names need not be unique; the OCID identifies the stream.',
                validation: {
                    minLength: 1,
                    maxLength: 255,
                    message: 'Use 1-255 characters.',
                },
            },
            {
                name: 'partitions',
                label: 'Partitions',
                type: 'text',
                required: true,
                defaultValue: '1',
                validation: {
                    pattern: '^[1-9][0-9]*$',
                    message: 'Partitions must be a positive whole number.',
                },
            },
            {
                name: 'retentionInHours',
                label: 'Retention (hours)',
                type: 'text',
                required: false,
                defaultValue: '24',
                description: 'Between 24 and 168 hours. Defaults to 24.',
                validation: {
                    pattern: '^(?:2[4-9]|[3-9][0-9]|1[0-5][0-9]|16[0-8])$',
                    message: 'Retention must be a whole number of hours between 24 and 168.',
                },
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {resourceActions: streamActions},
        filters: streamFilters,
        columns: ociStreamColumns,
    }
}
