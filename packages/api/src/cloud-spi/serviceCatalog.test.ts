import {describe, expect, test} from 'bun:test'
import {
    SERVICE_CATALOG,
    SERVICE_CATALOG_ENTRIES,
    SERVICE_GROUP_ORDER,
    SERVICE_TYPES,
    catalogEntry,
    descriptionFor,
    displayNameFor,
    docsUrlFor,
    isServiceType,
    routeFor,
} from './serviceCatalog'
import type {CloudProvider} from './types'

const CLOUDS: CloudProvider[] = ['aws', 'azure', 'gcp', 'oci']

/** Provider names and product names that belong to one provider only. */
const PROVIDER_TERMS: Record<CloudProvider, string[]> = {
    aws: [
        'AWS', 'Amazon', 'SageMaker', 'Aurora', 'DSQL', 'SNS', 'SQS', 'EventBridge', 'Cognito', 'CloudWatch',
        'X-Ray', 'Parameter Store', 'Secrets Manager', 'Lambda', 'DynamoDB', 'Kinesis', 'Step Functions',
        'CloudFormation', 'Route 53', 'CloudFront', 'ElastiCache', 'OpenSearch', 'Athena', 'AppConfig',
        'CodeBuild', 'ACM', 'ECR', 'ECS', 'EKS', 'IAM', 'user pools', 'FIFO',
    ],
    azure: [
        'Azure', 'Microsoft', 'Key Vault', 'Entra', 'Event Grid', 'Event Hubs', 'Cosmos', 'ARM', 'Service Bus',
        'API Management', 'Application Insights', 'AKS', 'Table Storage', 'Queue Storage',
    ],
    gcp: [
        'Google', 'GCP', 'Vertex', 'Pub/Sub', 'BigQuery', 'Firestore', 'Spanner', 'Cloud Run', 'GKE', 'Eventarc',
        'Identity Platform', 'Cloud Monitoring', 'Cloud Trace', 'Cloud Scheduler', 'Cloud Logging',
    ],
    oci: ['OCI', 'Oracle', 'tenancy', 'tenancies', 'Work Requests', 'OKE', 'Data Science'],
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Whole-word matches only, so 'ARM' does not match 'alarms'. */
function mentions(text: string, terms: string[]): string[] {
    return terms.filter((term) => new RegExp(`(^|[^A-Za-z])${escapeRegExp(term)}([^A-Za-z]|$)`).test(text))
}

describe('SERVICE_CATALOG', () => {
    test('every entry carries the metadata the nav needs', () => {
        for (const entry of SERVICE_CATALOG_ENTRIES) {
            expect(entry.displayName.length).toBeGreaterThan(0)
            expect(entry.description.trim().length).toBeGreaterThan(0)
            expect(entry.description.length).toBeLessThanOrEqual(90)
            expect(entry.iconKey.length).toBeGreaterThan(0)
            expect(SERVICE_GROUP_ORDER).toContain(entry.group)
            expect(Number.isFinite(entry.order)).toBe(true)
            expect(routeFor(entry, 'aws').length).toBeGreaterThan(0)
        }
    })

    test('exposes one entry per catalog key', () => {
        expect(SERVICE_CATALOG_ENTRIES).toHaveLength(Object.keys(SERVICE_CATALOG).length)
        expect(new Set(SERVICE_TYPES).size).toBe(SERVICE_TYPES.length)
    })

    test('registers the iac category under the Provisioning group', () => {
        expect(SERVICE_GROUP_ORDER).toContain('Provisioning')
        const iac = catalogEntry('iac')!
        expect(iac.group).toBe('Provisioning')
        expect(isServiceType('iac')).toBe(true)
        expect(displayNameFor(iac, 'aws')).toBe('CloudFormation')
    })

    test('registers the workflows category under the Integration group', () => {
        expect(SERVICE_GROUP_ORDER).toContain('Integration')
        const workflows = catalogEntry('workflows')!
        expect(workflows.group).toBe('Integration')
        expect(workflows.iconKey).toBe('workflows')
        expect(isServiceType('workflows')).toBe(true)
        expect(displayNameFor(workflows, 'aws')).toBe('Step Functions')
        // No override for the other clouds -> the shared display name.
        expect(displayNameFor(workflows, 'gcp')).toBe('Workflows')
    })

    test('keeps Cognito separate from the IAM identity category', () => {
        const cognito = catalogEntry('cognito')!

        expect(cognito.group).toBe('Security')
        expect(cognito.iconKey).toBe('iam')
        expect(displayNameFor(cognito, 'gcp')).toBe('Identity Platform')
        expect(cognito.order).toBeGreaterThan(catalogEntry('identity')!.order)
        expect(isServiceType('cognito')).toBe(true)
    })

    test('keeps Azure Queue Storage separate from Service Bus', () => {
        const queue = catalogEntry('queue')!

        expect(queue.group).toBe('Integration')
        expect(routeFor(queue, 'azure')).toBe('queue')
        expect(displayNameFor(queue, 'azure')).toBe('Queue Storage')
        expect(queue.iconKey).toBe('queue')
    })

    test('labels Azure Event Hubs on the neutral Streams category', () => {
        const streams = catalogEntry('streams')!

        expect(streams.group).toBe('Integration')
        expect(displayNameFor(streams, 'azure')).toBe('Event Hubs')
        expect(displayNameFor(streams, 'aws')).toBe('Kinesis')
        expect(displayNameFor(streams, 'oci')).toBe('Streaming')
    })

    test('labels AWS Scheduler on the neutral scheduler category', () => {
        const scheduler = catalogEntry('scheduler')!

        expect(scheduler.group).toBe('Integration')
        expect(scheduler.displayName).toBe('Scheduler')
        expect(displayNameFor(scheduler, 'aws')).toBe('EventBridge Scheduler')
        expect(displayNameFor(scheduler, 'gcp')).toBe('Cloud Scheduler')
    })

    test('places CloudWatch after Logs in Observability', () => {
        const cloudwatch = catalogEntry('cloudwatch')!
        expect(cloudwatch.group).toBe('Observability')
        expect(cloudwatch.order).toBeGreaterThan(catalogEntry('logs')!.order)
        expect(displayNameFor(cloudwatch, 'aws')).toBe('CloudWatch')
        expect(routeFor(cloudwatch, 'aws')).toBe('cloudwatch')
        expect(displayNameFor(cloudwatch, 'gcp')).toBe('Cloud Monitoring')
    })

    test('keeps SNS separate from the SQS messaging adapter', () => {
        const sns = catalogEntry('sns')!
        expect(sns.group).toBe('Integration')
        expect(sns.order).toBeGreaterThan(catalogEntry('messaging')!.order)
        expect(displayNameFor(sns, 'aws')).toBe('SNS')
        expect(routeFor(sns, 'aws')).toBe('sns')
    })

    test('orders entries by group then in-group order', () => {
        const positions = SERVICE_CATALOG_ENTRIES.map((entry) => [
            SERVICE_GROUP_ORDER.indexOf(entry.group),
            entry.order,
        ])

        for (let i = 1; i < positions.length; i += 1) {
            const [prevGroup, prevOrder] = positions[i - 1]!
            const [group, order] = positions[i]!
            expect(prevGroup < group || (prevGroup === group && prevOrder <= order)).toBe(true)
        }
    })

    test('routes default to the slug', () => {
        expect(routeFor(catalogEntry('storage')!, 'aws')).toBe('storage')
        expect(routeFor(catalogEntry('storage')!, 'gcp')).toBe('storage')
    })

    test('a per-cloud override routes one provider to its bespoke page', () => {
        // AWS Secrets Manager keeps its dedicated page until value reveal exists
        // as a row action; GCP goes through the generic explorer today.
        const secrets = catalogEntry('secrets')!
        expect(routeFor(secrets, 'aws')).toBe('/secretsmanager')
        expect(routeFor(secrets, 'gcp')).toBe('secrets')
    })

    test('resolves per-cloud routes so one category can span a legacy page and the explorer', () => {
        const secrets = catalogEntry('secrets')!
        expect(routeFor(secrets, 'aws')).toBe('/secretsmanager')
        expect(routeFor(secrets, 'azure')).toBe('secrets')
        // A category with no per-cloud override is unaffected by the cloud argument.
        expect(routeFor(catalogEntry('storage')!, 'azure')).toBe('storage')
    })

    test('resolves per-cloud display names', () => {
        const k8s = catalogEntry('k8s')!
        expect(displayNameFor(k8s, 'aws')).toBe('EKS')
        expect(displayNameFor(k8s, 'azure')).toBe('AKS')
        expect(displayNameFor(k8s, 'gcp')).toBe('GKE')
        // No override -> the shared display name.
        expect(displayNameFor(catalogEntry('storage')!, 'gcp')).toBe('Storage')
    })

    test('resolves per-cloud descriptions without promising the wrong messaging model', () => {
        const messaging = catalogEntry('messaging')!
        expect(descriptionFor(messaging, 'aws')).toContain('Queue')
        expect(descriptionFor(messaging, 'gcp')).toContain('Publish and subscribe')
        expect(descriptionFor(messaging, 'azure')).toBe(messaging.description)
    })

    test('derives runtime-specific Floci docs URLs only where a docs slug is declared', () => {
        const k8s = catalogEntry('k8s')!
        expect(docsUrlFor(k8s, 'aws')).toBe('https://floci.io/floci/services/eks/')
        expect(docsUrlFor(k8s, 'azure')).toBe('https://floci.io/floci-az/services/aks/')
        expect(docsUrlFor(k8s, 'gcp')).toBe('https://floci.io/floci-gcp/services/gke/')
        expect(docsUrlFor(k8s, 'oci')).toBe('https://floci.io/floci-oci/services/containerengine/')

        // Services without a Floci docs page for a given cloud return undefined instead of a broken link.
        const loadbalancing = catalogEntry('loadbalancing')!
        expect(docsUrlFor(loadbalancing, 'aws')).toBe('https://floci.io/floci/services/elb/')
        expect(docsUrlFor(loadbalancing, 'azure')).toBeUndefined()
        expect(docsUrlFor(catalogEntry('workrequests')!, 'oci')).toBeUndefined()
    })
})

describe('per-cloud catalog text', () => {
    const allTerms = CLOUDS.flatMap((cloud) => PROVIDER_TERMS[cloud])

    test('no shared fallback name or description names a provider or one provider\'s product', () => {
        for (const entry of SERVICE_CATALOG_ENTRIES) {
            expect({service: entry.service, leaks: mentions(entry.displayName, allTerms)}).toEqual({service: entry.service, leaks: []})
            expect({service: entry.service, leaks: mentions(entry.description, allTerms)}).toEqual({service: entry.service, leaks: []})
        }
    })

    test('no cloud resolves a name or description that belongs to another provider', () => {
        for (const cloud of CLOUDS) {
            const foreign = CLOUDS.filter((other) => other !== cloud).flatMap((other) => PROVIDER_TERMS[other])
            for (const entry of SERVICE_CATALOG_ENTRIES) {
                const text = `${displayNameFor(entry, cloud)} | ${descriptionFor(entry, cloud)}`
                expect({cloud, service: entry.service, leaks: mentions(text, foreign)}).toEqual({cloud, service: entry.service, leaks: []})
            }
        }
    })

    test('each cloud resolves its own product name', () => {
        const expected: Record<string, Record<CloudProvider, string>> = {
            sagemaker: {aws: 'SageMaker AI', azure: 'Machine Learning', gcp: 'Vertex AI', oci: 'Data Science'},
            dsql: {aws: 'Aurora DSQL', azure: 'Distributed SQL', gcp: 'Spanner', oci: 'Distributed SQL'},
            sns: {aws: 'SNS', azure: 'Notifications', gcp: 'Notifications', oci: 'Notifications'},
            eventsv2: {aws: 'EventBridge V2', azure: 'Event Buses', gcp: 'Event Buses', oci: 'Event Buses'},
            cognito: {aws: 'Cognito', azure: 'User Sign-in', gcp: 'Identity Platform', oci: 'User Sign-in'},
            cloudwatch: {aws: 'CloudWatch', azure: 'Azure Monitor', gcp: 'Cloud Monitoring', oci: 'Monitoring'},
            xray: {aws: 'X-Ray', azure: 'Application Insights', gcp: 'Cloud Trace', oci: 'Tracing'},
            parameters: {aws: 'Parameter Store', azure: 'Parameters', gcp: 'Parameters', oci: 'Parameters'},
            table: {aws: 'Storage Tables', azure: 'Table Storage', gcp: 'Storage Tables', oci: 'Storage Tables'},
            queue: {aws: 'Storage Queues', azure: 'Queue Storage', gcp: 'Storage Queues', oci: 'Storage Queues'},
            workrequests: {aws: 'Operations', azure: 'Operations', gcp: 'Operations', oci: 'Work Requests'},
        }
        for (const [service, names] of Object.entries(expected)) {
            for (const cloud of CLOUDS) {
                expect({service, cloud, name: displayNameFor(catalogEntry(service)!, cloud)}).toEqual({service, cloud, name: names[cloud]})
            }
        }
    })

    test('keeps the Azure Storage wording on Azure only', () => {
        expect(descriptionFor(catalogEntry('table')!, 'azure')).toBe('Manage Azure Storage tables.')
        expect(descriptionFor(catalogEntry('queue')!, 'azure')).toBe('Create and inspect Azure Storage queues.')
        for (const cloud of ['aws', 'gcp', 'oci'] as const) {
            expect(descriptionFor(catalogEntry('table')!, cloud)).not.toContain('Azure')
            expect(descriptionFor(catalogEntry('queue')!, cloud)).not.toContain('Azure')
        }
    })
})

describe('isServiceType', () => {
    test('accepts every catalog key', () => {
        for (const service of SERVICE_TYPES) {
            expect(isServiceType(service)).toBe(true)
        }
    })

    test('rejects unknown slugs so routes 404 instead of failing later', () => {
        for (const slug of ['stroage', '', 'constructor', '__proto__', 'toString']) {
            expect(isServiceType(slug)).toBe(false)
        }
    })

    test('catalogEntry returns undefined for an unknown slug', () => {
        expect(catalogEntry('unknown')).toBeUndefined()
    })
})
