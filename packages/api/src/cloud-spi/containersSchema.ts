import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const containerColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Service'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'image', label: 'Image', path: 'metadata.image', format: 'code', emptyText: '—'},
    {name: 'uri', label: 'URL', path: 'metadata.uri', emptyText: '—'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

const containerFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/** Cloud Run service names: lowercase letters, digits and hyphens, max 49 chars. */
export const CLOUD_RUN_NAME_PATTERN = '^[a-z]([-a-z0-9]*[a-z0-9])?$'
export const CLOUD_RUN_NAME_MAX_LENGTH = 49

export function gcpContainersSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'containers',
        displayName: 'Cloud Run',
        fields: [
            {
                name: 'name',
                label: 'Service Name',
                type: 'text',
                required: true,
                validation: {
                    pattern: CLOUD_RUN_NAME_PATTERN,
                    minLength: 1,
                    maxLength: CLOUD_RUN_NAME_MAX_LENGTH,
                    message: 'Start with a letter; lowercase letters, digits and hyphens only.',
                },
            },
            {
                name: 'image',
                label: 'Container Image',
                type: 'text',
                required: true,
                span: true,
                // The most common cause of a service that never becomes ready.
                description:
                    'The container must listen on the port given by the PORT environment variable (8080 by default). An image that listens elsewhere will report a failed condition.',
            },
            {
                name: 'port',
                label: 'Container Port',
                type: 'text',
                required: false,
                description: 'Overrides the port passed to the container. Defaults to 8080.',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List services', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Deploy service', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete service', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect service', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: containerFilters,
        columns: containerColumns,
    }
}

/**
 * ECS cluster names: up to 255 letters, digits, hyphens and underscores. The
 * hyphen is escaped because browsers compile a `pattern` attribute with the `v`
 * flag, which rejects an unescaped `-` in a character class.
 */
export const ECS_CLUSTER_NAME_PATTERN = '^[A-Za-z0-9_\\-]+$'
export const ECS_CLUSTER_NAME_MAX_LENGTH = 255

const ecsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Cluster'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'activeServicesCount', label: 'Services', path: 'metadata.activeServicesCount'},
    {name: 'runningTasksCount', label: 'Running Tasks', path: 'metadata.runningTasksCount'},
    {name: 'pendingTasksCount', label: 'Pending Tasks', path: 'metadata.pendingTasksCount'},
]

export function awsContainersSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'containers',
        displayName: 'ECS Clusters',
        fields: [
            {
                name: 'clusterName',
                label: 'Cluster Name',
                type: 'text',
                required: true,
                description: 'Up to 255 letters, numbers, hyphens and underscores. Creating an existing name returns that cluster.',
                validation: {
                    pattern: ECS_CLUSTER_NAME_PATTERN,
                    minLength: 1,
                    maxLength: ECS_CLUSTER_NAME_MAX_LENGTH,
                    message: 'Use letters, numbers, hyphens and underscores only.',
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List clusters', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create cluster', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete cluster', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect cluster', enabled: true, status: 'available', runtimeRequired: true},
            ],
            // A cluster holds two fixed collections, services and tasks, both read-only here.
            collectionActions: [
                {name: 'list', label: 'List cluster collections', enabled: true, status: 'available', runtimeRequired: true},
            ],
            itemActions: [
                {name: 'list', label: 'List services and tasks', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: containerFilters,
        columns: ecsColumns,
    }
}

/** Container app and managed environment names: lowercase letters, digits and hyphens, 2 to 32 chars. */
export const CONTAINER_APP_NAME_PATTERN = '^[a-z][-a-z0-9]{0,30}[a-z0-9]$'
export const CONTAINER_APP_NAME_MESSAGE =
    'Start with a letter; 2 to 32 lowercase letters, digits and hyphens, ending with a letter or digit.'
export const CONTAINER_APP_LOCATIONS = ['eastus', 'eastus2', 'westus', 'westus2', 'westeurope', 'northeurope'] as const
export const CONTAINER_APP_INGRESS_MODES = ['none', 'external', 'internal'] as const

const azureContainerColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Kind', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'image', label: 'Image', path: 'metadata.image', format: 'code', emptyText: '—'},
    {name: 'environment', label: 'Environment', path: 'metadata.environmentName', emptyText: '—'},
    {name: 'region', label: 'Location'},
    {name: 'resourceGroup', label: 'Resource Group', path: 'metadata.resourceGroup'},
]

const IS_APP = {field: 'resourceType', equals: 'containerApp'}

export function azureContainersSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'containers',
        displayName: 'Container Apps',
        fields: [
            {
                name: 'resourceType',
                label: 'Resource',
                type: 'select',
                required: true,
                group: 'Required',
                defaultValue: 'containerApp',
                description: 'An app runs inside a managed environment, so create the environment first.',
                options: [
                    {label: 'Container app', value: 'containerApp'},
                    {label: 'Managed environment', value: 'managedEnvironment'},
                ],
            },
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: CONTAINER_APP_NAME_PATTERN,
                    minLength: 2,
                    maxLength: 32,
                    message: CONTAINER_APP_NAME_MESSAGE,
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
                name: 'environment',
                label: 'Managed Environment',
                type: 'text',
                required: false,
                requiredWhen: IS_APP,
                visibleWhen: IS_APP,
                group: 'Required',
                description: 'Name of an existing managed environment in the same resource group.',
            },
            {
                name: 'image',
                label: 'Container Image',
                type: 'text',
                required: false,
                requiredWhen: IS_APP,
                visibleWhen: IS_APP,
                span: true,
                group: 'Required',
                description: 'e.g. nginx:alpine',
            },
            {
                name: 'ingress',
                label: 'Ingress',
                type: 'select',
                required: false,
                visibleWhen: IS_APP,
                group: 'Optional',
                defaultValue: 'none',
                description: 'External is reachable from outside the environment, internal only from inside it.',
                options: CONTAINER_APP_INGRESS_MODES.map((value) => ({label: value, value})),
            },
            {
                name: 'targetPort',
                label: 'Ingress Target Port',
                type: 'text',
                required: false,
                visibleWhen: IS_APP,
                group: 'Optional',
                description: 'The port the container listens on. Defaults to 80; ignored when ingress is none.',
                validation: {pattern: '^[0-9]{1,5}$', message: 'Enter a port between 1 and 65535.'},
            },
            {
                name: 'location',
                label: 'Location',
                type: 'select',
                required: false,
                group: 'Optional',
                description: 'Defaults to eastus.',
                options: CONTAINER_APP_LOCATIONS.map((value) => ({label: value, value})),
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List apps and environments', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: containerFilters,
        columns: azureContainerColumns,
    }
}

export function containersSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsContainersSchema()
    if (cloud === 'azure') return azureContainersSchema()
    return cloud === 'gcp' ? gcpContainersSchema() : null
}
