import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const azureDeploymentsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Deployment'},
    {name: 'resourceGroup', label: 'Resource Group', path: 'metadata.resourceGroup'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'mode', label: 'Mode', path: 'metadata.mode'},
    {name: 'createdAt', label: 'Timestamp', format: 'datetime'},
]

const azureDeploymentsFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

const azureDeploymentsResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List deployments', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect deployment', enabled: true, status: 'available', runtimeRequired: true},
]

export function azureDeploymentsSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'iac',
        displayName: 'ARM Deployments',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {
            resourceActions: azureDeploymentsResourceActions,
        },
        filters: azureDeploymentsFilters,
        columns: azureDeploymentsColumns,
    }
}
