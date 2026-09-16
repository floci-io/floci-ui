import type {CapabilitySchema, ResourceActionName, ServiceSchema} from './types'

const resourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List APIs', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create API', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete API', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect API', enabled: true, status: 'available', runtimeRequired: false},
]

export function awsApiGatewaySchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'apigateway',
        displayName: 'AWS API Gateway',
        fields: [
            {
                name: 'name',
                label: 'API Name',
                type: 'text',
                required: true,
                description: '1-1024 characters.',
                validation: {
                    minLength: 1,
                    maxLength: 1024,
                    message: 'API name is required and must be 1-1024 characters.',
                },
            },
            {
                name: 'description',
                label: 'Description',
                type: 'text',
                required: false,
                description: 'Optional description for the REST API.',
                validation: {
                    maxLength: 1024,
                    message: 'Description must be 1024 characters or fewer.',
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions},
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: [
            {name: 'name', label: 'API Name'},
            {name: 'type', label: 'Type'},
            {name: 'createdAt', label: 'Created At'},
        ],
    }
}
