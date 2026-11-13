import type {ServiceSchema} from './types'

export const CLOUDWATCH_STATISTICS = ['Average', 'Sum', 'Minimum', 'Maximum', 'SampleCount'] as const

export const CLOUDWATCH_COMPARISON_OPERATORS = [
    'GreaterThanOrEqualToThreshold',
    'GreaterThanThreshold',
    'LessThanThreshold',
    'LessThanOrEqualToThreshold',
] as const

export function awsCloudWatchSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'cloudwatch',
        displayName: 'CloudWatch Alarms',
        fields: [
            {
                name: 'name',
                label: 'Alarm name',
                type: 'text',
                required: true,
                validation: {
                    minLength: 1,
                    maxLength: 255,
                    message: 'Use 1 to 255 characters.',
                },
            },
            {
                name: 'namespace',
                label: 'Namespace',
                type: 'text',
                required: true,
                description: 'The namespace of the metric to watch, for example AWS/SQS.',
                validation: {minLength: 1, maxLength: 255, message: 'Use 1 to 255 characters.'},
            },
            {name: 'metricName', label: 'Metric name', type: 'text', required: true, validation: {minLength: 1, maxLength: 255, message: 'Use 1 to 255 characters.'}},
            {
                name: 'statistic',
                label: 'Statistic',
                type: 'select',
                required: true,
                defaultValue: 'Average',
                options: CLOUDWATCH_STATISTICS.map((value) => ({label: value, value})),
            },
            {
                name: 'comparisonOperator',
                label: 'Comparison',
                type: 'select',
                required: true,
                defaultValue: 'GreaterThanThreshold',
                options: CLOUDWATCH_COMPARISON_OPERATORS.map((value) => ({label: value, value})),
            },
            {
                name: 'threshold',
                label: 'Threshold',
                type: 'text',
                required: true,
                validation: {pattern: '^-?\\d+(\\.\\d+)?$', message: 'Use a number.'},
            },
            {
                name: 'period',
                label: 'Period (seconds)',
                type: 'text',
                required: true,
                defaultValue: '60',
                description: 'A multiple of 60 seconds.',
                validation: {pattern: '^[1-9]\\d*$', message: 'Use a whole number of seconds.'},
            },
            {
                name: 'evaluationPeriods',
                label: 'Evaluation periods',
                type: 'text',
                required: true,
                defaultValue: '1',
                validation: {pattern: '^[1-9]\\d*$', message: 'Use a whole number.'},
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: [{
            name: 'search',
            label: 'Name starts with',
            type: 'text',
            required: false,
            description: 'CloudWatch filters alarms by name prefix, not by substring.',
        }],
        columns: [
            {name: 'name', label: 'Alarm'},
            {name: 'state', label: 'State', path: 'metadata.state', format: 'badge'},
            {name: 'metric', label: 'Metric', path: 'metadata.metric'},
            {name: 'condition', label: 'Condition', path: 'metadata.condition'},
            {name: 'region', label: 'Region'},
        ],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List alarms', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create alarm', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect alarm', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete alarm', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}

/** Only these two prefixes are user-created metrics, which is all the runtime lets be deleted. */
export const GCP_MONITORING_TYPE_PATTERN = '^(custom|external)\\.googleapis\\.com/[A-Za-z0-9_./-]+$'
export const GCP_MONITORING_TYPE_MESSAGE =
    'Use custom.googleapis.com/ or external.googleapis.com/ followed by letters, digits, underscore, dot, slash or dash.'
export const GCP_MONITORING_METRIC_KINDS = ['GAUGE', 'DELTA', 'CUMULATIVE'] as const
export const GCP_MONITORING_VALUE_TYPES = ['DOUBLE', 'INT64', 'BOOL', 'STRING', 'DISTRIBUTION'] as const

/**
 * Metric descriptors of Cloud Monitoring. Alarm policies belong to another API
 * and are not offered; writing time series is not either, so the console reads
 * the recent points of a metric and manages custom descriptors.
 */
export function gcpMonitoringSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'cloudwatch',
        displayName: 'Cloud Monitoring',
        fields: [
            {
                name: 'name',
                label: 'Metric type',
                type: 'text',
                required: true,
                description: 'For example custom.googleapis.com/orders/processed.',
                validation: {pattern: GCP_MONITORING_TYPE_PATTERN, minLength: 1, maxLength: 200, message: GCP_MONITORING_TYPE_MESSAGE},
            },
            {
                name: 'metricKind',
                label: 'Metric kind',
                type: 'select',
                required: true,
                defaultValue: 'GAUGE',
                options: GCP_MONITORING_METRIC_KINDS.map((value) => ({label: value, value})),
            },
            {
                name: 'valueType',
                label: 'Value type',
                type: 'select',
                required: true,
                defaultValue: 'DOUBLE',
                description: 'BOOL and STRING are only valid with the GAUGE kind.',
                options: GCP_MONITORING_VALUE_TYPES.map((value) => ({label: value, value})),
            },
            {name: 'unit', label: 'Unit', type: 'text', required: false, description: 'For example 1, s, By or ms.'},
            {name: 'displayName', label: 'Display name', type: 'text', required: false},
            {name: 'description', label: 'Description', type: 'textarea', required: false},
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        filters: [{name: 'search', label: 'Metric type', type: 'text', required: false}],
        columns: [
            {name: 'name', label: 'Metric type'},
            {name: 'metricKind', label: 'Kind', path: 'metadata.metricKind', format: 'badge', emptyText: '-'},
            {name: 'valueType', label: 'Value type', path: 'metadata.valueType', format: 'badge', emptyText: '-'},
            {name: 'unit', label: 'Unit', path: 'metadata.unit', emptyText: '-'},
            {name: 'displayName', label: 'Display name', path: 'metadata.displayName', emptyText: '-'},
        ],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List metric descriptors', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create metric descriptor', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect metric descriptor', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete metric descriptor', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}
