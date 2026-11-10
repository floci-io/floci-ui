import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

/** Azure Cache for Redis names: 1 to 63 letters, digits and hyphens, bounded by an alphanumeric, with no double hyphen. */
export const REDIS_CACHE_NAME_PATTERN = '^(?!.*--)[a-zA-Z0-9](?:[a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?$'
export const REDIS_CACHE_NAME_MESSAGE =
    'Use 1 to 63 letters, digits and hyphens, starting and ending with a letter or digit, with no consecutive hyphens.'
export const REDIS_SKUS = ['Basic', 'Standard', 'Premium'] as const
export const REDIS_LOCATIONS = ['eastus', 'eastus2', 'westus', 'westus2', 'westeurope', 'northeurope'] as const

/** The access keys are deliberately absent: the console never lists them. */
const azureCacheColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Cache'},
    {name: 'hostName', label: 'Host Name', path: 'metadata.hostName', format: 'code', emptyText: '-'},
    {name: 'sku', label: 'SKU', path: 'metadata.sku', format: 'badge', emptyText: '-'},
    {name: 'port', label: 'Port', path: 'metadata.port', emptyText: '-'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'redisVersion', label: 'Redis Version', path: 'metadata.redisVersion', emptyText: '-'},
    {name: 'region', label: 'Location'},
    {name: 'resourceGroup', label: 'Resource Group', path: 'metadata.resourceGroup'},
]

const cacheFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

export function azureCacheSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'cache',
        displayName: 'Azure Cache for Redis',
        fields: [
            {
                name: 'name',
                label: 'Cache Name',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'Globally unique. The name is checked for availability before the cache is created.',
                validation: {pattern: REDIS_CACHE_NAME_PATTERN, minLength: 1, maxLength: 63, message: REDIS_CACHE_NAME_MESSAGE},
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
                name: 'sku',
                label: 'SKU',
                type: 'select',
                required: false,
                group: 'Optional',
                defaultValue: 'Basic',
                description: 'The local runtime runs one node whichever tier is chosen.',
                options: REDIS_SKUS.map((value) => ({label: value, value})),
            },
            {
                name: 'location',
                label: 'Location',
                type: 'select',
                required: false,
                group: 'Optional',
                description: 'Defaults to eastus.',
                options: REDIS_LOCATIONS.map((value) => ({label: value, value})),
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List caches', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create cache', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete cache', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect cache', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: cacheFilters,
        columns: azureCacheColumns,
    }
}
