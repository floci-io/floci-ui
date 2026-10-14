import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const zoneColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name', format: 'code'},
    {name: 'id', label: 'Zone ID', format: 'code'},
    {name: 'zoneType', label: 'Type', path: 'metadata.zoneType', format: 'badge'},
    {name: 'recordCount', label: 'Records', path: 'metadata.recordCount', emptyText: '—'},
    {name: 'comment', label: 'Comment', path: 'metadata.comment', emptyText: '—'},
]

const dnsFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/** A domain name, optionally with the trailing root dot Route 53 itself returns. */
export const ROUTE53_ZONE_NAME_PATTERN = '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\\.?$'
export const ROUTE53_ZONE_NAME_MAX_LENGTH = 253
export const ROUTE53_COMMENT_MAX_LENGTH = 256
export const ROUTE53_VPC_ID_PATTERN = '^vpc-[A-Za-z0-9]+$'
export const ROUTE53_VPC_REGION_PATTERN = '^[a-z]{2}(-[a-z0-9]+)+-[0-9]+$'

export function awsDnsSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'dns',
        displayName: 'Route 53 Hosted Zones',
        fields: [
            {
                name: 'name',
                label: 'Domain Name',
                type: 'text',
                required: true,
                span: true,
                group: 'Required',
                description:
                    'e.g. example.com. A zone without a VPC is public: Floci only stores its records and nothing answers queries for it locally.',
                validation: {
                    pattern: ROUTE53_ZONE_NAME_PATTERN,
                    minLength: 1,
                    maxLength: ROUTE53_ZONE_NAME_MAX_LENGTH,
                    message: 'Use a domain name such as example.com.',
                },
            },
            {
                name: 'comment',
                label: 'Comment',
                type: 'text',
                required: false,
                validation: {maxLength: ROUTE53_COMMENT_MAX_LENGTH},
            },
            {
                name: 'vpcId',
                label: 'VPC ID',
                type: 'text',
                required: false,
                group: 'Private zone',
                description:
                    'Set a VPC ID and region to create a private zone. Only private zones are answered locally, by the Floci embedded resolver, and only for containers it manages.',
                validation: {pattern: ROUTE53_VPC_ID_PATTERN, message: 'Use a VPC ID such as vpc-0123456789abcdef0.'},
            },
            {
                name: 'vpcRegion',
                label: 'VPC Region',
                type: 'text',
                required: false,
                group: 'Private zone',
                validation: {pattern: ROUTE53_VPC_REGION_PATTERN, message: 'Use a region such as us-east-1.'},
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List hosted zones', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'create',
                    label: 'Create hosted zone',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
            ],
            // A hosted zone holds one fixed collection, its record sets.
            collectionActions: [
                {
                    name: 'list',
                    label: 'List zone collections',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
            ],
            itemActions: [
                {name: 'list', label: 'List record sets', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'put', label: 'Upsert record set', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete record set', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: dnsFilters,
        columns: zoneColumns,
    }
}
