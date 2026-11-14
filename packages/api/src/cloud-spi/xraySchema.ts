import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const xrayColumns: TableColumnSchema[] = [
    {name: 'id', label: 'Trace ID', format: 'code'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'duration', label: 'Duration', path: 'metadata.duration'},
    {name: 'services', label: 'Services', path: 'metadata.services', format: 'list'},
    {name: 'httpStatus', label: 'HTTP status', path: 'metadata.httpStatus'},
    {name: 'createdAt', label: 'Started', format: 'datetime'},
    {name: 'region', label: 'Region'},
]

/**
 * The console renders a search box and nothing else, so a window and a filter expression are not
 * declared here: an unrendered filter is a promise the page cannot keep. The list answers the last
 * hour, which the notice states, and the adapter keeps the window and expression support for when
 * the Cloud Explorer grows a filter row.
 */
const xrayFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const xrayResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List traces', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect trace', enabled: true, status: 'available', runtimeRequired: false},
]

export function awsXraySchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'xray',
        displayName: 'X-Ray',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {resourceActions: xrayResourceActions},
        filters: xrayFilters,
        columns: xrayColumns,
        notice:
            'This list shows the last hour. Traces are written by an instrumented application, an SDK or the ' +
            'X-Ray daemon, not from here, and Floci keeps the newest 10 000 per Region for 30 days.',
    }
}
