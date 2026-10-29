import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

/** Valkey and Redis run as replication groups; Memcached has no replication, so it is a cache cluster. */
export const ELASTICACHE_ENGINES = ['valkey', 'redis', 'memcached'] as const
export type ElastiCacheEngine = (typeof ELASTICACHE_ENGINES)[number]

export const ELASTICACHE_DEFAULT_NODE_TYPE = 'cache.t3.micro'
/** A replication group id is at most 40 characters; a cache cluster id allows 50, so 40 serves both. */
export const ELASTICACHE_NAME_MAX_LENGTH = 40
export const ELASTICACHE_NAME_PATTERN = '^[A-Za-z](?:-?[A-Za-z0-9])*$'
export const ELASTICACHE_NAME_MESSAGE = 'Start with a letter; letters, digits and single hyphens only, not ending in a hyphen.'

const cacheFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const cacheColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Kind', format: 'badge'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'engine', label: 'Engine'},
    {name: 'version', label: 'Version'},
    {name: 'instanceClass', label: 'Node Type'},
    {name: 'endpoint', label: 'Endpoint', path: 'metadata.endpoint', format: 'code'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

const cacheActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List caches', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create cache', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect cache', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete cache', enabled: true, status: 'available', runtimeRequired: true},
]

/** ElastiCache replication groups and standalone cache clusters. Serverless caches are not listed. */
export function awsElastiCacheSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'cache',
        displayName: 'AWS ElastiCache',
        fields: [
            {
                name: 'name',
                label: 'Name',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'Up to 40 characters. Stored in lowercase.',
                validation: {
                    pattern: ELASTICACHE_NAME_PATTERN,
                    minLength: 1,
                    maxLength: ELASTICACHE_NAME_MAX_LENGTH,
                    message: ELASTICACHE_NAME_MESSAGE,
                },
            },
            {
                name: 'engine',
                label: 'Engine',
                type: 'select',
                required: true,
                group: 'Required',
                defaultValue: 'valkey',
                description: 'Valkey and Redis create a replication group; Memcached creates a cache cluster.',
                options: ELASTICACHE_ENGINES.map((value) => ({label: value, value})),
            },
            {
                name: 'nodeType',
                label: 'Node Type',
                type: 'text',
                required: false,
                defaultValue: ELASTICACHE_DEFAULT_NODE_TYPE,
                description: `Defaults to ${ELASTICACHE_DEFAULT_NODE_TYPE}.`,
            },
            {
                name: 'description',
                label: 'Description',
                type: 'text',
                required: false,
                description: 'Optional, for Valkey and Redis. Defaults to the name.',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {resourceActions: cacheActions},
        filters: cacheFilters,
        columns: cacheColumns,
    }
}
