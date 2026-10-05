import type {CapabilitySchema, CloudProvider, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const serverlessColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Function Name'},
    {name: 'type', label: 'Type'},
    {name: 'cloud', label: 'Cloud'},
    {name: 'region', label: 'Region'},
    {name: 'runtime', label: 'Runtime', path: 'metadata.runtime'},
    {name: 'status', label: 'Status'},
    {name: 'updatedAt', label: 'Last Updated', path: 'metadata.lastModified', format: 'datetime'},
]

/** Invoke is the verb that distinguishes serverless from every other category. */
function serverlessResourceActions(
    invoke: CapabilitySchema<ResourceActionName>,
): CapabilitySchema<ResourceActionName>[] {
    return [
        {name: 'list', label: 'List functions', enabled: true, status: 'available', runtimeRequired: true},
        {name: 'create', label: 'Create function', enabled: true, status: 'available', runtimeRequired: true},
        {name: 'delete', label: 'Delete function', enabled: true, status: 'available', runtimeRequired: true},
        {name: 'inspect', label: 'Inspect function', enabled: true, status: 'available', runtimeRequired: false},
        invoke,
    ]
}

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
        capabilities: {
            resourceActions: serverlessResourceActions({
                name: 'invoke', label: 'Invoke function', enabled: true, status: 'available', runtimeRequired: true,
            }),
        },
    }
}

/**
 * Floci-AZ keeps Function Apps and the functions deployed into them as two
 * levels (`/admin/apps` and `/admin/apps/{app}/functions`). They share one
 * table, as OCI does, because a function cannot exist without its app.
 */
const azureServerlessColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'kind', label: 'Kind', path: 'metadata.kind', format: 'badge'},
    {name: 'status', label: 'Status', format: 'badge', emptyText: '—'},
    {name: 'app', label: 'Function App', path: 'metadata.appName', emptyText: '—'},
    {name: 'runtime', label: 'Runtime', path: 'metadata.runtime', emptyText: '—'},
    {name: 'handler', label: 'Handler', path: 'metadata.handler', format: 'code', emptyText: '—'},
    {name: 'createdAt', label: 'Created', format: 'datetime'},
]

const azureServerlessFields: FieldSchema[] = [
    {
        name: 'resourceType',
        label: 'Resource Type',
        type: 'select',
        required: true,
        defaultValue: 'function',
        description: 'A function is deployed into a Function App. Create the app first if none exists.',
        options: [
            {label: 'Function', value: 'function'},
            {label: 'Function App', value: 'app'},
        ],
    },
    {
        name: 'appName',
        label: 'Function App Name',
        type: 'text',
        required: true,
        description: 'The app to create, or the existing app the function is deployed into.',
        validation: {
            pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,58}[A-Za-z0-9])?$',
            message: 'Use 1-60 letters, numbers, or hyphens; do not start or end with a hyphen.',
        },
    },
    {
        name: 'runtime',
        label: 'Runtime',
        type: 'select',
        required: false,
        requiredWhen: {field: 'resourceType', equals: 'app'},
        visibleWhen: {field: 'resourceType', equals: 'app'},
        group: 'Function App',
        defaultValue: 'node',
        options: [
            {label: 'Node.js', value: 'node'},
            {label: 'Python', value: 'python'},
            {label: '.NET (isolated)', value: 'dotnet'},
            {label: 'Java', value: 'java'},
        ],
    },
    {
        name: 'linuxFxVersion',
        label: 'Linux Stack Version',
        type: 'text',
        required: false,
        visibleWhen: {field: 'resourceType', equals: 'app'},
        group: 'Function App',
        description: 'Optional, for example Python|3.12. The stack must match the runtime.',
    },
    {
        name: 'functionName',
        label: 'Function Name',
        type: 'text',
        required: false,
        requiredWhen: {field: 'resourceType', equals: 'function'},
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        description: 'Unique within the Function App.',
        validation: {
            pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,126}$',
            message: 'Use up to 127 letters, numbers, hyphens, or underscores, starting with a letter or number.',
        },
    },
    {
        name: 'handler',
        label: 'Handler',
        type: 'text',
        required: false,
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        description: 'Entry point inside the package. Floci-AZ defaults to index.handler.',
    },
    {
        name: 'timeoutSeconds',
        label: 'Timeout (seconds)',
        type: 'text',
        required: false,
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        description: 'Optional. Floci-AZ defaults to 230.',
    },
    {
        name: 'zipBase64',
        label: 'Code Package (base64 zip)',
        type: 'textarea',
        required: false,
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        span: true,
        description: 'Optional. Without code the function stays AwaitingDeploy and cannot be invoked.',
    },
]

export function azureServerlessSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'serverless',
        displayName: 'Azure Functions',
        fields: azureServerlessFields,
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: [
            {name: 'search', label: 'Search', type: 'text', required: false},
            {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: false,
                description: 'Leave unset to list Function Apps and functions together.',
                options: [
                    {label: 'Function App', value: 'app'},
                    {label: 'Function', value: 'function'},
                ],
            },
        ],
        columns: azureServerlessColumns,
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List Function Apps and functions', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create Function App or function', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete Function App or function', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect Function App or function', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'invoke', label: 'Invoke function', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}

