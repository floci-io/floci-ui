import type {CapabilitySchema, ResourceActionName, ServiceSchema} from './types'

const resourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List queues', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create queue', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete queue', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect queue', enabled: true, status: 'available', runtimeRequired: true},
]

export function azureQueueSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'queue',
        displayName: 'Azure Queue Storage',
        fields: [
            {
                name: 'queueName',
                label: 'Queue Name',
                type: 'text',
                required: true,
                description: '3-63 lowercase letters, numbers, or single hyphens.',
                validation: {
                    pattern: '^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$',
                    minLength: 3,
                    maxLength: 63,
                    message: 'Use a valid Azure queue name: 3-63 lowercase letters, numbers, or single hyphens.',
                },
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {resourceActions},
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: [{name: 'name', label: 'Queue Name'}],
    }
}
