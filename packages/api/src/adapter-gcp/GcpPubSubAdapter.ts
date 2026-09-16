import {ValidationError} from '../cloud-spi/errors'
import {gcpMessagingSchema} from '../cloud-spi/messagingSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Pub/Sub topics as `messaging` resources. Verified against `floci/floci-gcp`
 * 0.5.0, which mirrors the public Pub/Sub v1 REST API:
 *
 *   GET    /v1/projects/{project}/topics
 *   PUT    /v1/projects/{project}/topics/{topic}   (create — not POST)
 *   GET    /v1/projects/{project}/topics/{topic}
 *   DELETE /v1/projects/{project}/topics/{topic}
 *
 * Topics are addressed by the fully qualified `projects/{p}/topics/{id}` path;
 * the console uses the short id and rebuilds the path per call.
 */

interface PubSubTopic {
    name?: string
    labels?: Record<string, string>
    kmsKeyName?: string
    messageRetentionDuration?: string
}

interface PubSubTopicList {
    topics?: PubSubTopic[]
}

export class GcpPubSubAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'messaging' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpMessagingSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.client.json<PubSubTopicList>(this.topicsPath())
        return filterBySearch((body?.topics ?? []).map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const topic = await this.client.json<PubSubTopic>(
            `${this.topicsPath()}/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return topic ? toResource(topic) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.topicName ?? input.values.name)
        if (!name) throw new ValidationError('topicName is required')
        if (!isValidTopicName(name)) {
            throw new ValidationError(
                'Use a valid Pub/Sub topic name: 3-255 characters starting with a letter, using letters, numbers, or - _ . ~ + %',
            )
        }

        // Pub/Sub creates with PUT on the resource path, not POST to a collection.
        const topic = await this.client.json<PubSubTopic>(`${this.topicsPath()}/${encodeURIComponent(name)}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({}),
        })

        return toResource(topic ?? {name: `${this.projectPrefix()}/topics/${name}`})
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(`${this.topicsPath()}/${encodeURIComponent(id)}`, {method: 'DELETE'})
    }

    private projectPrefix(): string {
        return `projects/${this.client.project}`
    }

    private topicsPath(): string {
        return `/v1/projects/${encodeURIComponent(this.client.project)}/topics`
    }
}

function toResource(topic: PubSubTopic): CloudResource {
    const path = topic.name ?? ''
    const name = path.split('/').pop() ?? path

    return {
        id: name,
        name,
        cloud: 'gcp',
        service: 'messaging',
        type: 'topic',
        region: null,
        createdAt: null,
        metadata: {
            provider: 'gcp',
            messagingService: 'pubsub',
            resourcePath: path,
            labels: topic.labels,
            kmsKeyName: topic.kmsKeyName,
            messageRetentionDuration: topic.messageRetentionDuration,
        },
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isValidTopicName(value: string): boolean {
    return /^[A-Za-z][A-Za-z0-9\-_.~+%]{2,254}$/.test(value)
}
