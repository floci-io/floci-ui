import type {CapabilitySchema, CloudProvider, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const emailColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Subject'},
    {name: 'source', label: 'From', path: 'metadata.source', format: 'code'},
    {name: 'to', label: 'To', path: 'metadata.toAddresses', format: 'list'},
    {name: 'messageType', label: 'Type', path: 'metadata.messageType', format: 'badge'},
    {name: 'createdAt', label: 'Captured At', format: 'datetime'},
]

const emailFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const emailResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List captured emails', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect email content', enabled: true, status: 'available', runtimeRequired: false},
]

export function awsSesEmailSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'email',
        displayName: 'SES Mailbox',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {resourceActions: emailResourceActions},
        filters: emailFilters,
        columns: emailColumns,
    }
}

export function emailSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsSesEmailSchema()
    return null
}
