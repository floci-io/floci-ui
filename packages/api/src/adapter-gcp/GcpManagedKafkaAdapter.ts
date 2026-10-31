import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    GCP_KAFKA_CLUSTER_ID_MESSAGE,
    GCP_KAFKA_CLUSTER_ID_PATTERN,
    GCP_KAFKA_RESOURCE_TYPES,
    GCP_KAFKA_TOPIC_ID_MESSAGE,
    GCP_KAFKA_TOPIC_ID_PATTERN,
    gcpManagedKafkaSchema,
} from '../cloud-spi/kinesisSchema'
import {mapWithLimit} from '../concurrency'
import {gcp, type GcpRuntimeClient} from '../gcp'
import {type GcpOperationEnvelope, operationResponse} from './operations'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Managed Service for Apache Kafka through the Floci-GCP emulator, which serves
 * the public `managedkafka.googleapis.com` v1 REST paths. Verified against
 * `floci/floci-gcp` 0.12.0:
 *
 *   GET    /v1/projects/{p}/locations/{l}/clusters
 *   POST   /v1/projects/{p}/locations/{l}/clusters?clusterId={id}
 *   GET    /v1/projects/{p}/locations/{l}/clusters/{c}
 *   DELETE /v1/projects/{p}/locations/{l}/clusters/{c}
 *   GET    /v1/projects/{p}/locations/{l}/clusters/{c}/topics
 *   POST   /v1/projects/{p}/locations/{l}/clusters/{c}/topics?topicId={id}
 *   GET    /v1/projects/{p}/locations/{l}/clusters/{c}/topics/{t}
 *   DELETE /v1/projects/{p}/locations/{l}/clusters/{c}/topics/{t}
 *
 * This is the same path shape as GKE, which the runtime serves under the
 * `/container` prefix; the unprefixed path is Kafka. A cluster has the id
 * `cluster`, a topic `cluster/topic`: a topic is only addressable through its
 * cluster. Only the configured location is read. Produce and consume are not
 * part of this adapter.
 */

const JSON_HEADERS = {'content-type': 'application/json'}
const CLUSTER_ID_PATTERN = new RegExp(GCP_KAFKA_CLUSTER_ID_PATTERN)
const TOPIC_ID_PATTERN = new RegExp(GCP_KAFKA_TOPIC_ID_PATTERN)
/** Bound on `nextPageToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100
const LIST_CONCURRENCY = 8

interface KafkaCluster {
    name?: string
    state?: string
    createTime?: string
    updateTime?: string
    bootstrapAddress?: string
    /** The public API nests capacity; the runtime answers it flat. Both are read. */
    capacityConfig?: {vcpuCount?: string | number; memoryBytes?: string | number}
    vcpuCount?: string | number
    memoryBytes?: string | number
    labels?: Record<string, string>
}

interface KafkaTopic {
    name?: string
    partitionCount?: number
    replicationFactor?: number
    configs?: Record<string, string> | null
}

interface KafkaPage {
    nextPageToken?: string
}

interface KafkaClusterList extends KafkaPage {
    clusters?: KafkaCluster[]
}

interface KafkaTopicList extends KafkaPage {
    topics?: KafkaTopic[]
}

