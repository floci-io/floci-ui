import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const serverlessColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Function Name'},
    {name: 'type', label: 'Type'},
    {name: 'cloud', label: 'Cloud'},
    {name: 'region', label: 'Region'},
    {name: 'runtime', label: 'Runtime'},
    {name: 'status', label: 'Status'},
    {name: 'updatedAt', label: 'Last Updated'},
]

const serverlessFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {name: 'runtime', label: 'Runtime', type: 'text', required: false},
]

export function awsServerlessSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'serverless',
        displayName: 'AWS Lambda',
        fields: [
    {
        name: 'functionName',
        label: 'Function Name',
        type: 'text',
        required: true,
        description: 'Unique Lambda function name.',
    },
    {
        name: 'runtime',
        label: 'Runtime',
        type: 'select',
        required: true,
        options: [
            {label: 'Node.js 20.x', value: 'nodejs20.x'},
            {label: 'Node.js 18.x', value: 'nodejs18.x'},
            {label: 'Python 3.12', value: 'python3.12'},
            {label: 'Python 3.11', value: 'python3.11'},
        ],
    },
    {
        name: 'handler',
        label: 'Handler',
        type: 'text',
        required: true,
        description: 'Example: index.handler',
    },
    {
        name: 'role',
        label: 'Execution Role ARN',
        type: 'text',
        required: true,
        description: 'IAM role ARN used by the Lambda function.',
    },
    {
        name: 'memorySize',
        label: 'Memory Size',
        type: 'text',
        required: false,
        description: 'Memory in MB. Default: 128.',
    },
    {
        name: 'timeout',
        label: 'Timeout',
        type: 'text',
        required: false,
        description: 'Timeout in seconds. Default: 3.',
    },
    {
        name: 'description',
        label: 'Description',
        type: 'text',
        required: false,
    },
    {
        name: 'code',
        label: 'Inline Code',
        type: 'text',
        required: false,
        description: 'Optional inline starter code. ZIP upload will come in a later PR.',
        span: true,
    },
],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: serverlessFilters,
        columns: serverlessColumns,
    }
}

export function azureServerlessSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'serverless',
        displayName: 'Azure Functions',
        fields: [
            {
                name: 'functionName',
                label: 'Function Name',
                type: 'text',
                required: true,
                description: 'Unique Azure Function name.',
            },
            {
                name: 'runtime',
                label: 'Runtime',
                type: 'select',
                required: false,
                options: [
                    {label: 'Node.js', value: 'node'},
                    {label: 'Python', value: 'python'},
                    {label: '.NET', value: 'dotnet'},
                    {label: 'Java', value: 'java'},
                ],
            },
            {
                name: 'handler',
                label: 'Handler',
                type: 'text',
                required: false,
                description: 'Optional function entry point or handler.',
            },
            {
                name: 'functionAppName',
                label: 'Function App Name',
                type: 'text',
                required: false,
                description: 'Optional parent Function App name.',
            },
            {
                name: 'location',
                label: 'Location',
                type: 'text',
                required: false,
                description: 'Azure region, for example eastus.',
            },
            {
                name: 'code',
                label: 'Inline Code',
                type: 'text',
                required: false,
                description: 'Optional starter code. Package deployment can follow in a later PR.',
                span: true,
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: serverlessFilters,
        columns: serverlessColumns,
    }
}

export function gcpServerlessSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'serverless',
        displayName: 'Cloud Functions',
        fields: [],
        actions: ['list', 'inspect'],
        filters: serverlessFilters,
        columns: serverlessColumns,
    }
}

export function serverlessSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsServerlessSchema()
    if (cloud === 'azure') return azureServerlessSchema()
    if (cloud === 'gcp') return gcpServerlessSchema()
    return null
}
