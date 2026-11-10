import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/** A domain name is 3 to 28 characters, starts with a lowercase letter, then lowercase letters, digits and hyphens. */
export const OPENSEARCH_NAME_MIN_LENGTH = 3
export const OPENSEARCH_NAME_MAX_LENGTH = 28
export const OPENSEARCH_NAME_PATTERN = '^[a-z][a-z0-9-]*$'
export const OPENSEARCH_NAME_MESSAGE = 'Start with a lowercase letter; lowercase letters, digits and hyphens only.'

const openSearchFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const openSearchColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Domain'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'engine', label: 'Engine', format: 'badge'},
    {name: 'version', label: 'Version'},
    {name: 'instanceClass', label: 'Instance Type'},
    {name: 'endpoint', label: 'Endpoint', path: 'metadata.endpoint', format: 'code'},
]

const openSearchActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List domains', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create domain', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect domain', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete domain', enabled: true, status: 'available', runtimeRequired: true},
]

/** OpenSearch Service domains. Tags and managed VPC endpoints are not listed. */
export function awsOpenSearchSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'search',
        displayName: 'AWS OpenSearch Service',
        fields: [
            {
                name: 'name',
                label: 'Domain Name',
                type: 'text',
                required: true,
                group: 'Required',
                description: `${OPENSEARCH_NAME_MIN_LENGTH} to ${OPENSEARCH_NAME_MAX_LENGTH} characters.`,
                validation: {
                    pattern: OPENSEARCH_NAME_PATTERN,
                    minLength: OPENSEARCH_NAME_MIN_LENGTH,
                    maxLength: OPENSEARCH_NAME_MAX_LENGTH,
                    message: OPENSEARCH_NAME_MESSAGE,
                },
            },
            {
                name: 'engineVersion',
                label: 'Engine Version',
                type: 'text',
                required: false,
                description: 'For example OpenSearch_2.11. Leave empty for the runtime default.',
            },
            {
                name: 'instanceType',
                label: 'Instance Type',
                type: 'text',
                required: false,
                description: 'For example t3.small.search. Leave empty for the runtime default.',
            },
            {
                name: 'volumeSize',
                label: 'Storage (GiB)',
                type: 'text',
                required: false,
                description: 'EBS volume size in GiB. Leave empty for the runtime default.',
                validation: {pattern: '^[0-9]+$', message: 'A whole number of GiB.'},
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {resourceActions: openSearchActions},
        filters: openSearchFilters,
        columns: openSearchColumns,
    }
}
