import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/** The two child collections a rule holds, in the order the console lists them. */
export const OCI_GOVERNANCE_INCLUSION_CRITERIA = 'inclusionCriteria'
export const OCI_GOVERNANCE_TENANCY_ATTACHMENTS = 'tenancyAttachments'

/** Rule types the Governance Rules API defines; only the first is enforced by Floci-OCI. */
export const OCI_GOVERNANCE_RULE_TYPES = ['ALLOWED_REGIONS', 'QUOTA', 'TAG'] as const

const ociGovernanceColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Type', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
    {name: 'ocid', label: 'OCID', path: 'metadata.ocid', format: 'code'},
]

const ociGovernanceFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const ociGovernanceResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List governance rules', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect governance rule', enabled: true, status: 'available', runtimeRequired: true},
]

export function ociGovernanceSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'governance',
        displayName: 'OCI Governance Rules',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {
            resourceActions: ociGovernanceResourceActions,
            // A rule holds two fixed collections: its inclusion criteria and its tenancy attachments.
            collectionActions: [
                {name: 'list', label: 'List rule collections', enabled: true, status: 'available', runtimeRequired: true},
            ],
            itemActions: [
                {name: 'list', label: 'List inclusion criteria and tenancy attachments', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: ociGovernanceFilters,
        columns: ociGovernanceColumns,
        notice: 'Read only. Floci-OCI enforces ALLOWED_REGIONS rules only. QUOTA and TAG rules are stored and listed but have no effect.',
    }
}
