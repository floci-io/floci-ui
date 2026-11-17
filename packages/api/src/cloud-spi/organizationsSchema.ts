import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/**
 * OCI Organizations holds five kinds of read-only record, all scoped to the
 * tenancy: the organization itself, its member tenancies, the links between the
 * parent and each child, and the invitations the tenancy sent or received.
 */
export const OCI_ORGANIZATIONS_KINDS = [
    'organizations',
    'tenancies',
    'links',
    'senderInvitations',
    'recipientInvitations',
] as const
export type OciOrganizationsKind = (typeof OCI_ORGANIZATIONS_KINDS)[number]

/** The singular name a row shows in its Kind column. */
export const OCI_ORGANIZATIONS_KIND_LABEL = {
    organizations: 'Organization',
    tenancies: 'Tenancy',
    links: 'Link',
    senderInvitations: 'Sent invitation',
    recipientInvitations: 'Received invitation',
} as const

const OCI_ORGANIZATIONS_FILTER_LABEL: Record<OciOrganizationsKind, string> = {
    organizations: 'Organizations',
    tenancies: 'Tenancies',
    links: 'Links',
    senderInvitations: 'Sent invitations',
    recipientInvitations: 'Received invitations',
}

const ociOrganizationsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Kind', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'role', label: 'Role', path: 'metadata.role', emptyText: '-'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
    {name: 'ocid', label: 'OCID', path: 'metadata.ocid', format: 'code'},
]

const ociOrganizationsFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: false,
        description: 'Leave unset to list organizations, tenancies, links and invitations together.',
        options: OCI_ORGANIZATIONS_KINDS.map((value) => ({label: OCI_ORGANIZATIONS_FILTER_LABEL[value], value})),
    },
]

const ociOrganizationsResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List organization records', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect organization record', enabled: true, status: 'available', runtimeRequired: true},
]

export function ociOrganizationsSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'organizations',
        displayName: 'OCI Organizations',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {resourceActions: ociOrganizationsResourceActions},
        filters: ociOrganizationsFilters,
        columns: ociOrganizationsColumns,
        notice: 'Read only. Child tenancies and invitations are created through the Organizations API.',
    }
}
