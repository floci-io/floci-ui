import type {CapabilitySchema, CloudProvider, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const cloudformationColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Stack Name'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

const cloudformationFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const cloudformationResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List stacks', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create stack', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete stack', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect stack', enabled: true, status: 'available', runtimeRequired: false},
]

export function awsCloudformationSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'iac',
        displayName: 'CloudFormation',
        fields: [
            {
                name: 'stackName',
                label: 'Stack Name',
                type: 'text',
                required: true,
                description: 'Must start with a letter. Letters, numbers, and hyphens, up to 128 characters.',
                validation: {
                    pattern: '^[a-zA-Z][a-zA-Z0-9\\-]{0,127}$',
                    maxLength: 128,
                    message: 'Use a valid stack name: start with a letter, then letters, numbers, or hyphens.',
                },
            },
            {
                name: 'templateBody',
                label: 'Template Body',
                type: 'text',
                required: true,
                span: true,
                description: 'Single-line CloudFormation template JSON — the console form has no multi-line editor yet.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: cloudformationResourceActions,
        },
        filters: cloudformationFilters,
        columns: cloudformationColumns,
    }
}

export function cloudformationSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsCloudformationSchema()
    return null
}
