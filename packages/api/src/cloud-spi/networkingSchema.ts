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

export const AZURE_VNET_LOCATIONS = ['eastus', 'eastus2', 'westus', 'westus2', 'westeurope', 'northeurope'] as const

/**
 * IPv4 CIDR with real bounds, e.g. 10.0.0.0/16.
 *
 * Octets are limited to 0-255 and the prefix length to 0-32. A looser
 * digits-and-slashes pattern accepts `999.999.999.999/99`, which then fails at ARM
 * with an opaque runtime error instead of a clear ValidationError.
 */
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)'
export const CIDR_PATTERN = `^(${OCTET}\\.){3}${OCTET}/(3[0-2]|[12]?\\d)$`

/**
 * Azure virtual network names: 2-64 characters, starting with a letter or digit
 * and ending with a letter, digit or underscore.
 *
 * The provider's rule, not the runtime's — floci-az accepts names real Azure
 * rejects, so a one-character name or a trailing hyphen would only fail on the
 * ARM PUT.
 */
export const AZURE_VNET_NAME_PATTERN = '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}[a-zA-Z0-9_]$'

/**
 * Azure offers real create and delete, unlike AWS in this category.
 *
 * A VNet needs only a name, a location and an address prefix, which a flat form
 * expresses fine — there are no dependent selectors of the kind that pushed VPC
 * creation into the AWS Networking panel. Verified against the runtime: create
 * returns Succeeded and delete removes the VNet.
 */
export function azureNetworkingSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'networking',
        displayName: 'Azure Virtual Networks',
        fields: [
            {
                name: 'name',
                label: 'VNet Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: AZURE_VNET_NAME_PATTERN,
                    minLength: 2,
                    maxLength: 64,
                    message:
                        '2-64 characters, starting with a letter or digit and ending with a letter, digit or underscore.',
                },
            },
            {
                name: 'resourceGroup',
                label: 'Resource Group',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'Must already exist.',
            },
            {
                name: 'addressPrefix',
                label: 'Address Space (CIDR)',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'e.g. 10.0.0.0/16',
                validation: {pattern: CIDR_PATTERN, message: 'Use an IPv4 CIDR such as 10.0.0.0/16.'},
            },
            {
                name: 'location',
                label: 'Location',
                type: 'select',
                required: false,
                group: 'Optional',
                description: 'Defaults to eastus.',
                options: AZURE_VNET_LOCATIONS.map((value) => ({label: value, value})),
            },
            {
                name: 'subnetName',
                label: 'First Subnet Name',
                type: 'text',
                required: false,
                group: 'First subnet — optional',
                description: 'Give both subnet fields or neither.',
            },
            {
                name: 'subnetPrefix',
                label: 'First Subnet CIDR',
                type: 'text',
                required: false,
                group: 'First subnet — optional',
                description: 'Must sit inside the address space, e.g. 10.0.1.0/24',
                validation: {pattern: CIDR_PATTERN, message: 'Use an IPv4 CIDR such as 10.0.1.0/24.'},
            },
        ],
        actions: ['list', 'inspect', 'create', 'delete'],
        filters: networkingFilters,
        columns: [
            {name: 'name', label: 'Name'},
            {name: 'version', label: 'Address Space', path: 'metadata.cidrBlock', format: 'code'},
            {name: 'status', label: 'State', format: 'badge'},
            {name: 'region', label: 'Location'},
            {name: 'subnetCount', label: 'Subnets', path: 'metadata.subnetCount'},
        ],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'VNets', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create VNet', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete VNet', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}

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

export const GCP_NETWORK_KINDS = ['network', 'subnetwork', 'firewall'] as const
export type GcpNetworkKind = (typeof GCP_NETWORK_KINDS)[number]

/** Compute Engine resource names: RFC1035, 1-63 characters, lower case. */
export const GCP_RESOURCE_NAME_PATTERN = '^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$'

const IS_SUBNETWORK = {field: 'kind', equals: 'subnetwork'}
const IS_FIREWALL = {field: 'kind', equals: 'firewall'}

const gcpNetworkingFilters: FieldSchema[] = [
    ...networkingFilters,
    {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: false,
        options: GCP_NETWORK_KINDS.map((value) => ({label: value, value})),
    },
]

