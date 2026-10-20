import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

/**
 * ECR repository names: lowercase path segments of letters and digits joined by
 * single dots, underscores or hyphens, 2 to 256 characters. The hyphen is
 * escaped because browsers compile a `pattern` attribute with the `v` flag,
 * which rejects an unescaped `-` in a character class.
 */
export const ECR_REPOSITORY_NAME_PATTERN = '^(?:[a-z0-9]+(?:[._\\-][a-z0-9]+)*/)*[a-z0-9]+(?:[._\\-][a-z0-9]+)*$'
export const ECR_REPOSITORY_NAME_MIN_LENGTH = 2
export const ECR_REPOSITORY_NAME_MAX_LENGTH = 256
export const ECR_TAG_MUTABILITY_VALUES = ['MUTABLE', 'IMMUTABLE'] as const

const ecrColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Repository'},
    {name: 'repositoryUri', label: 'URI', path: 'metadata.repositoryUri', format: 'code', emptyText: '-'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
    {name: 'imageTagMutability', label: 'Tag Mutability', path: 'metadata.imageTagMutability', format: 'badge'},
    {name: 'scanOnPush', label: 'Scan on Push', path: 'metadata.scanOnPush', format: 'boolean', emptyText: '-'},
    {name: 'encryptionType', label: 'Encryption', path: 'metadata.encryptionType', emptyText: '-'},
]

const registryFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

export function awsRegistrySchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'registry',
        displayName: 'ECR Repositories',
        fields: [
            {
                name: 'repositoryName',
                label: 'Repository Name',
                type: 'text',
                required: true,
                span: true,
                description: 'Lowercase letters, digits, and . _ - separators; use / for namespaces, e.g. team/app.',
                validation: {
                    pattern: ECR_REPOSITORY_NAME_PATTERN,
                    minLength: ECR_REPOSITORY_NAME_MIN_LENGTH,
                    maxLength: ECR_REPOSITORY_NAME_MAX_LENGTH,
                    message: 'Use lowercase letters and digits separated by single dots, underscores, hyphens or slashes.',
                },
            },
            {
                name: 'imageTagMutability',
                label: 'Tag Mutability',
                type: 'select',
                required: false,
                defaultValue: 'MUTABLE',
                description: 'An immutable repository refuses a push that would move an existing tag.',
                options: ECR_TAG_MUTABILITY_VALUES.map((value) => ({label: value, value})),
            },
            {
                name: 'scanOnPush',
                label: 'Scan on Push',
                type: 'select',
                required: false,
                defaultValue: 'false',
                description: 'Stored on the repository. The local runtime does not scan images.',
                options: [
                    {label: 'Disabled', value: 'false'},
                    {label: 'Enabled', value: 'true'},
                ],
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List repositories', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create repository', enabled: true, status: 'available', runtimeRequired: true},
                {
                    name: 'delete',
                    label: 'Delete repository and its images',
                    enabled: true,
                    status: 'available',
                    runtimeRequired: true,
                },
                {name: 'inspect', label: 'Inspect repository', enabled: true, status: 'available', runtimeRequired: true},
            ],
            // A repository is itself the collection of its images, so the store is flat.
            itemActions: [
                {name: 'list', label: 'List images', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete image', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: registryFilters,
        columns: ecrColumns,
    }
}
