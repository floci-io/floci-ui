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
    docsSlugByCloud?: Partial<Record<CloudProvider, string>>
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
        docsSlugByCloud: {aws: 'ec2', azure: 'vm', gcp: 'compute'},
        iconKey: 'compute', group: 'Compute', order: 10,
    },
    k8s: {
        displayName: 'k8s Engine',
        displayNameByCloud: {aws: 'EKS', azure: 'AKS', gcp: 'GKE', oci: 'OKE'},
        description: 'Managed Kubernetes clusters for containerized workloads.',
        docsSlugByCloud: {aws: 'eks', azure: 'aks', gcp: 'gke', oci: 'containerengine'},
        iconKey: 'k8s',
        group: 'Compute',
        order: 20,
    },
    serverless: {
        displayName: 'Serverless',
        displayNameByCloud: {oci: 'Functions'},
        description: 'Run functions without managing servers.',
        docsSlugByCloud: {aws: 'lambda', azure: 'functions', gcp: 'cloud-functions', oci: 'functions'},
        iconKey: 'serverless',
        group: 'Compute',
        order: 30,
    },
    containers: {
        displayName: 'Containers',
        displayNameByCloud: {aws: 'ECS', azure: 'Container Apps', gcp: 'Cloud Run'},
        description: 'Deploy and run containerized applications.',
        docsSlugByCloud: {aws: 'ecs', azure: 'container-apps', gcp: 'cloud-run'},
        iconKey: 'containers',
        group: 'Compute',
        order: 40,
    },
    registry: {
        displayName: 'Container Registry',
        displayNameByCloud: {aws: 'ECR', azure: 'Container Registry'},
        description: 'Store and manage container images.',
        docsSlugByCloud: {aws: 'ecr', azure: 'acr'},
        iconKey: 'registry',
        group: 'Compute',
        order: 45,
    },
    sagemaker: {
        displayName: 'SageMaker AI',
        description: 'Build and host machine learning models.',
        docsSlugByCloud: {aws: 'sagemaker'},
        iconKey: 'sagemaker', group: 'Compute', order: 50,
    },
    storage: {
        displayName: 'Storage',
        description: 'Store and manage files and objects.',
        docsSlugByCloud: {aws: 's3', azure: 'blob', gcp: 'gcs', oci: 'object-storage'},
        iconKey: 'storage', group: 'Storage', order: 10,
    },
    table: {
        displayName: 'Table Storage',
        description: 'Manage Azure Storage tables.',
        docsSlugByCloud: {azure: 'table'},
        iconKey: 'database', group: 'Storage', order: 20,
    },
    database: {
        displayName: 'Database',
        description: 'Create and manage relational databases.',
        docsSlugByCloud: {aws: 'rds', azure: 'sql', gcp: 'cloud-sql-postgres', oci: 'psql'},
        iconKey: 'database', group: 'Databases', order: 10,
    },
    dsql: {
        displayName: 'Aurora DSQL',
        description: 'Serverless distributed SQL clusters that sign in with IAM.',
        docsSlugByCloud: {aws: 'dsql'},
        iconKey: 'database', group: 'Databases', order: 15,
    },
    cache: {
        displayName: 'Cache',
        displayNameByCloud: {aws: 'ElastiCache', azure: 'Azure Cache for Redis'},
        description: 'Run in-memory caches and replication groups.',
        docsSlugByCloud: {aws: 'elasticache', azure: 'redis'},
        iconKey: 'database', group: 'Databases', order: 18,
    },
    nosql: {
        displayName: 'NoSQL',
        // Both labels are declared even though each arrives with its own adapter,
        // so this row reads the same whichever of the two lands first. A label for
        // a cloud with no adapter is inert: availability comes from the registry.
        displayNameByCloud: {aws: 'DynamoDB', azure: 'Cosmos DB NoSQL', gcp: 'Firestore'},
        description: 'Store and query non-relational data.',
        docsSlugByCloud: {aws: 'dynamodb', azure: 'cosmos', gcp: 'firestore'},
        iconKey: 'nosql',
        group: 'Databases',
        order: 20,
    },
    search: {
        displayName: 'Search',
        displayNameByCloud: {aws: 'OpenSearch'},
        description: 'Run search and log analytics domains.',
        docsSlugByCloud: {aws: 'opensearch'},
        iconKey: 'database', group: 'Databases', order: 25,
    },
    analytics: {
        displayName: 'Analytics',
        displayNameByCloud: {aws: 'Athena', gcp: 'BigQuery'},
        description: 'Browse analytics datasets and the tables inside them.',
        docsSlugByCloud: {aws: 'athena', gcp: 'bigquery'},
        iconKey: 'analytics', group: 'Databases', order: 30,
    },
    networking: {
        displayName: 'Networking',
        description: 'Connect and isolate cloud resources in virtual networks.',
        docsSlugByCloud: {aws: 'ec2', azure: 'network'},
        iconKey: 'networking', group: 'Networking', order: 10,
    },
    workflows: {
        displayName: 'Workflows',
        displayNameByCloud: {aws: 'Step Functions'},
        description: 'Coordinate application steps and long-running processes.',
        docsSlugByCloud: {aws: 'step-functions'},
        iconKey: 'workflows',
        group: 'Integration',
        order: 30,
    },
    loadbalancing: {
        displayName: 'Load Balancing',
        displayNameByCloud: {aws: 'ELB'},
        description: 'Distribute incoming traffic across application targets.',
        docsSlugByCloud: {aws: 'elb'},
        iconKey: 'loadbalancing',
        group: 'Networking',
        order: 20,
    },
    cdn: {
        displayName: 'CDN',
        displayNameByCloud: {aws: 'CloudFront'},
        description: 'Deliver content from edge locations with distributions.',
        docsSlugByCloud: {aws: 'cloudfront'},
        iconKey: 'networking',
        group: 'Networking',
        order: 30,
    },
    dns: {
        displayName: 'DNS',
        displayNameByCloud: {aws: 'Route 53'},
        description: 'Manage DNS zones and the records they hold.',
        docsSlugByCloud: {aws: 'route53'},
        iconKey: 'networking',
        group: 'Networking',
        order: 40,
    },
    messaging: {
        displayName: 'Messaging',
        displayNameByCloud: {aws: 'SQS', gcp: 'Pub/Sub', oci: 'Queue'},
        description: 'Exchange messages between applications.',
        descriptionByCloud: {
            aws: 'Queue messages between applications.',
            gcp: 'Publish and subscribe to messages across applications.',
            oci: 'Queue messages between applications.',
        },
        docsSlugByCloud: {aws: 'sqs', azure: 'service-bus', gcp: 'pubsub', oci: 'queue'},
        iconKey: 'messaging',
        group: 'Integration',
        order: 10,
    },
    sns: {
        displayName: 'SNS',
        description: 'Manage standard and FIFO notification topics.',
        docsSlugByCloud: {aws: 'sns'},
        iconKey: 'messaging', group: 'Integration', order: 11,
    },
    queue: {
        displayName: 'Queue Storage',
        description: 'Create and inspect Azure Storage queues.',
        docsSlugByCloud: {azure: 'queue'},
        iconKey: 'queue',
        group: 'Integration',
        order: 11,
    },
    streams: {
        displayName: 'Streams',
        displayNameByCloud: {aws: 'Kinesis', azure: 'Event Hubs', gcp: 'Managed Kafka', oci: 'Streaming'},
        description: 'Collect and process streaming data in real time.',
        docsSlugByCloud: {aws: 'kinesis', azure: 'event-hub', gcp: 'managed-kafka', oci: 'streaming'},
        iconKey: 'streams',
        group: 'Integration',
        order: 12,
    },
    events: {
        displayName: 'Events',
        displayNameByCloud: {aws: 'EventBridge', azure: 'Event Grid', gcp: 'Eventarc'},
        description: 'Route events from producers to application targets.',
        descriptionByCloud: {azure: 'Manage Event Grid custom topics and browse their event subscriptions.'},
        docsSlugByCloud: {aws: 'eventbridge', azure: 'event-grid', gcp: 'eventarc'},
        iconKey: 'events',
        group: 'Integration',
        order: 15,
    },
    eventsv2: {
        displayName: 'EventBridge V2',
        description: 'Publish events to buses that deliver them to filtered subscribers.',
        docsSlugByCloud: {aws: 'eventbridgev2'},
        iconKey: 'events',
        group: 'Integration',
        order: 16,
    },
    identity: {
        displayName: 'Identity',
        description: 'Manage identities and access to cloud resources.',
        docsSlugByCloud: {aws: 'iam', azure: 'entra', gcp: 'iam', oci: 'identity'},
        iconKey: 'iam', group: 'Security', order: 5,
    },
    cognito: {
        displayName: 'Cognito',
        description: 'Manage user pools and application sign-in.',
        docsSlugByCloud: {aws: 'cognito'},
        iconKey: 'iam', group: 'Security', order: 6,
    },
    apigateway: {
        displayName: 'API Gateway',
        displayNameByCloud: {azure: 'API Management'},
        description: 'Create and manage APIs for application clients.',
        descriptionByCloud: {azure: 'Browse API Management services, APIs, products and backends.'},
        docsSlugByCloud: {aws: 'api-gateway', azure: 'apim'},
        iconKey: 'apigateway', group: 'Integration', order: 10,
    },
    email: {
        displayName: 'Email',
        displayNameByCloud: {aws: 'SES Mailbox'},
        description: 'Send and inspect application email.',
        docsSlugByCloud: {aws: 'ses', azure: 'email'},
        iconKey: 'email',
        group: 'Integration',
        order: 20,
    },
    kms: {
        displayName: 'Key Management',
        displayNameByCloud: {aws: 'KMS', azure: 'Key Vault Keys', gcp: 'Cloud KMS', oci: 'Vault'},
        description: 'Create and manage encryption keys.',
        docsSlugByCloud: {aws: 'kms', azure: 'key-vault', gcp: 'kms', oci: 'kms-vault'},
        iconKey: 'kms',
        group: 'Security',
        order: 20,
    },
    certificates: {
        displayName: 'Certificates',
        displayNameByCloud: {aws: 'ACM', azure: 'Key Vault Certificates'},
        description: 'Issue and manage certificates.',
        docsSlugByCloud: {aws: 'acm', azure: 'key-vault'},
        iconKey: 'kms',
        group: 'Security',
        order: 25,
    },
    parameters: {
        displayName: 'Parameter Store',
        description: 'Store configuration values for applications.',
        docsSlugByCloud: {aws: 'ssm'},
        iconKey: 'parameters',
        group: 'Security',
        order: 30,
    },
    secrets: {
        displayName: 'Secrets Manager',
        displayNameByCloud: {azure: 'Key Vault', gcp: 'Secret Manager', oci: 'Vault Secrets'},
        description: 'Store and manage application secrets.',
        docsSlugByCloud: {aws: 'secrets-manager', azure: 'key-vault', gcp: 'secret-manager', oci: 'kms-vault'},
        iconKey: 'secrets',
        group: 'Security',
        order: 10,
        // AWS retains its dedicated page while Azure and GCP use Cloud Explorer.
        routeByCloud: {aws: '/secretsmanager'},
    },
    iac: {
        displayName: 'Infrastructure as Code',
        displayNameByCloud: {aws: 'CloudFormation', azure: 'ARM Deployments'},
        description: 'Provision resources from infrastructure templates.',
        docsSlugByCloud: {aws: 'cloudformation', azure: 'deployments'},
        iconKey: 'iac',
        group: 'Provisioning',
        order: 10,
    },
    configuration: {
        displayName: 'Configuration',
        displayNameByCloud: {aws: 'AppConfig', azure: 'App Configuration'},
        description: 'Manage and deploy application configuration.',
        docsSlugByCloud: {aws: 'appconfig', azure: 'app-config'},
        iconKey: 'configuration',
        group: 'Provisioning',
        order: 20,
    },
    cicd: {
        displayName: 'CI/CD',
        displayNameByCloud: {aws: 'CodeBuild'},
        description: 'Run builds for application projects.',
        docsSlugByCloud: {aws: 'codebuild'},
        iconKey: 'workflows',
        group: 'Provisioning',
        order: 30,
    },
    scheduler: {
        displayName: 'Scheduler',
        displayNameByCloud: {aws: 'EventBridge Scheduler', gcp: 'Cloud Scheduler'},
        description: 'Run jobs on a schedule.',
        docsSlugByCloud: {aws: 'scheduler', gcp: 'scheduler'},
        iconKey: 'scheduler',
        group: 'Integration',
        order: 20,
    },
    logs: {
        displayName: 'Logs',
        displayNameByCloud: {aws: 'CloudWatch Logs', gcp: 'Cloud Logging'},
        description: 'Collect and inspect application logs.',
        docsSlugByCloud: {aws: 'cloudwatch', azure: 'monitor', gcp: 'logging'},
        iconKey: 'logs',
        group: 'Observability',
        order: 10,
    },
    cloudwatch: {
        displayName: 'CloudWatch',
        description: 'Watch metrics and manage alarms.',
        docsSlugByCloud: {aws: 'cloudwatch', azure: 'monitor', gcp: 'cloud-monitoring'},
        iconKey: 'monitoring',
        group: 'Observability',
        order: 20,
    },
    workrequests: {
        displayName: 'Work Requests',
        description: 'Follow asynchronous operations, their progress and errors.',
        iconKey: 'monitoring',
        group: 'Observability',
        order: 30,
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

const DOCS_BASE_URL_BY_CLOUD: Record<CloudProvider, string> = {
    aws: 'https://floci.io/floci/services',
    azure: 'https://floci.io/floci-az/services',
    gcp: 'https://floci.io/floci-gcp/services',
    oci: 'https://floci.io/floci-oci/services',
}

export function docsUrlFor(entry: ServiceCatalogEntry, cloud: CloudProvider): string | undefined {
    const slug = entry.docsSlugByCloud?.[cloud]
    return slug ? `${DOCS_BASE_URL_BY_CLOUD[cloud]}/${slug}/` : undefined
}
