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
