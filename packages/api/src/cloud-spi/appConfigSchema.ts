import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const applicationColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'description', label: 'Description', path: 'metadata.description', emptyText: '—'},
    {name: 'id', label: 'Application Id'},
]

const applicationFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsAppConfigSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'configuration',
        displayName: 'AppConfig',
        fields: [
            {
                name: 'name',
                label: 'Application Name',
                type: 'text',
                required: true,
                validation: {
                    pattern: '^[A-Za-z0-9._\\-]+$',
                    maxLength: 255,
                    message: 'Use letters, numbers, periods, hyphens, or underscores.',
                },
            },
            {name: 'description', label: 'Description', type: 'textarea', required: false},
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        filters: applicationFilters,
        columns: applicationColumns,
    }
}

export const APP_CONFIG_FEATURE_FLAG_PREFIX = '.appconfig.featureflag/'
export const APP_CONFIG_FEATURE_FLAG_CONTENT_TYPE = 'application/vnd.microsoft.appconfig.ff+json;charset=utf-8'

const azureAppConfigFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: false,
        options: [
            {label: 'All', value: ''},
            {label: 'Key-values', value: 'key-value'},
            {label: 'Feature flags', value: 'feature-flag'},
        ],
    },
]

const azureAppConfigColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Key'},
    {name: 'label', label: 'Label', path: 'metadata.label', emptyText: '(no label)'},
    {name: 'kind', label: 'Kind', path: 'metadata.kind', format: 'badge'},
    {name: 'enabled', label: 'Enabled', path: 'metadata.enabled', format: 'boolean', emptyText: '—'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'lastModified', label: 'Last Modified', path: 'metadata.lastModified', format: 'datetime'},
]

const enabledOptions = [
    {label: 'Enabled', value: 'true'},
    {label: 'Disabled', value: 'false'},
]

export function azureAppConfigSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'configuration',
        displayName: 'App Configuration',
        fields: [
            {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: true,
                defaultValue: 'key-value',
                options: [
                    {label: 'Key-value', value: 'key-value'},
                    {label: 'Feature flag', value: 'feature-flag'},
                ],
            },
            {
                name: 'key',
                label: 'Key',
                type: 'text',
                required: true,
                description: 'For a feature flag this is the flag id.',
                validation: {maxLength: 10000},
            },
            {name: 'label', label: 'Label', type: 'text', required: false, description: 'Optional. Leave empty for no label.'},
            {
                name: 'enabled',
                label: 'Initial state',
                type: 'select',
                required: false,
                defaultValue: 'false',
                options: enabledOptions,
                visibleWhen: {field: 'kind', equals: 'feature-flag'},
            },
            {
                name: 'value',
                label: 'Value',
                type: 'textarea',
                required: false,
                span: true,
                visibleWhen: {field: 'kind', equals: 'key-value'},
            },
            {
                name: 'contentType',
                label: 'Content Type',
                type: 'text',
                required: false,
                description: 'Optional, for example application/json.',
                visibleWhen: {field: 'kind', equals: 'key-value'},
            },
        ],
        updateFields: [
            {name: 'value', label: 'Value', type: 'textarea', required: false, span: true, valuePath: 'metadata.value'},
            {name: 'contentType', label: 'Content Type', type: 'text', required: false, valuePath: 'metadata.contentType'},
            {
                name: 'enabled',
                label: 'Feature flag state',
                type: 'select',
                required: false,
                options: enabledOptions,
                valuePath: 'metadata.enabledValue',
                description: 'Only applies to feature flags.',
            },
        ],
        actions: ['list', 'create', 'update', 'delete', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List key-values', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create key-value', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'update', label: 'Update key-value', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete key-value', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect with revisions', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: azureAppConfigFilters,
        columns: azureAppConfigColumns,
    }
}
