import type {CloudAvailability, CloudProvider} from './types'

/**
 * The single source of truth for which services the console knows about.
 *
 * Availability is NOT declared here — it is derived per cloud from whether an
 * adapter is registered (see `CloudProxyService.services`). This file only
 * carries the presentation metadata the nav needs, which is why adding a
 * service is one row here plus one adapter, with no frontend edit.
 *
 * `CloudServiceType` is derived from these keys, so a new row is also a new
 * route-addressable service type. Keeping the union closed means an unknown
 * slug is a 404 instead of a service that silently 501s later.
 */

/** Sidebar grouping. A flat list stops being usable past ~12 services. */
export type ServiceGroup =
    | 'Compute'
    | 'Storage'
    | 'Databases'
    | 'Networking'
    | 'Integration'
    | 'Provisioning'
    | 'Security'
    | 'Observability'

export const SERVICE_GROUP_ORDER: ServiceGroup[] = [
    'Compute',
    'Storage',
    'Databases',
    'Networking',
    'Integration',
    'Provisioning',
    'Security',
    'Observability',
]

export interface ServiceCatalogMetadata {
    displayName: string
    /** Per-cloud display override, e.g. 'EKS' vs 'AKS' vs 'GKE'. */
    displayNameByCloud?: Partial<Record<CloudProvider, string>>
    description: string
    descriptionByCloud?: Partial<Record<CloudProvider, string>>
    /** Resolved to a component client-side; an unknown key degrades to a default. */
    iconKey: string
    group: ServiceGroup
    /** Sort order within the group. */
    order: number
    /** Defaults to the catalog key. A leading '/' marks a page outside Cloud Explorer. */
    route?: string
    /**
     * Per-cloud route override. Needed when one category is served by a legacy
     * standalone page on one cloud and by Cloud Explorer on another — AWS secrets
     * still live at /secretsmanager while Azure Key Vault is a normal explorer route.
     */
    routeByCloud?: Partial<Record<CloudProvider, string>>
    /**
     * Escape hatch for a service whose UI predates the SPI, so availability
     * cannot come from the registry. Every entry here is migration debt — delete
     * the field once a real adapter exists.
     */
    legacyAvailability?: Partial<Record<CloudProvider, CloudAvailability>>
}

