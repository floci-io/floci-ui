import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const eksColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'Status'},
    {name: 'version', label: 'Version'},
    {name: 'createdAt', label: 'Created At'},
]

/** GKE reports an API endpoint and node pools, which the EKS list does not. */
const gkeColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'Status', format: 'badge'},
    {name: 'version', label: 'Version'},
    {name: 'region', label: 'Location'},
    {name: 'endpoint', label: 'Endpoint', path: 'metadata.endpoint', format: 'code'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

const eksFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

export function awsEksSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'k8s',
        displayName: 'AWS EKS',
        fields: [],
        actions: ['list', 'inspect'],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List clusters', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect cluster', enabled: true, status: 'available', runtimeRequired: false},
            ],
            kubernetesActions: [
                {name: 'listNodegroups', label: 'List nodegroups', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'createNodegroup', label: 'Create nodegroup', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'deleteNodegroup', label: 'Delete nodegroup', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'listFargateProfiles', label: 'List Fargate profiles', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'createFargateProfile', label: 'Create Fargate profile', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'deleteFargateProfile', label: 'Delete Fargate profile', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
        filters: eksFilters,
        columns: eksColumns,
    }
}

export function azureAksSchema(): ServiceSchema {
    return {
        cloud: 'azure',
        service: 'k8s',
        displayName: 'Azure AKS',
        fields: [],
        actions: ['list', 'inspect'],
        filters: eksFilters,
        columns: eksColumns,
    }
}

export function gcpGkeSchema(): ServiceSchema {
    return {
        cloud: 'gcp',
        service: 'k8s',
        displayName: 'Google GKE',
        fields: [
            {
                name: 'clusterName',
                label: 'Cluster Name',
                type: 'text',
                required: true,
                description: 'Lowercase letters, numbers, and hyphens; must start with a letter.',
            },
            {
                name: 'initialNodeCount',
                label: 'Initial Node Count',
                type: 'text',
                required: false,
                description: 'Defaults to 1. The local runtime backs the cluster with a single k3s container.',
            },
        ],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: eksFilters,
        columns: gkeColumns,
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List clusters', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create cluster', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete cluster', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect cluster', enabled: true, status: 'available', runtimeRequired: false},
            ],
        },
    }
}

export function k8sSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsEksSchema()
    if (cloud === 'azure') return azureAksSchema()
    if (cloud === 'gcp') return gcpGkeSchema()
    return null
}
