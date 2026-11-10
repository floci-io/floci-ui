import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

export const CODEBUILD_KINDS = ['project', 'build'] as const
export type CodeBuildKind = (typeof CODEBUILD_KINDS)[number]

/** A project name is 2 to 255 characters, starting with a letter or digit. */
export const CODEBUILD_NAME_MIN_LENGTH = 2
export const CODEBUILD_NAME_MAX_LENGTH = 255
export const CODEBUILD_NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]*$'
export const CODEBUILD_NAME_MESSAGE = 'Start with a letter or digit; letters, digits, hyphens and underscores only.'

export const CODEBUILD_DEFAULT_IMAGE = 'public.ecr.aws/docker/library/alpine:latest'
/** The builds listed alongside the projects, most recent first. */
export const CODEBUILD_BUILD_LIMIT = 100

const codeBuildFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const codeBuildColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Kind', format: 'badge'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'duration', label: 'Duration', path: 'metadata.duration'},
    {name: 'phase', label: 'Phase', path: 'metadata.currentPhase'},
    {name: 'image', label: 'Image', path: 'metadata.image', format: 'code'},
    {name: 'createdAt', label: 'Started / Created', format: 'datetime'},
]

const codeBuildActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List projects and builds', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create project or start build', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect project or build', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete project', enabled: true, status: 'available', runtimeRequired: true},
]

/** CodeBuild projects and their builds. Report groups, source credentials and batch builds are not listed. */
export function awsCodeBuildSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'cicd',
        displayName: 'AWS CodeBuild',
        notice: `Shows every project and the ${CODEBUILD_BUILD_LIMIT} most recent builds. Builds cannot be deleted.`,
        fields: [
            {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                group: 'Required',
                defaultValue: 'project',
                description: 'Create a project, or start a build of an existing project.',
                options: CODEBUILD_KINDS.map((value) => ({label: value, value})),
            },
            {
                name: 'name',
                label: 'Project Name',
                type: 'text',
                required: true,
                group: 'Required',
                description: 'The project to create, or the project to build.',
                validation: {
                    pattern: CODEBUILD_NAME_PATTERN,
                    minLength: CODEBUILD_NAME_MIN_LENGTH,
                    maxLength: CODEBUILD_NAME_MAX_LENGTH,
                    message: CODEBUILD_NAME_MESSAGE,
                },
            },
            {
                name: 'serviceRole',
                label: 'Service Role ARN',
                type: 'text',
                required: false,
                requiredWhen: {field: 'kind', equals: 'project'},
                visibleWhen: {field: 'kind', equals: 'project'},
                group: 'Required',
                description: 'For example arn:aws:iam::000000000000:role/codebuild-role.',
            },
            {
                name: 'image',
                label: 'Build Image',
                type: 'text',
                required: false,
                visibleWhen: {field: 'kind', equals: 'project'},
                defaultValue: CODEBUILD_DEFAULT_IMAGE,
                description: 'The Docker image the build runs in. The project has no source and no artifacts.',
            },
            {
                name: 'buildspec',
                label: 'Buildspec',
                type: 'textarea',
                required: false,
                span: true,
                description: 'Optional YAML. Saved on a new project, or overrides the project buildspec for this build.',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        capabilities: {resourceActions: codeBuildActions},
        filters: codeBuildFilters,
        columns: codeBuildColumns,
    }
}
