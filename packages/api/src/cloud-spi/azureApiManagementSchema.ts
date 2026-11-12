import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const apiManagementColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Service'},
    {name: 'sku', label: 'SKU', path: 'metadata.sku', format: 'badge', emptyText: '-'},
    {name: 'gatewayUrl', label: 'Gateway URL', path: 'metadata.gatewayUrl', format: 'code', emptyText: '-'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'publisherName', label: 'Publisher', path: 'metadata.publisherName', emptyText: '-'},
    {name: 'region', label: 'Location'},
    {name: 'resourceGroup', label: 'Resource Group', path: 'metadata.resourceGroup'},
]

const apiManagementFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

/**
 * Read only: a service is created with a publisher and an SKU, and its APIs,
 * products and policies are authored as ARM documents, none of which the
 * console writes. Subscription keys and secret named values are never read.
 */
export function azureApiManagementSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'apigateway',
        displayName: 'Azure API Management',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List services', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect service', enabled: true, status: 'available', runtimeRequired: true},
            ],
            // A service holds fixed collections: APIs, products, backends, named values and subscriptions.
            collectionActions: [
                {name: 'list', label: 'List service collections', enabled: true, status: 'available', runtimeRequired: true},
            ],
            itemActions: [
                {
                    name: 'list',
                    label: 'List APIs, products, backends, named values and subscriptions',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
            ],
        },
        filters: apiManagementFilters,
        columns: apiManagementColumns,
    }
}
