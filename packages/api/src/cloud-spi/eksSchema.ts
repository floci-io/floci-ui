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

/** OKE reports a lifecycle state, a Kubernetes API endpoint and the VCN it runs in. */
const okeColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'State', format: 'badge'},
    {name: 'version', label: 'Version'},
    {name: 'endpoint', label: 'Endpoint', path: 'metadata.endpoint', format: 'code'},
    {name: 'vcnId', label: 'VCN', path: 'metadata.vcnId', format: 'code'},
    {name: 'createdAt', label: 'Created At', format: 'datetime'},
]

/**
 * The newest version in Floci-OCI's `GET /20180222/clusterOptions/all`. The
 * schema is static, so the options cannot populate a select; the adapter
 * validates the submitted version against the live options instead.
 */
export const OKE_DEFAULT_KUBERNETES_VERSION = 'v1.30.1'

const okeKubernetesVersionField: FieldSchema = {
    name: 'kubernetesVersion',
    label: 'Kubernetes Version',
    type: 'text',
    required: true,
    defaultValue: OKE_DEFAULT_KUBERNETES_VERSION,
    description: 'Must be one of the versions the runtime lists in its cluster options, e.g. v1.30.1.',
    validation: {pattern: '^v\\d+\\.\\d+\\.\\d+$', message: 'Use a version like v1.30.1.'},
}

export function ociOkeSchema(): ServiceSchema {
    return {
        cloud: 'oci',
        service: 'k8s',
        displayName: 'OCI Container Engine (OKE)',
        fields: [
            {
                name: 'clusterName',
                label: 'Cluster Name',
                type: 'text',
                required: true,
                validation: {maxLength: 255},
            },
            okeKubernetesVersionField,
            {
                name: 'vcnId',
                label: 'VCN OCID',
                type: 'text',
                required: true,
                span: true,
                description: 'OKE requires the OCID of the VCN the cluster runs in. Floci-OCI has no networking service and does not check that the VCN exists, so locally any ocid1.vcn... value is accepted.',
                validation: {pattern: '^ocid1\\.vcn\\.', message: 'Use a VCN OCID starting with ocid1.vcn.'},
            },
        ],
        actions: ['list', 'create', 'update', 'inspect', 'delete'],
        filters: eksFilters,
        columns: okeColumns,
        updateFields: [
            {name: 'name', label: 'Cluster Name', type: 'text', required: false, validation: {maxLength: 255}},
            {
                name: 'kubernetesVersion',
                label: 'Kubernetes Version',
                type: 'text',
                required: false,
                valuePath: 'version',
                description: 'Upgrade target; must be one of the versions the runtime lists in its cluster options.',
                validation: okeKubernetesVersionField.validation,
            },
        ],
        capabilities: {
            resourceActions: [
                {name: 'list', label: 'List clusters', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create', label: 'Create cluster', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'update', label: 'Update cluster', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete', label: 'Delete cluster', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect cluster', enabled: true, status: 'available', runtimeRequired: false},
            ],
            kubernetesActions: [
                {name: 'listNodegroups', label: 'List node pools', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'createNodegroup', label: 'Create node pool', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'deleteNodegroup', label: 'Delete node pool', enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}

export function k8sSchemaFor(cloud: CloudProvider): ServiceSchema | null {
    if (cloud === 'aws') return awsEksSchema()
    if (cloud === 'azure') return azureAksSchema()
    if (cloud === 'gcp') return gcpGkeSchema()
    if (cloud === 'oci') return ociOkeSchema()
    return null
}
