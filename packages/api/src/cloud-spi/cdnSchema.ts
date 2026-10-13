import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const distributionColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Distribution', format: 'code'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'domainName', label: 'Domain Name', path: 'metadata.domainName', format: 'code', emptyText: '—'},
    {name: 'enabled', label: 'Enabled', path: 'metadata.enabled', format: 'boolean'},
    {name: 'comment', label: 'Comment', path: 'metadata.comment', emptyText: '—'},
    {name: 'lastModifiedTime', label: 'Last Modified', path: 'metadata.lastModifiedTime', format: 'datetime'},
]

const cdnFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/** A bare host name: no scheme, port or path, which is what an origin `DomainName` carries. */
export const CLOUDFRONT_ORIGIN_DOMAIN_PATTERN = '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
export const CLOUDFRONT_ORIGIN_DOMAIN_MAX_LENGTH = 253
export const CLOUDFRONT_COMMENT_MAX_LENGTH = 128

export function awsCdnSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'cdn',
        displayName: 'CloudFront Distributions',
        fields: [
            {
                name: 'originDomainName',
                label: 'Origin Domain Name',
                type: 'text',
                required: true,
                span: true,
                group: 'Required',
                description:
                    'A host name only, e.g. my-bucket.s3.amazonaws.com or app.example.com. S3 bucket hosts become an S3 origin, S3 website hosts an HTTP-only custom origin, anything else a custom origin.',
                validation: {
                    pattern: CLOUDFRONT_ORIGIN_DOMAIN_PATTERN,
                    minLength: 1,
                    maxLength: CLOUDFRONT_ORIGIN_DOMAIN_MAX_LENGTH,
                    message: 'Use a host name without scheme, port or path.',
                },
            },
            {
                name: 'comment',
                label: 'Comment',
                type: 'text',
                required: false,
                validation: {maxLength: CLOUDFRONT_COMMENT_MAX_LENGTH},
            },
            {
                name: 'enabled',
                label: 'Enabled',
                type: 'select',
                required: false,
                defaultValue: 'false',
                description:
                    'CloudFront refuses to delete an enabled distribution, so it is created disabled unless you choose otherwise.',
                options: [
                    {label: 'Disabled', value: 'false'},
                    {label: 'Enabled', value: 'true'},
                ],
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List distributions', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'create',
                    label: 'Create distribution',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
            ],
            // A distribution holds one fixed collection, its invalidations.
            collectionActions: [
                {
                    name: 'list',
                    label: 'List distribution collections',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
            ],
            itemActions: [
                {name: 'list', label: 'List invalidations', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'put',
                    label: 'Create invalidation',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
            ],
        },
        filters: cdnFilters,
        columns: distributionColumns,
    }
}
