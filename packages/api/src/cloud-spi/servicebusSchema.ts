import type {CapabilitySchema, ResourceActionName, ServiceSchema} from './types'

const resourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List namespaces', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create namespace', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete namespace', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect namespace', enabled: true, status: 'available', runtimeRequired: false},
]

export function azureServiceBusSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'messaging',
        displayName: 'Service Bus',
        fields: [
            {
                name: 'namespaceName',
                label: 'Namespace Name',
                type: 'text',
                required: true,
                description: '6-50 characters. Letters, numbers, and hyphens; starts with a letter, ends with a letter or number. Cannot end with -sb or -mgmt.',
                validation: {
                    pattern: '^(?!.*-(?:[sS][bB]|[mM][gG][mM][tT])$)[A-Za-z][A-Za-z0-9-]{4,48}[A-Za-z0-9]$',
                    minLength: 6,
                    maxLength: 50,
                    message: 'Use a valid Service Bus namespace: 6-50 letters, numbers, or hyphens; start with a letter, end with a letter or number, and do not end with -sb or -mgmt.',
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions},
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: [
            {name: 'name', label: 'Namespace'},
            {name: 'status', label: 'Status'},
            {name: 'type', label: 'Type'},
        ],
    }
}
