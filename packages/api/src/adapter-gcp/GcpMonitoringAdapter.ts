import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    GCP_MONITORING_METRIC_KINDS,
    GCP_MONITORING_TYPE_MESSAGE,
    GCP_MONITORING_TYPE_PATTERN,
    GCP_MONITORING_VALUE_TYPES,
    gcpMonitoringSchema,
} from '../cloud-spi/cloudwatchSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

/**
 * Cloud Monitoring metric descriptors through the Floci-GCP emulator, which
 * serves the public `monitoring.googleapis.com` v3 REST paths. Verified against
 * `floci/floci-gcp`:
 *
 *   GET    /v3/projects/{p}/metricDescriptors                 -> {metricDescriptors?: [...], nextPageToken?}, `{}` when empty
 *   POST   /v3/projects/{p}/metricDescriptors                 -> MetricDescriptor (an upsert)
 *   GET    /v3/projects/{p}/metricDescriptors/{type}          -> MetricDescriptor, `type` keeps its slash
 *   DELETE /v3/projects/{p}/metricDescriptors/{type}          -> {}, custom and external metrics only
 *   GET    /v3/projects/{p}/timeSeries?filter=metric.type="{type}"&interval.*  -> {timeSeries?: [...]}
 *
 * A time series read needs an interval end, and the runtime treats a missing
 * start as unbounded where Google defaults it, so both ends are always sent.
 */

