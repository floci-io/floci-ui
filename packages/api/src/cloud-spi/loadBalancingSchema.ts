import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const loadBalancerColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'lbType', label: 'Type', path: 'metadata.lbType'},
    {name: 'scheme', label: 'Scheme', path: 'metadata.scheme'},
    {name: 'dnsName', label: 'DNS Name', path: 'metadata.dnsName', format: 'code', emptyText: '—'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

const loadBalancerFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

export const ELB_TYPES = ['application', 'network'] as const
export const ELB_SCHEMES = ['internet-facing', 'internal'] as const

/** ELBv2 names: up to 32 chars, alphanumerics and hyphens, no leading/trailing hyphen. */
export const ELB_NAME_PATTERN = '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,30}[a-zA-Z0-9])?$'

export function awsLoadBalancingSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'loadbalancing',
        displayName: 'AWS Elastic Load Balancing',
        fields: [
            {
                name: 'name',
                label: 'Load Balancer Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: ELB_NAME_PATTERN,
                    minLength: 1,
                    maxLength: 32,
                    message: 'Up to 32 characters: letters, digits and hyphens, not starting or ending with a hyphen.',
                },
            },
            {
                name: 'subnets',
                label: 'Subnet IDs',
                type: 'text',
                required: true,
                span: true,
                group: 'Required',
                // Follows the compute schema, which takes security group ids the
                // same way rather than pushing create into a bespoke panel.
                description:
                    'Two or more subnet ids, comma separated — e.g. subnet-aaa, subnet-bbb. ELB requires them to be in different availability zones.',
            },
            {
                name: 'type',
                label: 'Type',
                type: 'select',
                required: false,
                description: 'Defaults to application.',
                options: ELB_TYPES.map((value) => ({label: value, value})),
            },
            {
                name: 'scheme',
                label: 'Scheme',
                type: 'select',
                required: false,
                description: 'Defaults to internet-facing.',
                options: ELB_SCHEMES.map((value) => ({label: value, value})),
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List load balancers', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'create',
                    label: 'Create load balancer',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: loadBalancerFilters,
        columns: loadBalancerColumns,
    }
}