/**
 * One category, three Compute Engine resource kinds: VPC networks, regional
 * subnetworks and firewall rules. The form switches fields on `kind`; the
 * runtime stores and validates the rules but forwards no traffic.
 */
export function gcpNetworkingSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'networking',
        displayName: 'VPC Networks',
        fields: [
            {
                name: 'kind',
                label: 'Resource',
                type: 'select',
                required: true,
                group: 'Required',
                defaultValue: 'network',
                options: [
                    {label: 'VPC network', value: 'network'},
                    {label: 'Subnetwork', value: 'subnetwork'},
                    {label: 'Firewall rule', value: 'firewall'},
                ],
            },
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: GCP_RESOURCE_NAME_PATTERN,
                    maxLength: 63,
                    message: 'Lower case letters, digits and hyphens, starting with a letter, up to 63 characters.',
                },
            },
            {
                name: 'subnetNetwork',
                label: 'Network',
                type: 'text',
                required: false,
                requiredWhen: IS_SUBNETWORK,
                visibleWhen: IS_SUBNETWORK,
                group: 'Required',
                description: 'Name of an existing custom-mode VPC network.',
            },
            {
                name: 'region',
                label: 'Region',
                type: 'text',
                required: false,
                visibleWhen: IS_SUBNETWORK,
                group: 'Optional',
                defaultValue: 'us-central1',
            },
            {
                name: 'ipCidrRange',
                label: 'IP range (CIDR)',
                type: 'text',
                required: false,
                requiredWhen: IS_SUBNETWORK,
                visibleWhen: IS_SUBNETWORK,
                group: 'Required',
                description: 'e.g. 10.0.0.0/24. Ranges in a network cannot overlap.',
                validation: {pattern: CIDR_PATTERN, message: 'Use an IPv4 CIDR such as 10.0.0.0/24.'},
            },
            {
                name: 'firewallNetwork',
                label: 'Network',
                type: 'text',
                required: false,
                requiredWhen: IS_FIREWALL,
                visibleWhen: IS_FIREWALL,
                group: 'Required',
                description: 'Name of an existing VPC network. Rules are stored and validated; no traffic is forwarded.',
            },
            {
                name: 'direction',
                label: 'Direction',
                type: 'select',
                required: false,
                visibleWhen: IS_FIREWALL,
                group: 'Optional',
                defaultValue: 'INGRESS',
                options: [
                    {label: 'Ingress', value: 'INGRESS'},
                    {label: 'Egress', value: 'EGRESS'},
                ],
            },
            {
                name: 'ranges',
                label: 'IP ranges',
                type: 'text',
                required: false,
                requiredWhen: IS_FIREWALL,
                visibleWhen: IS_FIREWALL,
                group: 'Required',
                description: 'Comma separated CIDRs: sources for ingress, destinations for egress.',
            },
            {
                name: 'protocol',
                label: 'Protocol',
                type: 'select',
                required: false,
                visibleWhen: IS_FIREWALL,
                group: 'Optional',
                defaultValue: 'tcp',
                options: ['tcp', 'udp', 'icmp', 'all'].map((value) => ({label: value, value})),
            },
            {
                name: 'ports',
                label: 'Ports',
                type: 'text',
                required: false,
                visibleWhen: IS_FIREWALL,
                group: 'Optional',
                description: 'Comma separated ports or ranges, e.g. 22,80-90. Leave empty for all ports.',
            },
            {
                name: 'priority',
                label: 'Priority',
                type: 'text',
                required: false,
                visibleWhen: IS_FIREWALL,
                group: 'Optional',
                defaultValue: '1000',
                description: '0-65535, lower wins.',
                validation: {pattern: '^\\d{1,5}$', message: 'A whole number from 0 to 65535.'},
            },
        ],
        actions: ['list', 'inspect', 'create', 'delete'],
        filters: gcpNetworkingFilters,
        columns: [
            {name: 'name', label: 'Name'},
            {name: 'type', label: 'Kind', format: 'badge'},
            {name: 'network', label: 'Network', path: 'metadata.network'},
            {name: 'version', label: 'IP range', path: 'metadata.ipCidrRange', format: 'code'},
            {name: 'region', label: 'Region'},
        ],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'Networks', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}