const JSON_HEADERS = {'content-type': 'application/json'}
const TYPE_PATTERN = new RegExp(GCP_MONITORING_TYPE_PATTERN)
/** Any descriptor the runtime lists, built in ones included: `domain/path`, never a dot segment. */
const ANY_TYPE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+$/
/** The runtime refuses points older than this, so nothing readable lies beyond it. */
const READ_WINDOW_MS = 25 * 60 * 60 * 1000
/** The runtime accepts points up to five minutes ahead. */
const READ_AHEAD_MS = 5 * 60 * 1000
const POINTS_PAGE_SIZE = 100
const LATEST_POINTS = 20
/** Bound on `nextPageToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100

interface MetricDescriptor {
    name?: string
    type?: string
    metricKind?: string
    valueType?: string
    unit?: string
    description?: string
    displayName?: string
    labels?: {key?: string; valueType?: string; description?: string}[]
    launchStage?: string
    monitoredResourceTypes?: string[]
}

interface MetricDescriptorList {
    metricDescriptors?: MetricDescriptor[]
    nextPageToken?: string
}

interface TypedValue {
    boolValue?: boolean
    int64Value?: string | number
    doubleValue?: number
    stringValue?: string
    distributionValue?: unknown
}

interface TimeSeries {
    metric?: {type?: string; labels?: Record<string, string>}
    resource?: {type?: string; labels?: Record<string, string>}
    points?: {interval?: {startTime?: string; endTime?: string}; value?: TypedValue}[]
}

interface TimeSeriesList {
    timeSeries?: TimeSeries[]
}

export class GcpMonitoringAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'cloudwatch' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpMonitoringSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const descriptors: MetricDescriptor[] = []
        let token: string | undefined
        for (let hop = 0; ; hop += 1) {
            if (hop === MAX_PAGES) {
                throw new RuntimeError(`Cloud Monitoring kept returning pages after ${MAX_PAGES}; refusing a partial list`)
            }
            const path = token ? `${this.descriptorsPath()}?pageToken=${encodeURIComponent(token)}` : this.descriptorsPath()
            const page = await this.client.json<MetricDescriptorList>(path)
            descriptors.push(...(page?.metricDescriptors ?? []))
            token = page?.nextPageToken || undefined
            if (!token) break
        }
        return filterBySearch(descriptors.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const type = metricTypeOf(id, ANY_TYPE_PATTERN)
        const descriptor = await this.client.json<MetricDescriptor>(this.descriptorPath(type), {method: 'GET'}, {emptyOnNotFound: true})
        if (!descriptor) return null
        const resource = toResource(descriptor)
        return {...resource, metadata: {...resource.metadata, latestPoints: await this.latestPoints(type)}}
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const type = metricTypeOf(input.values.name, TYPE_PATTERN)
        const metricKind = oneOf(input.values.metricKind, GCP_MONITORING_METRIC_KINDS, 'metricKind')
        const valueType = oneOf(input.values.valueType, GCP_MONITORING_VALUE_TYPES, 'valueType')
        if ((valueType === 'BOOL' || valueType === 'STRING') && metricKind !== 'GAUGE') {
            throw new ValidationError('BOOL and STRING value types are only valid with the GAUGE metric kind')
        }

        const descriptor = await this.client.json<MetricDescriptor>(this.descriptorsPath(), {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
                type,
                metricKind,
                valueType,
                ...optional('unit', input.values.unit),
                ...optional('displayName', input.values.displayName),
                ...optional('description', input.values.description),
            }),
        })
        if (!descriptor) throw new RuntimeError('Cloud Monitoring did not return the created metric descriptor')
        return toResource(descriptor)
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(this.descriptorPath(metricTypeOf(id, ANY_TYPE_PATTERN)), {method: 'DELETE'})
    }

    private async latestPoints(type: string): Promise<LatestPoint[]> {
        const now = Date.now()
        const params = new URLSearchParams({
            filter: `metric.type="${type}"`,
            'interval.startTime': new Date(now - READ_WINDOW_MS).toISOString(),
            'interval.endTime': new Date(now + READ_AHEAD_MS).toISOString(),
            view: 'FULL',
            pageSize: String(POINTS_PAGE_SIZE),
        })
        const page = await this.client.json<TimeSeriesList>(`${this.timeSeriesPath()}?${params}`)
        return (page?.timeSeries ?? [])
            .flatMap((series) =>
                (series.points ?? []).map((point) => ({
                    time: point.interval?.endTime ?? null,
                    value: valueOf(point.value),
                    labels: series.metric?.labels ?? {},
                    resourceType: series.resource?.type ?? null,
                })),
            )
            .sort((a, b) => Date.parse(b.time ?? '') - Date.parse(a.time ?? ''))
            .slice(0, LATEST_POINTS)
    }

    private descriptorsPath(): string {
        return `/v3/projects/${encodeURIComponent(this.client.project)}/metricDescriptors`
    }

    private descriptorPath(type: string): string {
        return `${this.descriptorsPath()}/${type.split('/').map(encodeURIComponent).join('/')}`
    }

    private timeSeriesPath(): string {
        return `/v3/projects/${encodeURIComponent(this.client.project)}/timeSeries`
    }
}

interface LatestPoint {
    time: string | null
    value: unknown
    labels: Record<string, string>
    resourceType: string | null
}

function toResource(descriptor: MetricDescriptor): CloudResource {
    const type = descriptor.type ?? (descriptor.name ?? '').split('/metricDescriptors/').pop() ?? ''
    return {
        id: type,
        name: type,
        cloud: 'gcp',
        service: 'cloudwatch',
        type: 'metric-descriptor',
        region: null,
        createdAt: null,
        status: null,
        metadata: {
            provider: 'gcp',
            resourcePath: descriptor.name ?? null,
            metricKind: descriptor.metricKind ?? null,
            valueType: descriptor.valueType ?? null,
            unit: descriptor.unit ?? null,
            displayName: descriptor.displayName ?? null,
            description: descriptor.description ?? null,
            labels: descriptor.labels ?? [],
            launchStage: descriptor.launchStage ?? null,
            monitoredResourceTypes: descriptor.monitoredResourceTypes ?? [],
        },
    }
}

/** The proto's `oneof value`: the one set field is the value. */
function valueOf(value: TypedValue | undefined): unknown {
    if (!value) return null
    if (value.doubleValue !== undefined) return value.doubleValue
    if (value.int64Value !== undefined) return Number(value.int64Value)
    if (value.boolValue !== undefined) return value.boolValue
    if (value.stringValue !== undefined) return value.stringValue
    return value.distributionValue ?? null
}

function metricTypeOf(value: unknown, pattern: RegExp): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError('name is required')
    const trimmed = value.trim()
    if (!pattern.test(trimmed) || trimmed.split('/').some((segment) => segment === '.' || segment === '..')) {
        throw new ValidationError(`name: ${GCP_MONITORING_TYPE_MESSAGE}`)
    }
    return trimmed
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
    throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
}

function optional(key: string, value: unknown): Record<string, string> {
    return typeof value === 'string' && value.trim() ? {[key]: value.trim()} : {}
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.id.toLowerCase().includes(normalized))
}
