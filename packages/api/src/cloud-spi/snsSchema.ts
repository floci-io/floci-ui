import type {ServiceSchema} from './types'

export function awsSnsSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'sns',
        displayName: 'Amazon SNS',
        fields: [
            {
                name: 'name',
                label: 'Topic Name',
                type: 'text',
                required: true,
                description: 'Up to 256 letters, numbers, hyphens, or underscores. FIFO topics end in .fifo.',
                validation: {
                    pattern: '^(?:[A-Za-z0-9_-]{1,256}|[A-Za-z0-9_-]{1,251}\\.fifo)$',
                    maxLength: 256,
                    message: 'Use a valid SNS topic name, with .fifo only as the FIFO suffix.',
                },
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: [
            {name: 'name', label: 'Name'},
            {name: 'type', label: 'Type'},
            {name: 'arn', label: 'ARN', path: 'metadata.arn', format: 'code'},
            {name: 'region', label: 'Region'},
        ],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List topics', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create topic', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect topic', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete topic', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}
