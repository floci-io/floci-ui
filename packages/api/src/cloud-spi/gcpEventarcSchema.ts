import type {CapabilitySchema, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

export const GCP_EVENTARC_TRIGGER_ID_PATTERN = '^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
export const GCP_EVENTARC_TRIGGER_ID_MESSAGE =
    'Use 1 to 63 lowercase letters, digits and hyphens, starting with a letter and ending with a letter or digit.'

/** The event types the local runtime delivers: Pub/Sub messages and Cloud Storage object events. */
export const GCP_EVENTARC_EVENT_TYPES = [
    {label: 'Pub/Sub message published', value: 'google.cloud.pubsub.topic.v1.messagePublished'},
    {label: 'Storage object finalized', value: 'google.cloud.storage.object.v1.finalized'},
    {label: 'Storage object deleted', value: 'google.cloud.storage.object.v1.deleted'},
    {label: 'Storage object archived', value: 'google.cloud.storage.object.v1.archived'},
    {label: 'Storage object metadata updated', value: 'google.cloud.storage.object.v1.metadataUpdated'},
] as const

export const GCP_EVENTARC_DESTINATION_TYPES = ['cloudRun', 'httpEndpoint'] as const

const eventarcColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Trigger'},
    {name: 'eventType', label: 'Event Type', path: 'metadata.eventType', format: 'badge', emptyText: '-'},
    {name: 'filters', label: 'Filters', path: 'metadata.filterSummary', format: 'list', emptyText: '-'},
    {name: 'destination', label: 'Destination', path: 'metadata.destination', format: 'code', emptyText: '-'},
    {name: 'region', label: 'Location'},
    {name: 'createdAt', label: 'Created', format: 'relative'},
]

const eventarcFilters: FieldSchema[] = [{name: 'search', label: 'Search', type: 'text', required: false}]

const eventarcResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List triggers', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create trigger', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete trigger', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect trigger', enabled: true, status: 'available', runtimeRequired: true},
]

/**
 * Triggers can be created and deleted. Cloud Run and HTTP endpoint destinations
 * are offered because they are the two the local runtime delivers to; GKE,
 * Workflows and Cloud Functions destinations are accepted and then dropped, so
 * the console does not offer them. Update is not offered either.
 */
export function gcpEventarcSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'events',
        displayName: 'Eventarc',
        fields: [
            {
                name: 'name',
                label: 'Trigger Name',
                type: 'text',
                required: true,
                group: 'Required',
                validation: {
                    pattern: GCP_EVENTARC_TRIGGER_ID_PATTERN,
                    minLength: 1,
                    maxLength: 63,
                    message: GCP_EVENTARC_TRIGGER_ID_MESSAGE,
                },
            },
            {
                name: 'eventType',
                label: 'Event Type',
                type: 'select',
                required: true,
                group: 'Required',
                defaultValue: GCP_EVENTARC_EVENT_TYPES[0].value,
                options: [...GCP_EVENTARC_EVENT_TYPES],
            },
            {
                name: 'filters',
                label: 'Extra Filters',
                type: 'textarea',
                required: false,
                group: 'Filters',
                description:
                    'One attribute=value per line, for example bucket=my-bucket or topic=my-topic. A Pub/Sub trigger fires only when a topic filter matches.',
            },
            {
                name: 'destinationType',
                label: 'Destination',
                type: 'select',
                required: true,
                group: 'Destination',
                defaultValue: 'cloudRun',
                options: [
                    {label: 'Cloud Run service', value: 'cloudRun'},
                    {label: 'HTTP endpoint', value: 'httpEndpoint'},
                ],
            },
            {
                name: 'cloudRunService',
                label: 'Cloud Run Service',
                type: 'text',
                required: false,
                requiredWhen: {field: 'destinationType', equals: 'cloudRun'},
                visibleWhen: {field: 'destinationType', equals: 'cloudRun'},
                group: 'Destination',
            },
            {
                name: 'cloudRunRegion',
                label: 'Cloud Run Region',
                type: 'text',
                required: false,
                visibleWhen: {field: 'destinationType', equals: 'cloudRun'},
                group: 'Destination',
                description: 'Defaults to the console location.',
            },
            {
                name: 'cloudRunPath',
                label: 'Path',
                type: 'text',
                required: false,
                visibleWhen: {field: 'destinationType', equals: 'cloudRun'},
                group: 'Destination',
                description: 'Relative path on the service that receives the events.',
            },
            {
                name: 'httpUri',
                label: 'HTTP Endpoint URI',
                type: 'text',
                required: false,
                requiredWhen: {field: 'destinationType', equals: 'httpEndpoint'},
                visibleWhen: {field: 'destinationType', equals: 'httpEndpoint'},
                group: 'Destination',
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {resourceActions: eventarcResourceActions},
        filters: eventarcFilters,
        columns: eventarcColumns,
    }
}
