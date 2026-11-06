import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const ociWorkRequestsColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Operation'},
    {name: 'workRequestService', label: 'Service', path: 'metadata.service'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'percentComplete', label: 'Progress (%)', path: 'metadata.percentComplete'},
    {name: 'createdAt', label: 'Accepted', format: 'datetime'},
    {name: 'id', label: 'Work request', format: 'code'},
]

const ociWorkRequestsFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

const ociWorkRequestsResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List work requests', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect work request', enabled: true, status: 'available', runtimeRequired: true},
]

export function ociWorkRequestsSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'workrequests',
        displayName: 'OCI Work Requests',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {
            resourceActions: ociWorkRequestsResourceActions,
        },
        filters: ociWorkRequestsFilters,
        columns: ociWorkRequestsColumns,
        notice: 'Read only. Work requests are created by the operations of the other OCI services.',
    }
}
