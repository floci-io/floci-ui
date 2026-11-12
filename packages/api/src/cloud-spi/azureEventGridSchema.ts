import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

export const AZURE_EVENT_GRID_TOPIC_NAME_PATTERN = '^[A-Za-z0-9-]{3,50}$'
export const AZURE_EVENT_GRID_TOPIC_NAME_MESSAGE = '3 to 50 letters, digits and hyphens.'
export const AZURE_EVENT_GRID_LOCATIONS = ['eastus', 'eastus2', 'westus', 'westus2', 'westeurope', 'northeurope'] as const
export const AZURE_EVENT_GRID_INPUT_SCHEMAS = ['EventGridSchema', 'CloudEventSchemaV1_0'] as const

const eventGridColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Topic'},
    {name: 'endpoint', label: 'Endpoint', path: 'metadata.endpoint', format: 'code', emptyText: '-'},
    {name: 'inputSchema', label: 'Input Schema', path: 'metadata.inputSchema', format: 'badge', emptyText: '-'},
    {name: 'status', label: 'Provisioning State', format: 'badge'},
    {name: 'region', label: 'Location'},
    {name: 'resourceGroup', label: 'Resource Group', path: 'metadata.resourceGroup'},
]

const eventGridFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

const eventGridResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List topics', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create topic', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete topic', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect topic', enabled: true, status: 'available', runtimeRequired: true},
]

/**
 * Custom topics can be created and deleted, which also removes their event
 * subscriptions. Subscriptions are read only: a webhook destination is validated
 * by the runtime with a handshake the console cannot answer. Topic access keys
 * are never read.
 */
export function azureEventGridSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'events',
        displayName: 'Azure Event Grid',
        fields: [
            {
                name: 'name',
                label: 'Topic Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: AZURE_EVENT_GRID_TOPIC_NAME_PATTERN,
                    minLength: 3,
                    maxLength: 50,
                    message: AZURE_EVENT_GRID_TOPIC_NAME_MESSAGE,
                },
            },
            {
                name: 'resourceGroup',
                label: 'Resource Group',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'The resource group must already exist.',
            },
            {
                name: 'location',
                label: 'Location',
                type: 'select',
                required: false,
                group: 'Optional',
                description: "Defaults to the console's configured location, eastus unless it sets another.",
                options: AZURE_EVENT_GRID_LOCATIONS.map((value) => ({label: value, value})),
            },
            {
                name: 'inputSchema',
                label: 'Event Schema',
                type: 'select',
                required: false,
                group: 'Optional',
                description: 'The schema events published to the topic use. Defaults to EventGridSchema.',
                options: AZURE_EVENT_GRID_INPUT_SCHEMAS.map((value) => ({label: value, value})),
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: eventGridResourceActions,
            // A topic holds one fixed collection: its event subscriptions.
            collectionActions: [
                {name: 'list', label: 'List topic collections', enabled: true, status: 'available', runtimeRequired: true},
            ],
            itemActions: [
                {name: 'list', label: 'List event subscriptions', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: eventGridFilters,
        columns: eventGridColumns,
    }
}