export class GcpManagedKafkaAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'streams' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpManagedKafkaSchema()
    }

    /** A failure on any cluster fails the whole list: a partial list would read as missing topics. */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const clusters = await this.pages<KafkaCluster, KafkaClusterList>(this.clustersPath(), (page) => page.clusters)
        const topicsByCluster = await mapWithLimit(clusters, LIST_CONCURRENCY, (cluster) =>
            this.pages<KafkaTopic, KafkaTopicList>(
                `${this.clustersPath()}/${encodeURIComponent(leaf(cluster.name))}/topics`,
                (page) => page.topics,
            ),
        )
        return filterBySearch(
            [
                ...clusters.map(clusterResource(this.client)),
                ...topicsByCluster.flat().map(topicResource(this.client)),
            ],
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const parts = id.split('/')
        if (parts.length === 1) {
            const cluster = await this.client.json<KafkaCluster>(
                this.clusterPath(id),
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            return cluster ? clusterResource(this.client)(cluster) : null
        }
        if (parts.length !== 2) return null

        const topic = await this.client.json<KafkaTopic>(this.topicPath(id), {method: 'GET'}, {emptyOnNotFound: true})
        return topic ? topicResource(this.client)(topic) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = oneOf(input.values.resourceType, GCP_KAFKA_RESOURCE_TYPES, 'resourceType')

        if (resourceType === 'cluster') {
            const clusterId = clusterIdOf(input.values.clusterName, 'clusterName')
            const result = await this.client.json<GcpOperationEnvelope<KafkaCluster> | KafkaCluster>(
                `${this.clustersPath()}?clusterId=${encodeURIComponent(clusterId)}`,
                {method: 'POST', headers: JSON_HEADERS, body: '{}'},
            )
            const created = operationResponse<KafkaCluster>(result)
            if (created) return clusterResource(this.client)(created)

            const fetched = await this.get(clusterId)
            if (!fetched) throw new RuntimeError('Managed Kafka did not return the created cluster')
            return fetched
        }

        const cluster = clusterIdOf(input.values.cluster, 'cluster')
        const topicId = topicIdOf(input.values.topicName, 'topicName')
        const body: Record<string, number> = {}
        const partitionCount = positiveInteger(input.values.partitionCount, 'partitionCount')
        const replicationFactor = positiveInteger(input.values.replicationFactor, 'replicationFactor')
        if (partitionCount !== undefined) body.partitionCount = partitionCount
        if (replicationFactor !== undefined) body.replicationFactor = replicationFactor

        const topic = await this.client.json<KafkaTopic>(
            `${this.clusterPath(cluster)}/topics?topicId=${encodeURIComponent(topicId)}`,
            {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body)},
        )
        if (!topic?.name) throw new RuntimeError('Managed Kafka did not return the created topic')
        return topicResource(this.client)(topic)
    }

    async delete(id: string): Promise<void> {
        const parts = id.split('/')
        if (parts.length === 1) {
            await this.client.fetch(this.clusterPath(id), {method: 'DELETE'})
            return
        }
        await this.client.fetch(this.topicPath(id), {method: 'DELETE'})
    }

    /** Every page of a list call, following `nextPageToken`. */
    private async pages<T, L extends KafkaPage>(path: string, items: (page: L) => T[] | undefined): Promise<T[]> {
        const all: T[] = []
        let token: string | undefined
        for (let hop = 0; hop < MAX_PAGES; hop += 1) {
            const page = await this.client.json<L>(token ? `${path}?pageToken=${encodeURIComponent(token)}` : path)
            all.push(...(page ? (items(page) ?? []) : []))
            token = page?.nextPageToken || undefined
            if (!token) return all
        }
        throw new RuntimeError(`Managed Kafka kept returning pages after ${MAX_PAGES}; refusing a partial list`)
    }

    private clustersPath(): string {
        const {project, location} = this.client
        return `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/clusters`
    }

    private clusterPath(cluster: string): string {
        return `${this.clustersPath()}/${encodeURIComponent(clusterIdOf(cluster, 'cluster'))}`
    }

    /** `cluster/topic`, validated segment by segment so an id can never address another path. */
    private topicPath(id: string): string {
        const [cluster, topic, ...rest] = id.split('/')
        if (rest.length > 0 || topic === undefined) throw new NotFoundError(`Topic ${id} was not found`)
        return `${this.clusterPath(cluster)}/topics/${encodeURIComponent(topicIdOf(topic, 'topic'))}`
    }
}

function clusterResource(client: GcpRuntimeClient) {
    return (cluster: KafkaCluster): CloudResource => {
        const name = leaf(cluster.name)
        return {
            id: name,
            name,
            cloud: 'gcp',
            service: 'streams',
            type: 'cluster',
            region: client.location,
            createdAt: cluster.createTime ?? null,
            status: cluster.state ?? null,
            metadata: {
                provider: 'gcp',
                resourcePath: cluster.name ?? null,
                bootstrapAddress: cluster.bootstrapAddress ?? null,
                vcpuCount: numberOrNull(cluster.capacityConfig?.vcpuCount ?? cluster.vcpuCount),
                memoryBytes: numberOrNull(cluster.capacityConfig?.memoryBytes ?? cluster.memoryBytes),
                updatedAt: cluster.updateTime ?? null,
                labels: cluster.labels ?? {},
            },
        }
    }
}

function topicResource(client: GcpRuntimeClient) {
    return (topic: KafkaTopic): CloudResource => {
        // projects/{p}/locations/{l}/clusters/{cluster}/topics/{topic}
        const segments = (topic.name ?? '').split('/')
        const name = segments[7] ?? ''
        const cluster = segments[5] ?? ''
        return {
            id: `${cluster}/${name}`,
            name,
            cloud: 'gcp',
            service: 'streams',
            type: 'topic',
            region: client.location,
            createdAt: null,
            status: null,
            metadata: {
                provider: 'gcp',
                resourcePath: topic.name ?? null,
                cluster,
                partitionCount: topic.partitionCount ?? null,
                replicationFactor: topic.replicationFactor ?? null,
                configs: topic.configs ?? {},
            },
        }
    }
}

function leaf(path: string | undefined): string {
    return (path ?? '').split('/').pop() ?? ''
}

function numberOrNull(value: string | number | undefined): number | null {
    if (value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function clusterIdOf(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
    const trimmed = value.trim()
    if (trimmed.length > 63 || !CLUSTER_ID_PATTERN.test(trimmed)) {
        throw new ValidationError(`${field}: ${GCP_KAFKA_CLUSTER_ID_MESSAGE}`)
    }
    return trimmed
}

function topicIdOf(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
    const trimmed = value.trim()
    if (trimmed === '.' || trimmed === '..' || !TOPIC_ID_PATTERN.test(trimmed)) {
        throw new ValidationError(`${field}: ${GCP_KAFKA_TOPIC_ID_MESSAGE}`)
    }
    return trimmed
}

/** Undefined when the field was left blank, so the runtime's own default applies. */
function positiveInteger(value: unknown, field: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isInteger(parsed) || parsed < 1) throw new ValidationError(`${field} must be a positive whole number`)
    return parsed
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
    throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter(
        (resource) => resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized),
    )
}
