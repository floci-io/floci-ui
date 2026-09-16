import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const containerColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Service'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'image', label: 'Image', path: 'metadata.image', format: 'code', emptyText: '—'},
    {name: 'uri', label: 'URL', path: 'metadata.uri', emptyText: '—'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

const containerFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/** Cloud Run service names: lowercase letters, digits and hyphens, max 49 chars. */
export const CLOUD_RUN_NAME_PATTERN = '^[a-z]([-a-z0-9]*[a-z0-9])?$'
export const CLOUD_RUN_NAME_MAX_LENGTH = 49

export function gcpContainersSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'containers',
        displayName: 'Cloud Run',
        fields: [
            {
                name: 'name',
                label: 'Service Name',
                type: 'text',
                required: true,
                validation: {
                    pattern: CLOUD_RUN_NAME_PATTERN,
                    minLength: 1,
                    maxLength: CLOUD_RUN_NAME_MAX_LENGTH,
                    message: 'Start with a letter; lowercase letters, digits and hyphens only.',
                },
            },
            {
                name: 'image',
                label: 'Container Image',
                type: 'text',
                required: true,
                span: true,
                // The most common cause of a service that never becomes ready.
                description:
                    'The container must listen on the port given by the PORT environment variable (8080 by default). An image that listens elsewhere will report a failed condition.',
            },
            {
                name: 'port',
                label: 'Container Port',
                type: 'text',
                required: false,
                description: 'Overrides the port passed to the container. Defaults to 8080.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List services', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Deploy service', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete service', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect service', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: containerFilters,
        columns: containerColumns,
    }
}

export function containersSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    return cloud === 'gcp' ? gcpContainersSchema() : null
}
