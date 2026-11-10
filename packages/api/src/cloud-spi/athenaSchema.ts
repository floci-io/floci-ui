import type {ServiceSchema, TableColumnSchema} from './types'

export const AWS_ATHENA_WORKGROUP_PATTERN = '^[A-Za-z0-9._-]{1,128}$'
export const AWS_ATHENA_WORKGROUP_MESSAGE = 'Use 1-128 letters, numbers, periods, hyphens, or underscores.'

/**
 * Workgroups and query executions share one list, told apart by `Kind`: a query
 * always runs in a workgroup, and the workgroup column ties each one to it.
 */
const awsAthenaColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'kind', label: 'Kind', path: 'type', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'workGroup', label: 'Workgroup', path: 'metadata.workGroup'},
    {name: 'database', label: 'Database', path: 'metadata.database'},
    {name: 'createdAt', label: 'Created / Submitted', format: 'datetime'},
]

/**
 * Starting or stopping a query, reading results, data catalogs and tables are not
 * offered: this first slice is the workgroup inventory plus the query history.
 */
export function awsAthenaSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'analytics',
        displayName: 'Athena',
        fields: [
            {
                name: 'name',
                label: 'Workgroup Name',
                type: 'text',
                required: true,
                description: AWS_ATHENA_WORKGROUP_MESSAGE,
                validation: {minLength: 1, maxLength: 128, pattern: AWS_ATHENA_WORKGROUP_PATTERN, message: AWS_ATHENA_WORKGROUP_MESSAGE},
            },
            {
                name: 'description',
                label: 'Description',
                type: 'text',
                required: false,
                description: 'Up to 1024 characters.',
                validation: {maxLength: 1024},
            },
            {
                name: 'outputLocation',
                label: 'Query Result Location',
                type: 'text',
                required: false,
                span: true,
                description: 'S3 location for query results, for example s3://my-bucket/results/.',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List workgroups and queries', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create workgroup', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect workgroup or query', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete workgroup', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: awsAthenaColumns,
    }
}
