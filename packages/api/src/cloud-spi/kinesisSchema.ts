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

const ociStreamActions: CapabilitySchema<ResourceActionName>[] = [
    ...streamActions,
    {name: 'putMessages', label: 'Put messages', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'readMessages', label: 'Read messages', enabled: true, status: 'available', runtimeRequired: true},
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
        capabilities: {resourceActions: ociStreamActions},
        filters: streamFilters,
        columns: ociStreamColumns,
    }
}

export const GCP_KAFKA_RESOURCE_TYPES = ['cluster', 'topic'] as const

/** Managed Kafka cluster ids: 1-63 lowercase letters, numbers or hyphens, starting with a letter. */
export const GCP_KAFKA_CLUSTER_ID_PATTERN = '^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$'
export const GCP_KAFKA_CLUSTER_ID_MESSAGE =
    'Use 1-63 lowercase letters, numbers, or hyphens, starting with a letter and not ending in a hyphen.'

/** Kafka topic names: 1-249 letters, numbers, dots, underscores or hyphens. */
export const GCP_KAFKA_TOPIC_ID_PATTERN = '^[A-Za-z0-9._-]{1,249}$'
export const GCP_KAFKA_TOPIC_ID_MESSAGE = 'Use 1-249 letters, numbers, dots, underscores, or hyphens.'

/**
 * Clusters and their topics share one table, told apart by `Kind`: a topic cannot
 * exist without a cluster, and the cluster column ties each topic to its parent.
 */
const gcpKafkaColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'kind', label: 'Kind', path: 'type', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge', emptyText: '—'},
    {name: 'cluster', label: 'Cluster', path: 'metadata.cluster', emptyText: '—'},
    {name: 'bootstrapAddress', label: 'Bootstrap Address', path: 'metadata.bootstrapAddress', format: 'code', emptyText: '—'},
    {name: 'partitions', label: 'Partitions', path: 'metadata.partitionCount', emptyText: '—'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

/**
 * Produce and consume stay out, in line with the open decision on cursor based
 * streams. Cluster capacity and network are not offered: the local runtime fixes
 * them and rejects a create body that sets them.
 */
export function gcpManagedKafkaSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'streams',
        displayName: 'Managed Kafka',
        fields: [
            {
                name: 'resourceType',
                label: 'Resource Type',
                type: 'select',
                required: true,
                defaultValue: 'topic',
                description: 'A topic lives in a cluster, so create a cluster first.',
                options: [
                    {label: 'Topic', value: 'topic'},
                    {label: 'Cluster', value: 'cluster'},
                ],
            },
            {
                name: 'clusterName',
                label: 'Cluster Name',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'cluster'},
                visibleWhen: {field: 'resourceType', equals: 'cluster'},
                description: GCP_KAFKA_CLUSTER_ID_MESSAGE,
                validation: {minLength: 1, maxLength: 63, pattern: GCP_KAFKA_CLUSTER_ID_PATTERN, message: GCP_KAFKA_CLUSTER_ID_MESSAGE},
            },
            {
                name: 'topicName',
                label: 'Topic Name',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'topic'},
                visibleWhen: {field: 'resourceType', equals: 'topic'},
                description: GCP_KAFKA_TOPIC_ID_MESSAGE,
                validation: {minLength: 1, maxLength: 249, pattern: GCP_KAFKA_TOPIC_ID_PATTERN, message: GCP_KAFKA_TOPIC_ID_MESSAGE},
            },
            {
                name: 'cluster',
                label: 'Cluster',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'topic'},
                visibleWhen: {field: 'resourceType', equals: 'topic'},
                description: 'Id of an existing cluster in this location.',
                validation: {minLength: 1, maxLength: 63, pattern: GCP_KAFKA_CLUSTER_ID_PATTERN, message: GCP_KAFKA_CLUSTER_ID_MESSAGE},
            },
            {
                name: 'partitionCount',
                label: 'Partitions',
                type: 'text',
                required: false,
                visibleWhen: {field: 'resourceType', equals: 'topic'},
                description: 'Defaults to 1.',
                validation: {pattern: '^[1-9][0-9]*$', message: 'Partitions must be a positive whole number.'},
            },
            {
                name: 'replicationFactor',
                label: 'Replication Factor',
                type: 'text',
                required: false,
                visibleWhen: {field: 'resourceType', equals: 'topic'},
                description: 'Defaults to 1.',
                validation: {pattern: '^[1-9][0-9]*$', message: 'Replication factor must be a positive whole number.'},
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List clusters and topics', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create cluster or topic', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect cluster or topic', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete cluster or topic', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: streamFilters,
        columns: gcpKafkaColumns,
    }
}
