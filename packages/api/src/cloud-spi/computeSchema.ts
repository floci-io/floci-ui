import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const computeColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Type'},
    {name: 'status', label: 'State'},
    {name: 'region', label: 'AZ'},
    {name: 'createdAt', label: 'Created'},
]

const computeFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const computeFields: FieldSchema[] = [
    // ── Required ──────────────────────────────────────────────────────
    {
        name: 'name',
        label: 'Instance Name',
        type: 'text',
        required: true,
        span: true,
        group: 'Required',
        validation: {minLength: 1, maxLength: 255, message: 'Provide a name for the instance.'},
    },
    {
        name: 'imageId',
        label: 'AMI ID',
        type: 'text',
        required: true,
        description: 'e.g. ami-0abcdef1234567890',
        validation: {
            pattern: '^ami-[0-9a-f]{8,17}$',
            message: 'Must be a valid AMI ID (ami-xxxxxxxxx).',
        },
    },
    {
        name: 'instanceType',
        label: 'Instance Type',
        type: 'select',
        required: true,
        options: [
            {label: 't2.micro',   value: 't2.micro'},
            {label: 't2.small',   value: 't2.small'},
            {label: 't2.medium',  value: 't2.medium'},
            {label: 't3.micro',   value: 't3.micro'},
            {label: 't3.small',   value: 't3.small'},
            {label: 't3.medium',  value: 't3.medium'},
            {label: 't3.large',   value: 't3.large'},
            {label: 't3.xlarge',  value: 't3.xlarge'},
            {label: 'm5.large',   value: 'm5.large'},
            {label: 'm5.xlarge',  value: 'm5.xlarge'},
            {label: 'c5.large',   value: 'c5.large'},
            {label: 'c5.xlarge',  value: 'c5.xlarge'},
        ],
    },
    // ── Networking (optional) ─────────────────────────────────────────
    {
        name: 'keyName',
        label: 'Key Pair',
        type: 'text',
        required: false,
        group: 'Networking — optional',
        description: 'Name of an existing EC2 key pair.',
    },
    {
        name: 'subnetId',
        label: 'Subnet ID',
        type: 'text',
        required: false,
        description: 'e.g. subnet-0abcdef1234567890',
    },
    {
        name: 'securityGroupIds',
        label: 'Security Group IDs',
        type: 'text',
        required: false,
        span: true,
        description: 'One or more SG IDs separated by commas — e.g. sg-111, sg-222',
    },
]

/**
 * Azure VM images, keyed by the label offered in the create form.
 *
 * The ARM API wants a four-part `imageReference`; asking a user for four fields to
 * launch a VM is worse than a short list of known-good images. Shared with the
 * adapter so the form and the request cannot drift.
 */
export const AZURE_VM_IMAGES = {
    'Ubuntu 20.04 LTS': {publisher: 'Canonical', offer: 'UbuntuServer', sku: '20.04-LTS', version: 'latest'},
    'Ubuntu 22.04 LTS': {
        publisher: 'Canonical',
        offer: '0001-com-ubuntu-server-jammy',
        sku: '22_04-lts',
        version: 'latest',
    },
    'Debian 11': {publisher: 'Debian', offer: 'debian-11', sku: '11', version: 'latest'},
    'Windows Server 2022': {
        publisher: 'MicrosoftWindowsServer',
        offer: 'WindowsServer',
        sku: '2022-datacenter',
        version: 'latest',
    },
} as const

export const AZURE_VM_SIZES = [
    'Standard_B1s',
    'Standard_B2s',
    'Standard_D2s_v3',
    'Standard_D4s_v3',
    'Standard_F2s_v2',
] as const

export const AZURE_LOCATIONS = ['eastus', 'eastus2', 'westus', 'westus2', 'westeurope', 'northeurope'] as const

/** Azure VM names: 1-64 chars, letters, digits, hyphens, underscores and periods. */
export const AZURE_VM_NAME_PATTERN = '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'

export function azureComputeSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'compute',
        displayName: 'Azure Virtual Machines',
        fields: [
            {
                name: 'name',
                label: 'VM Name',
                type: 'text',
                required: true,
                span: true,
                group: 'Required',
                validation: {
                    pattern: AZURE_VM_NAME_PATTERN,
                    minLength: 1,
                    maxLength: 64,
                    message: 'Start with a letter or digit; letters, digits, hyphens, underscores and periods only.',
                },
            },
            {
                name: 'resourceGroup',
                label: 'Resource Group',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'Must already exist. Every Azure resource lives in a resource group.',
            },
            {
                name: 'vmSize',
                label: 'VM Size',
                type: 'select',
                required: true,
                options: AZURE_VM_SIZES.map((value) => ({label: value, value})),
            },
            {
                name: 'image',
                label: 'Image',
                type: 'select',
                required: true,
                options: Object.keys(AZURE_VM_IMAGES).map((value) => ({label: value, value})),
            },
            {
                name: 'location',
                label: 'Location',
                type: 'select',
                required: false,
                group: 'Optional',
                description: "The VM's own location. Defaults to eastus.",
                options: AZURE_LOCATIONS.map((value) => ({label: value, value})),
            },
            {
                name: 'adminUsername',
                label: 'Admin Username',
                type: 'text',
                required: false,
                group: 'Optional',
                description: 'Defaults to azureuser.',
            },
        ],
        actions: ['list', 'inspect', 'create', 'delete'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create VM', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete VM', enabled: true, status: 'available', runtimeRequired: true},
                // The runtime and the adapter both do these — verified against
                // floci-az, where powerOff/start/restart really change power state.
                // There is no generic actions route yet (only invoke/objects), so
                // the console cannot reach them; saying `coming_soon` with the
                // reason beats advertising a control that cannot be called.
                {
                    name: 'start',
                    label: 'Start',
                    enabled: false,
                    status: 'coming_soon',
                    reason: 'The adapter implements start, but the generic resource actions route is not wired yet.',
                    runtimeRequired: true,
                },
                {
                    name: 'stop',
                    label: 'Stop',
                    enabled: false,
                    status: 'coming_soon',
                    reason: 'The adapter implements stop, but the generic resource actions route is not wired yet.',
                    runtimeRequired: true,
                },
                {
                    name: 'reboot',
                    label: 'Restart',
                    enabled: false,
                    status: 'coming_soon',
                    reason: 'The adapter implements reboot, but the generic resource actions route is not wired yet.',
                    runtimeRequired: true,
                },
            ],
        },
        filters: computeFilters,
        columns: [
            {name: 'name', label: 'Name'},
            {name: 'status', label: 'Power State'},
            {name: 'instanceClass', label: 'Size'},
            {name: 'region', label: 'Location'},
            {name: 'resourceGroup', label: 'Resource Group', path: 'metadata.resourceGroup'},
            {name: 'createdAt', label: 'Created', format: 'datetime'},
        ],
    }
}

export function awsComputeSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'compute',
        displayName: 'Compute',
        fields: computeFields,
        actions: ['list', 'inspect', 'create', 'delete'],
        filters: computeFilters,
        columns: computeColumns,
        capabilities: {
            resourceActions: [
                {name: 'list',    label: 'List',            enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect',         enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create',  label: 'Launch instance', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete',  label: 'Terminate',       enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}