export function gcpServerlessSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'serverless',
        displayName: 'Cloud Functions',
        fields: [
            {
                name: 'functionName',
                label: 'Function Name',
                type: 'text',
                required: true,
                description: 'Unique Cloud Function name within the project and region.',
            },
            {
                name: 'runtime',
                label: 'Runtime',
                type: 'select',
                required: true,
                options: [
                    {label: 'Node.js 20', value: 'nodejs20'},
                    {label: 'Node.js 18', value: 'nodejs18'},
                    {label: 'Python 3.12', value: 'python312'},
                    {label: 'Python 3.11', value: 'python311'},
                    {label: 'Go 1.22', value: 'go122'},
                ],
            },
            {
                name: 'entryPoint',
                label: 'Entry Point',
                type: 'text',
                required: true,
                description: 'Name of the exported function to execute. Example: helloWorld',
            },
            {
                name: 'code',
                label: 'Inline Code',
                type: 'text',
                required: false,
                description: 'Optional inline starter code. Source archive upload will come in a later PR.',
                span: true,
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: serverlessFilters,
        columns: serverlessColumns,
        capabilities: {
            resourceActions: serverlessResourceActions({
                name: 'invoke',
                label: 'Invoke function',
                enabled: false,
                status: 'coming_soon',
                reason: 'The Cloud Functions :call endpoint is not wired through the adapter yet.',
                runtimeRequired: true,
            }),
        },
    }
}

/**
 * OCI Functions lists applications and functions as one table because a
 * function cannot exist without an application: the console must be able to
 * create the application first, and the Kind column tells the two apart.
 */
const ociServerlessColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'kind', label: 'Kind', path: 'metadata.kind', format: 'badge'},
    {name: 'status', label: 'State', format: 'badge', emptyText: '—'},
    {name: 'application', label: 'Application', path: 'metadata.applicationName', emptyText: '—'},
    {name: 'image', label: 'Image', path: 'metadata.image', format: 'code', emptyText: '—'},
    {name: 'memory', label: 'Memory (MB)', path: 'metadata.memoryInMBs', emptyText: '—'},
    {name: 'updatedAt', label: 'Last Updated', path: 'metadata.lastModified', format: 'datetime'},
]

const ociServerlessFields: FieldSchema[] = [
    {
        name: 'resourceType',
        label: 'Resource Type',
        type: 'select',
        required: true,
        defaultValue: 'function',
        description: 'A function belongs to an application. Create the application first if none exists.',
        options: [
            {label: 'Function', value: 'function'},
            {label: 'Application', value: 'application'},
        ],
    },
    {
        name: 'displayName',
        label: 'Display Name',
        type: 'text',
        required: true,
        description: 'Unique within the application (functions) or the compartment (applications).',
    },
    {
        name: 'applicationId',
        label: 'Application OCID',
        type: 'text',
        required: false,
        requiredWhen: {field: 'resourceType', equals: 'function'},
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        description: 'OCID of an existing application (ocid1.fnapp...). Copy it from an Application row.',
    },
    {
        name: 'image',
        label: 'Image',
        type: 'text',
        required: false,
        requiredWhen: {field: 'resourceType', equals: 'function'},
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        description: 'Fn FDK container image, for example iad.ocir.io/tenancy/repo/hello:0.0.1.',
    },
    {
        name: 'memoryInMBs',
        label: 'Memory (MB)',
        type: 'text',
        required: false,
        requiredWhen: {field: 'resourceType', equals: 'function'},
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        defaultValue: '128',
        description: 'Maximum memory for the function, in MB.',
    },
    {
        name: 'timeoutInSeconds',
        label: 'Timeout (seconds)',
        type: 'text',
        required: false,
        visibleWhen: {field: 'resourceType', equals: 'function'},
        group: 'Function',
        description: 'Optional, up to 300. OCI defaults to 30.',
    },
    {
        name: 'subnetIds',
        label: 'Subnet OCIDs',
        type: 'text',
        required: false,
        requiredWhen: {field: 'resourceType', equals: 'application'},
        visibleWhen: {field: 'resourceType', equals: 'application'},
        group: 'Application',
        description: 'Comma-separated subnet OCIDs (ocid1.subnet...) the application runs in.',
    },
    {
        name: 'shape',
        label: 'Shape',
        type: 'select',
        required: false,
        visibleWhen: {field: 'resourceType', equals: 'application'},
        group: 'Application',
        description: 'Optional processor architecture. OCI defaults to GENERIC_X86.',
        options: [
            {label: 'GENERIC_X86', value: 'GENERIC_X86'},
            {label: 'GENERIC_ARM', value: 'GENERIC_ARM'},
            {label: 'GENERIC_X86_ARM', value: 'GENERIC_X86_ARM'},
        ],
    },
]

export function ociServerlessSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'serverless',
        displayName: 'OCI Functions',
        fields: ociServerlessFields,
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: [
            {name: 'search', label: 'Search', type: 'text', required: false},
            {
                name: 'kind',
                label: 'Kind',
                type: 'select',
                required: false,
                description: 'Leave unset to list applications and functions together.',
                options: [
                    {label: 'Application', value: 'application'},
                    {label: 'Function', value: 'function'},
                ],
            },
        ],
        columns: ociServerlessColumns,
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List applications and functions', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create application or function', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete application or function', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect application or function', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'invoke', label: 'Invoke function', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}

export function serverlessSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsServerlessSchema()
    if (cloud === 'azure') return azureServerlessSchema()
    if (cloud === 'gcp') return gcpServerlessSchema()
    if (cloud === 'oci') return ociServerlessSchema()
    return null
}
