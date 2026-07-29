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
