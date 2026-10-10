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
/** IAM's own limits: a user or role name is at most 64 characters, a policy name 128. */
export const IAM_NAME_MAX_LENGTH: Record<IamKind, number> = {users: 64, roles: 64, policies: 128}
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
                description: 'Up to 64 characters for users and roles, 128 for policies.',
                validation: {
                    pattern: IAM_NAME_PATTERN,
                    minLength: 1,
                    maxLength: IAM_NAME_MAX_LENGTH.policies,
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

/**
 * OCI Identity holds four kinds of resource, all scoped here to the tenancy
 * (root compartment): its child compartments, users, groups and policies.
 */
export const OCI_IDENTITY_KINDS = ['compartments', 'users', 'groups', 'policies'] as const
export type OciIdentityKind = (typeof OCI_IDENTITY_KINDS)[number]

export const OCI_IDENTITY_KIND_SINGULAR = {
    compartments: 'compartment',
    users: 'user',
    groups: 'group',
    policies: 'policy',
} as const

/** User names may be email-shaped; the other kinds may not contain `@` or `+`. */
export const OCI_IDENTITY_NAME_PATTERN = '^[A-Za-z0-9._+@-]+$'
export const OCI_IDENTITY_NAME_MAX_LENGTH = 100
export const OCI_IDENTITY_NAME_MESSAGE =
    'Up to 100 letters, digits, periods, dashes and underscores. User names may also contain + and @.'
export const OCI_IDENTITY_DESCRIPTION_MAX_LENGTH = 400

const ociIdentityColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Kind', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'description', label: 'Description', path: 'metadata.description', emptyText: '-'},
    {name: 'ocid', label: 'OCID', path: 'metadata.ocid', format: 'code'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

/** `kind` is API-only today, for the same reason as the AWS IAM facet above. */
const ociIdentityFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: false,
        description: 'Leave unset to list compartments, users, groups and policies together.',
        options: OCI_IDENTITY_KINDS.map((value) => ({label: value, value})),
    },
]

const ociIdentityResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List identity resources', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
]

export function ociIdentitySchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'identity',
        displayName: 'OCI Identity',
        fields: [
            {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                group: 'Required',
                options: OCI_IDENTITY_KINDS.map((value) => ({label: value, value})),
            },
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'Unique in the tenancy. Users, groups and policies cannot be renamed later.',
                validation: {
                    pattern: OCI_IDENTITY_NAME_PATTERN,
                    minLength: 1,
                    maxLength: OCI_IDENTITY_NAME_MAX_LENGTH,
                    message: OCI_IDENTITY_NAME_MESSAGE,
                },
            },
            {
                name: 'description',
                label: 'Description',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'OCI requires a description for every identity resource.',
                validation: {minLength: 1, maxLength: OCI_IDENTITY_DESCRIPTION_MAX_LENGTH},
            },
            {
                name: 'email',
                label: 'Email',
                type: 'text',
                required: false,
                visibleWhen: {field: 'kind', equals: 'users'},
                group: 'Users only',
                description: 'Optional contact email for the user.',
            },
            {
                name: 'statements',
                label: 'Policy Statements',
                type: 'textarea',
                required: false,
                requiredWhen: {field: 'kind', equals: 'policies'},
                visibleWhen: {field: 'kind', equals: 'policies'},
                span: true,
                group: 'Policies only',
                description: 'One statement per line, for example: Allow group Developers to manage buckets in tenancy',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions: ociIdentityResourceActions},
        filters: ociIdentityFilters,
        columns: ociIdentityColumns,
    }
}
