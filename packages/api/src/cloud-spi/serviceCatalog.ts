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
    compute: {displayName: 'Compute', iconKey: 'compute', group: 'Compute', order: 10},
    k8s: {
        displayName: 'k8s Engine',
        displayNameByCloud: {aws: 'EKS', azure: 'AKS', gcp: 'GKE'},
        iconKey: 'k8s',
        group: 'Compute',
        order: 20,
    },
    serverless: {displayName: 'Serverless', iconKey: 'serverless', group: 'Compute', order: 30},
    storage: {displayName: 'Storage', iconKey: 'storage', group: 'Storage', order: 10},
    database: {displayName: 'Database', iconKey: 'database', group: 'Databases', order: 10},
    nosql: {
        displayName: 'NoSQL',
        // Both labels are declared even though each arrives with its own adapter,
        // so this row reads the same whichever of the two lands first. A label for
        // a cloud with no adapter is inert: availability comes from the registry.
        displayNameByCloud: {aws: 'DynamoDB', azure: 'Cosmos DB NoSQL'},
        iconKey: 'nosql',
        group: 'Databases',
        order: 20,
    },
    networking: {displayName: 'Networking', iconKey: 'networking', group: 'Networking', order: 10},
    messaging: {
        displayName: 'Messaging',
        displayNameByCloud: {aws: 'SQS', gcp: 'Pub/Sub'},
        iconKey: 'messaging',
        group: 'Integration',
        order: 10,
    },
    events: {
        displayName: 'Events',
        displayNameByCloud: {aws: 'EventBridge'},
        iconKey: 'events',
        group: 'Integration',
        order: 15,
    },
    identity: {displayName: 'Identity', iconKey: 'iam', group: 'Security', order: 5},
    apigateway: {displayName: 'API Gateway', iconKey: 'apigateway', group: 'Integration', order: 10},
    email: {
        displayName: 'Email',
        displayNameByCloud: {aws: 'SES Mailbox'},
        iconKey: 'email',
        group: 'Integration',
        order: 20,
    },
    secrets: {
        displayName: 'Secrets Manager',
        displayNameByCloud: {azure: 'Key Vault'},
        iconKey: 'secrets',
        group: 'Security',
        order: 10,
        route: '/secretsmanager',
        // Azure Key Vault is a normal Cloud Explorer service, so it uses the catalog
        // slug rather than the legacy standalone page AWS still points at.
        routeByCloud: {azure: 'secrets'},
    },
    iac: {
        displayName: 'Infrastructure as Code',
        displayNameByCloud: {aws: 'CloudFormation'},
        iconKey: 'iac',
        group: 'Provisioning',
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

export function routeFor(entry: ServiceCatalogEntry, cloud?: CloudProvider): string {
    const perCloud = cloud ? entry.routeByCloud?.[cloud] : undefined
    return perCloud ?? entry.route ?? entry.service
}

export function compareCatalogEntries(a: ServiceCatalogEntry, b: ServiceCatalogEntry): number {
    const groupDelta = SERVICE_GROUP_ORDER.indexOf(a.group) - SERVICE_GROUP_ORDER.indexOf(b.group)
    return groupDelta !== 0 ? groupDelta : a.order - b.order
}
