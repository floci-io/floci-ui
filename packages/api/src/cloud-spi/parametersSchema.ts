import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

/**
 * No value column, by design. A parameter value never travels with the resource
 * (see AwsParameterStoreAdapter), so offering the column would render an empty
 * cell for every row.
 */
const parameterColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name', format: 'code'},
    {name: 'parameterType', label: 'Type', path: 'metadata.parameterType', format: 'badge'},
    {name: 'description', label: 'Description', path: 'metadata.description', emptyText: '—'},
    {name: 'version', label: 'Version', path: 'metadata.version'},
    {name: 'createdAt', label: 'Last Modified', format: 'datetime'},
]

const parameterFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

export const PARAMETER_TYPES = ['String', 'StringList', 'SecureString'] as const

/** SSM caps a Standard-tier parameter name at 1011 characters. */
export const PARAMETER_NAME_MAX_LENGTH = 1011

export function awsParametersSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'parameters',
        displayName: 'SSM Parameter Store',
        fields: [
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                description: 'Hierarchical names are conventional, e.g. /app/prod/region.',
                validation: {
                    minLength: 1,
                    maxLength: PARAMETER_NAME_MAX_LENGTH,
                    message: 'Use a name of up to 1011 characters, optionally with / separators.',
                },
            },
            {
                name: 'type',
                label: 'Type',
                type: 'select',
                required: false,
                description: 'SecureString is stored encrypted. Its value is never returned to the console.',
                options: PARAMETER_TYPES.map((value) => ({label: value, value})),
            },
            {
                name: 'value',
                label: 'Value',
                type: 'text',
                required: true,
                span: true,
                description: 'Accepted here on create, but never read back.',
            },
            {name: 'description', label: 'Description', type: 'text', required: false, span: true},
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List parameters', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create parameter', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete parameter', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'inspect',
                    label: 'Inspect parameter',
                    enabled: true,
                    // Metadata only. The value is deliberately withheld, so this is
                    // not a full inspect and the UI should say so rather than
                    // render a blank field and look broken.
                    status: 'partial',
                    reason: 'Parameter values are never returned to the console, so the inspector shows metadata only.',
                    runtimeRequired: true,
                },
                {name: 'updateTags', label: 'Edit tags', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: parameterFilters,
        columns: parameterColumns,
    }
}

export function parametersSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    return cloud === 'aws' ? awsParametersSchema() : null
}
