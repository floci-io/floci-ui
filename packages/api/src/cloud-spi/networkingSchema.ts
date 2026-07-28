import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const networkingColumns: TableColumnSchema[] = [
    {name: 'name',    label: 'Name'},
    {name: 'version', label: 'CIDR', path: 'metadata.cidrBlock', format: 'code'},
    {name: 'status',  label: 'State', format: 'badge'},
    {name: 'type',    label: 'Type'},
]

const networkingFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsNetworkingSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'networking',
        displayName: 'Networking',
        fields: [],
        actions: ['list'],
        filters: networkingFilters,
        columns: networkingColumns,
        capabilities: {
            resourceActions: [
                {name: 'list',    label: 'VPCs',    enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                // The generic form cannot express the dependent selectors these
                // need, so both live in the Networking panel. Advertising them as
                // available here produced a 502 telling the user to go elsewhere.
                {
                    name: 'create',
                    label: 'Create resources',
                    enabled: false,
                    status: 'partial',
                    reason: 'Use the Networking panel — VPC and subnet creation need dependent selectors.',
                    runtimeRequired: true,
                },
                {
                    name: 'delete',
                    label: 'Delete resources',
                    enabled: false,
                    status: 'partial',
                    reason: 'Use the Networking panel — deletion must resolve dependent networking resources first.',
                    runtimeRequired: true,
                },
            ],
        },
    }
}