export const SERVICE_CATALOG = {
    compute: {
        displayName: 'Compute',
        description: 'Virtual machines for running applications and workloads.',
        iconKey: 'compute', group: 'Compute', order: 10,
    },
    k8s: {
        displayName: 'k8s Engine',
        displayNameByCloud: {aws: 'EKS', azure: 'AKS', gcp: 'GKE'},
        description: 'Managed Kubernetes clusters for containerized workloads.',
        iconKey: 'k8s',
        group: 'Compute',
        order: 20,
    },
    serverless: {
        displayName: 'Serverless',
        description: 'Run functions without managing servers.',
        iconKey: 'serverless', group: 'Compute', order: 30,
    },
    containers: {
        displayName: 'Containers',
        displayNameByCloud: {gcp: 'Cloud Run'},
        description: 'Deploy and run containerized applications.',
        iconKey: 'containers',
        group: 'Compute',
        order: 40,
    },
    sagemaker: {
        displayName: 'SageMaker AI',
        description: 'Build and host machine learning models.',
        iconKey: 'sagemaker', group: 'Compute', order: 50,
    },
    storage: {
        displayName: 'Storage',
        description: 'Store and manage files and objects.',
        iconKey: 'storage', group: 'Storage', order: 10,
    },
    database: {
        displayName: 'Database',
        description: 'Create and manage relational databases.',
        iconKey: 'database', group: 'Databases', order: 10,
    },
    nosql: {
        displayName: 'NoSQL',
        // Both labels are declared even though each arrives with its own adapter,
        // so this row reads the same whichever of the two lands first. A label for
        // a cloud with no adapter is inert: availability comes from the registry.
        displayNameByCloud: {aws: 'DynamoDB', azure: 'Cosmos DB NoSQL'},
        description: 'Store and query non-relational data.',
        iconKey: 'nosql',
        group: 'Databases',
        order: 20,
    },
    networking: {
        displayName: 'Networking',
        description: 'Connect and isolate cloud resources in virtual networks.',
        iconKey: 'networking', group: 'Networking', order: 10,
    },
    workflows: {
        displayName: 'Workflows',
        displayNameByCloud: {aws: 'Step Functions'},
        description: 'Coordinate application steps and long-running processes.',
        iconKey: 'workflows',
        group: 'Integration',
        order: 30,
    },
    loadbalancing: {
        displayName: 'Load Balancing',
        displayNameByCloud: {aws: 'ELB'},
        description: 'Distribute incoming traffic across application targets.',
        iconKey: 'loadbalancing',
        group: 'Networking',
        order: 20,
    },
    messaging: {
        displayName: 'Messaging',
        displayNameByCloud: {aws: 'SQS', gcp: 'Pub/Sub'},
        description: 'Exchange messages between applications.',
        descriptionByCloud: {
            aws: 'Queue messages between applications.',
            gcp: 'Publish and subscribe to messages across applications.',
        },
        iconKey: 'messaging',
        group: 'Integration',
        order: 10,
    },
    streams: {
        displayName: 'Streams',
        displayNameByCloud: {aws: 'Kinesis'},
        description: 'Collect and process streaming data in real time.',
        iconKey: 'streams',
        group: 'Integration',
        order: 12,
    },
    events: {
        displayName: 'Events',
        displayNameByCloud: {aws: 'EventBridge'},
        description: 'Route events from producers to application targets.',
        iconKey: 'events',
        group: 'Integration',
        order: 15,
    },
    identity: {
        displayName: 'Identity',
        description: 'Manage identities and access to cloud resources.',
        iconKey: 'iam', group: 'Security', order: 5,
    },
    cognito: {
        displayName: 'Cognito',
        description: 'Manage user pools and application sign-in.',
        iconKey: 'iam', group: 'Security', order: 6,
    },
    apigateway: {
        displayName: 'API Gateway',
        description: 'Create and manage APIs for application clients.',
        iconKey: 'apigateway', group: 'Integration', order: 10,
    },
    email: {
        displayName: 'Email',
        displayNameByCloud: {aws: 'SES Mailbox'},
        description: 'Send and inspect application email.',
        iconKey: 'email',
        group: 'Integration',
        order: 20,
    },
    kms: {
        displayName: 'Key Management',
        displayNameByCloud: {aws: 'KMS'},
        description: 'Create and manage encryption keys.',
        iconKey: 'kms',
        group: 'Security',
        order: 20,
    },
    parameters: {
        displayName: 'Parameter Store',
        description: 'Store configuration values for applications.',
        iconKey: 'parameters',
        group: 'Security',
        order: 30,
    },
    secrets: {
        displayName: 'Secrets Manager',
        displayNameByCloud: {azure: 'Key Vault', gcp: 'Secret Manager'},
        description: 'Store and manage application secrets.',
        iconKey: 'secrets',
        group: 'Security',
        order: 10,
        // AWS retains its dedicated page while Azure and GCP use Cloud Explorer.
        routeByCloud: {aws: '/secretsmanager'},
    },
    iac: {
        displayName: 'Infrastructure as Code',
        displayNameByCloud: {aws: 'CloudFormation'},
        description: 'Provision resources from infrastructure templates.',
        iconKey: 'iac',
        group: 'Provisioning',
        order: 10,
    },
    configuration: {
        displayName: 'Configuration',
        displayNameByCloud: {aws: 'AppConfig'},
        description: 'Manage and deploy application configuration.',
        iconKey: 'configuration',
        group: 'Provisioning',
        order: 20,
    },
    scheduler: {
        displayName: 'Cloud Scheduler',
        displayNameByCloud: {gcp: 'Cloud Scheduler'},
        description: 'Run jobs on a schedule.',
        iconKey: 'scheduler',
        group: 'Integration',
        order: 20,
    },
    logs: {
        displayName: 'Logs',
        displayNameByCloud: {aws: 'CloudWatch Logs'},
        description: 'Collect and inspect application logs.',
        iconKey: 'logs',
        group: 'Observability',
        order: 10,
    },
} as const satisfies Record<string, ServiceCatalogMetadata>

export type CloudServiceType = keyof typeof SERVICE_CATALOG

export interface ServiceCatalogEntry extends ServiceCatalogMetadata {
    service: CloudServiceType
}

/** Every known service, sorted by group then in-group order. */
export const SERVICE_CATALOG_ENTRIES: ServiceCatalogEntry[] = (
    Object.keys(SERVICE_CATALOG) as CloudServiceType[]
)
    .map((service) => ({service, ...SERVICE_CATALOG[service]}))
    .sort(compareCatalogEntries)

export const SERVICE_TYPES: CloudServiceType[] = SERVICE_CATALOG_ENTRIES.map((entry) => entry.service)

export function catalogEntry(service: string): ServiceCatalogEntry | undefined {
    return isServiceType(service) ? {service, ...SERVICE_CATALOG[service]} : undefined
}

/**
 * Route guard. A slug missing from the catalog is a 404 rather than a service
 * that renders and then fails on every call.
 */
export function isServiceType(value: string): value is CloudServiceType {
    return Object.hasOwn(SERVICE_CATALOG, value)
}

export function displayNameFor(entry: ServiceCatalogEntry, cloud: CloudProvider): string {
    return entry.displayNameByCloud?.[cloud] ?? entry.displayName
}

export function descriptionFor(entry: ServiceCatalogEntry, cloud: CloudProvider): string {
    return entry.descriptionByCloud?.[cloud] ?? entry.description
}

export function routeFor(entry: ServiceCatalogEntry, cloud?: CloudProvider): string {
    const perCloud = cloud ? entry.routeByCloud?.[cloud] : undefined
    return perCloud ?? entry.route ?? entry.service
}

export function compareCatalogEntries(a: ServiceCatalogEntry, b: ServiceCatalogEntry): number {
    const groupDelta = SERVICE_GROUP_ORDER.indexOf(a.group) - SERVICE_GROUP_ORDER.indexOf(b.group)
    return groupDelta !== 0 ? groupDelta : a.order - b.order
}
