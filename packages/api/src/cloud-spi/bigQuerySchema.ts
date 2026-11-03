import type {ServiceSchema, TableColumnSchema} from './types'

export const GCP_BIGQUERY_RESOURCE_TYPES = ['dataset', 'table'] as const

/** Dataset and table ids: letters, numbers and underscores, up to 1024 characters. */
export const GCP_BIGQUERY_ID_PATTERN = '^[A-Za-z0-9_]{1,1024}$'
export const GCP_BIGQUERY_ID_MESSAGE = 'Use 1-1024 letters, numbers, or underscores.'

/** Column types accepted in a table schema, in both their legacy and GoogleSQL spellings. */
export const GCP_BIGQUERY_FIELD_TYPES = [
    'STRING',
    'BYTES',
    'INTEGER',
    'INT64',
    'FLOAT',
    'FLOAT64',
    'NUMERIC',
    'BIGNUMERIC',
    'BOOLEAN',
    'BOOL',
    'TIMESTAMP',
    'DATE',
    'TIME',
    'DATETIME',
    'GEOGRAPHY',
    'JSON',
] as const

export const GCP_BIGQUERY_SCHEMA_MESSAGE =
    'Comma separated name:TYPE pairs, for example id:INTEGER,item:STRING. Types: ' +
    `${GCP_BIGQUERY_FIELD_TYPES.join(', ')}.`

/**
 * Datasets and their tables share one list, told apart by `Kind`: a table cannot
 * exist without a dataset, and the dataset column ties each table to its parent.
 */
const gcpBigQueryColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'kind', label: 'Kind', path: 'type', format: 'badge'},
    {name: 'dataset', label: 'Dataset', path: 'metadata.dataset'},
    {name: 'tableType', label: 'Table Type', path: 'metadata.tableType', format: 'badge'},
    {name: 'rows', label: 'Rows', path: 'metadata.numRows'},
    {name: 'location', label: 'Location', path: 'metadata.location'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

/**
 * Queries, row inserts and table data are not offered: this first slice is the
 * dataset and table inventory plus the schema inspector.
 */
export function gcpBigQuerySchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'analytics',
        displayName: 'BigQuery',
        fields: [
            {
                name: 'resourceType',
                label: 'Resource Type',
                type: 'select',
                required: true,
                defaultValue: 'dataset',
                description: 'A table lives in a dataset, so create a dataset first.',
                options: [
                    {label: 'Dataset', value: 'dataset'},
                    {label: 'Table', value: 'table'},
                ],
            },
            {
                name: 'datasetName',
                label: 'Dataset Name',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'dataset'},
                visibleWhen: {field: 'resourceType', equals: 'dataset'},
                description: GCP_BIGQUERY_ID_MESSAGE,
                validation: {minLength: 1, maxLength: 1024, pattern: GCP_BIGQUERY_ID_PATTERN, message: GCP_BIGQUERY_ID_MESSAGE},
            },
            {
                name: 'dataset',
                label: 'Dataset',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'table'},
                visibleWhen: {field: 'resourceType', equals: 'table'},
                description: 'Id of an existing dataset.',
                validation: {minLength: 1, maxLength: 1024, pattern: GCP_BIGQUERY_ID_PATTERN, message: GCP_BIGQUERY_ID_MESSAGE},
            },
            {
                name: 'tableName',
                label: 'Table Name',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'table'},
                visibleWhen: {field: 'resourceType', equals: 'table'},
                description: GCP_BIGQUERY_ID_MESSAGE,
                validation: {minLength: 1, maxLength: 1024, pattern: GCP_BIGQUERY_ID_PATTERN, message: GCP_BIGQUERY_ID_MESSAGE},
            },
            {
                name: 'schema',
                label: 'Schema',
                type: 'text',
                required: false,
                requiredWhen: {field: 'resourceType', equals: 'table'},
                visibleWhen: {field: 'resourceType', equals: 'table'},
                span: true,
                description: GCP_BIGQUERY_SCHEMA_MESSAGE,
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List datasets and tables', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create dataset or table', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect dataset or table', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete dataset or table', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: gcpBigQueryColumns,
    }
}
