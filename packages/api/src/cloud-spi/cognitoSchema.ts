import type {CapabilitySchema, ResourceActionName, ServiceSchema} from './types'

export const COGNITO_POOL_NAME_PATTERN = '^[A-Za-z0-9_+=,.@ -]{1,128}$'
export const COGNITO_POOL_NAME_MESSAGE =
    'Use a valid user pool name: 1-128 letters, numbers, spaces, and +=,.@_- characters.'

const resourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List user pools', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create user pool', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete user pool', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect user pool', enabled: true, status: 'available', runtimeRequired: true},
]

export function awsCognitoSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'cognito',
        displayName: 'Amazon Cognito user pools',
        fields: [
            {
                name: 'poolName',
                label: 'User Pool Name',
                type: 'text',
                required: true,
                description: 'A friendly name for the Cognito user pool.',
                validation: {
                    pattern: COGNITO_POOL_NAME_PATTERN,
                    minLength: 1,
                    maxLength: 128,
                    message: COGNITO_POOL_NAME_MESSAGE,
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions},
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: [
            {name: 'name', label: 'Name'},
            {name: 'status', label: 'Status', format: 'badge'},
            {name: 'id', label: 'Pool ID', format: 'code'},
            {name: 'createdAt', label: 'Created', format: 'datetime'},
            {
                name: 'lastModifiedAt',
                label: 'Last Modified',
                path: 'metadata.lastModifiedAt',
                format: 'datetime',
            },
        ],
    }
}
