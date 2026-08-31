import type {CapabilitySchema, ResourceActionName, ServiceSchema} from './types'

export const IAM_USER_NAME_PATTERN = '^[A-Za-z0-9_+=,.@-]{1,64}$'
export const IAM_USER_NAME_MESSAGE = 'Use a valid IAM user name: 1-64 letters, numbers, and +=,.@_- characters.'
export const IAM_PATH_PATTERN = '^/(?:[!-~]+/)?$'
export const IAM_PATH_MAX_LENGTH = 512
export const IAM_PATH_MESSAGE = 'Use a valid IAM path: begin and end with / and use only printable ASCII characters.'

const resourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List users', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create user', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete user', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect user', enabled: true, status: 'available', runtimeRequired: false},
]

export function awsIamSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'identity',
        displayName: 'AWS IAM users',
        fields: [
            {
                name: 'userName',
                label: 'User Name',
                type: 'text',
                required: true,
                description: '1-64 letters, numbers, and +=,.@_- characters.',
                validation: {
                    pattern: IAM_USER_NAME_PATTERN,
                    minLength: 1,
                    maxLength: 64,
                    message: IAM_USER_NAME_MESSAGE,
                },
            },
            {
                name: 'path',
                label: 'Path',
                type: 'text',
                required: false,
                description: 'Optional IAM path, beginning and ending with /. Defaults to /.',
                validation: {
                    pattern: IAM_PATH_PATTERN,
                    maxLength: IAM_PATH_MAX_LENGTH,
                    message: IAM_PATH_MESSAGE,
                },
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions},
        filters: [{name: 'search', label: 'Search', type: 'text', required: false}],
        columns: [
            {name: 'name', label: 'User Name'},
            {name: 'type', label: 'Type'},
            {name: 'createdAt', label: 'Created At'},
        ],
    }
}
