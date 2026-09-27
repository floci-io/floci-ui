import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/**
 * IAM holds three different kinds of resource in one category, so the table needs
 * a facet rather than only free-text search: "show me the roles" is not something
 * a search box can express.
 */
export const IAM_KINDS = ['users', 'roles', 'policies'] as const
export type IamKind = (typeof IAM_KINDS)[number]

/** Singular form used for a resource id prefix and the `type` field. */
export const IAM_KIND_SINGULAR = {users: 'user', roles: 'role', policies: 'policy'} as const

export const IAM_NAME_PATTERN = '^[\\w+=,.@-]+$'
export const IAM_NAME_MESSAGE = 'Letters, digits and + = , . @ _ - only.'
export const IAM_PATH_PATTERN = '^/(?:[!-~]+/)?$'
export const IAM_PATH_MAX_LENGTH = 512
export const IAM_PATH_MESSAGE = 'Use a valid IAM path: begin and end with / and use only printable ASCII characters.'

const iamColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Kind', format: 'badge'},
    {name: 'path', label: 'Path', path: 'metadata.path', emptyText: '/'},
    {name: 'arn', label: 'ARN', path: 'metadata.arn', format: 'code'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

/**
 * `kind` is **API-only today**, and that is a stated choice rather than a gap.
 *
 * `DynamicResourceView` sends only `search`, and nothing in the frontend renders
 * `schema.filters` as controls, so this facet is reachable by calling the API
 * directly and not from the console. Rendering non-search filters is a shared
 * piece of frontend work, every category with a facet needs it, so it belongs
 * in its own PR rather than half-built here, and it is deliberately not blocking
 * the adapter.
 */
const iamFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: false,
        description: 'Leave unset to list users, roles and policies together.',
        options: IAM_KINDS.map((value) => ({label: value, value})),
    },
]

const resourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List identities', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: false},
]

export function awsIamSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'identity',
        displayName: 'AWS IAM',
        fields: [
            {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                group: 'Required',
                options: IAM_KINDS.map((value) => ({label: value, value})),
            },
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: IAM_NAME_PATTERN,
                    minLength: 1,
                    maxLength: 128,
                    message: IAM_NAME_MESSAGE,
                },
            },
            {
                name: 'path',
                label: 'Path',
                type: 'text',
                required: false,
                description: 'Optional IAM path, beginning and ending with /. Defaults to /.',
                validation: {
                    pattern: IAM_PATH_PATTERN,
                    maxLength: IAM_PATH_MAX_LENGTH,
                    message: IAM_PATH_MESSAGE,
                },
            },
            {
                name: 'assumeRolePolicyDocument',
                label: 'Trust Policy (JSON)',
                type: 'text',
                required: false,
                span: true,
                group: 'Roles only',
                description: 'Required when kind is roles. The trust policy that says who may assume the role.',
            },
            {
                name: 'policyDocument',
                label: 'Policy Document (JSON)',
                type: 'text',
                required: false,
                span: true,
                group: 'Policies only',
                description: 'Required when kind is policies.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions},
        filters: iamFilters,
        columns: iamColumns,
    }
}
