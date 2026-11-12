import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    GCP_EVENTARC_DESTINATION_TYPES,
    GCP_EVENTARC_EVENT_TYPES,
    GCP_EVENTARC_TRIGGER_ID_MESSAGE,
    GCP_EVENTARC_TRIGGER_ID_PATTERN,
    gcpEventarcSchema,
} from '../cloud-spi/gcpEventarcSchema'
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
 * Eventarc triggers through the Floci-GCP emulator, which serves the public
 * `eventarc.googleapis.com` v1 REST paths. Verified against `floci/floci-gcp`:
 *
 *   GET    /v1/projects/{p}/locations/{l}/triggers                    -> {triggers?: [...], nextPageToken?}, `{}` when empty
 *   POST   /v1/projects/{p}/locations/{l}/triggers?triggerId={id}     -> a done operation with the trigger in `response`
 *   GET    /v1/projects/{p}/locations/{l}/triggers/{id}               -> Trigger
 *   DELETE /v1/projects/{p}/locations/{l}/triggers/{id}               -> a done operation
 *
 * The runtime stores whatever it is sent: an empty filter attribute, a missing
 * destination or an upper case id all answer 200. The shape the public API
 * requires is therefore checked here, before the request is sent. Only the
 * configured location is read.
 */

const JSON_HEADERS = {'content-type': 'application/json'}
const TRIGGER_ID_PATTERN = new RegExp(GCP_EVENTARC_TRIGGER_ID_PATTERN)
const CLOUD_RUN_SERVICE_PATTERN = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/
const FILTER_ATTRIBUTE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/
const EVENT_TYPES: readonly string[] = GCP_EVENTARC_EVENT_TYPES.map((type) => type.value)
/** Bound on `nextPageToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100

interface EventarcFilter {
    attribute?: string
    value?: string
    operator?: string
}

interface EventarcTrigger {
    name?: string
    uid?: string
    createTime?: string
    updateTime?: string
    eventFilters?: EventarcFilter[]
    destination?: {
        cloudRun?: {service?: string; path?: string; region?: string}
        httpEndpoint?: {uri?: string}
        [other: string]: unknown
    }
    transport?: unknown
    serviceAccount?: string
    labels?: Record<string, string>
    conditions?: Record<string, unknown>
    channel?: string
    etag?: string
}

interface EventarcTriggerList {
    triggers?: EventarcTrigger[]
    nextPageToken?: string
}

export class GcpEventarcAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'events' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpEventarcSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const triggers: EventarcTrigger[] = []
        let token: string | undefined
        for (let hop = 0; ; hop += 1) {
            if (hop === MAX_PAGES) {
                throw new RuntimeError(`Eventarc kept returning pages after ${MAX_PAGES}; refusing a partial list`)
            }
            const path = token ? `${this.triggersPath()}?pageToken=${encodeURIComponent(token)}` : this.triggersPath()
            const page = await this.client.json<EventarcTriggerList>(path)
            triggers.push(...(page?.triggers ?? []))
            token = page?.nextPageToken || undefined
            if (!token) break
        }
        return filterBySearch(triggers.map(toResource(this.client)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const trigger = await this.client.json<EventarcTrigger>(
            this.triggerPath(id),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return trigger ? toResource(this.client)(trigger) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const triggerId = triggerIdOf(input.values.name)
        const body = {
            eventFilters: [
                {attribute: 'type', value: eventTypeOf(input.values.eventType)},
                ...extraFiltersOf(input.values.filters),
            ],
            destination: destinationOf(input.values, this.client.location),
        }

        const result = await this.client.json<GcpOperationEnvelope<EventarcTrigger> | EventarcTrigger>(
            `${this.triggersPath()}?triggerId=${encodeURIComponent(triggerId)}`,
            {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body)},
        )
        const created = operationResponse<EventarcTrigger>(result)
        if (created) return toResource(this.client)(created)

        const fetched = await this.get(triggerId)
        if (!fetched) throw new RuntimeError('Eventarc did not return the created trigger')
        return fetched
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(this.triggerPath(id), {method: 'DELETE'})
    }

    private triggersPath(): string {
        const {project, location} = this.client
        return `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/triggers`
    }

    private triggerPath(id: string): string {
        return `${this.triggersPath()}/${encodeURIComponent(triggerIdOf(id))}`
    }
}

function toResource(client: GcpRuntimeClient) {
    return (trigger: EventarcTrigger): CloudResource => {
        const name = leaf(trigger.name)
        const filters = trigger.eventFilters ?? []
        const eventType = filters.find((filter) => filter.attribute === 'type')?.value ?? null
        return {
            id: name,
            name,
            cloud: 'gcp',
            service: 'events',
            type: 'trigger',
            region: client.location,
            createdAt: trigger.createTime ?? null,
            status: null,
            metadata: {
                provider: 'gcp',
                resourcePath: trigger.name ?? null,
                uid: trigger.uid ?? null,
                eventType,
                eventFilters: filters,
                filterSummary: filters.filter((filter) => filter.attribute !== 'type').map(describeFilter),
                destination: describeDestination(trigger.destination),
                destinationConfig: trigger.destination ?? null,
                transport: trigger.transport ?? null,
                serviceAccount: trigger.serviceAccount ?? null,
                channel: trigger.channel ?? null,
                updatedAt: trigger.updateTime ?? null,
                etag: trigger.etag ?? null,
                labels: trigger.labels ?? {},
                conditions: trigger.conditions ?? {},
            },
        }
    }
}

function describeFilter(filter: EventarcFilter): string {
    const operator = filter.operator ? ` ${filter.operator} ` : '='
    return `${filter.attribute ?? ''}${operator}${filter.value ?? ''}`
}

function describeDestination(destination: EventarcTrigger['destination']): string | null {
    if (!destination) return null
    if (destination.cloudRun) {
        const {service, region, path} = destination.cloudRun
        return `Cloud Run ${service ?? ''}${path ?? ''}${region ? ` (${region})` : ''}`
    }
    if (destination.httpEndpoint) return destination.httpEndpoint.uri ?? null
    return Object.keys(destination)[0] ?? null
}

function leaf(path: string | undefined): string {
    return (path ?? '').split('/').pop() ?? ''
}

function triggerIdOf(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError('name is required')
    const trimmed = value.trim()
    if (!TRIGGER_ID_PATTERN.test(trimmed)) throw new ValidationError(`name: ${GCP_EVENTARC_TRIGGER_ID_MESSAGE}`)
    return trimmed
}

function eventTypeOf(value: unknown): string {
    if (typeof value === 'string' && EVENT_TYPES.includes(value)) return value
    throw new ValidationError(`eventType must be one of ${EVENT_TYPES.join(', ')}`)
}

/** `attribute=value` per line. The event type is its own field, so a `type` line would only collide with it. */
function extraFiltersOf(value: unknown): EventarcFilter[] {
    if (value === undefined || value === null || value === '') return []
    if (typeof value !== 'string') throw new ValidationError('filters must be text, one attribute=value per line')

    const seen = new Set<string>()
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const separator = line.indexOf('=')
            const attribute = separator < 0 ? '' : line.slice(0, separator).trim()
            const filterValue = separator < 0 ? '' : line.slice(separator + 1).trim()
            if (!FILTER_ATTRIBUTE_PATTERN.test(attribute) || !filterValue) {
                throw new ValidationError(`Filter "${line}" must be attribute=value, for example bucket=my-bucket`)
            }
            if (attribute === 'type') {
                throw new ValidationError('The type filter is set by Event Type, remove the type line from Extra Filters')
            }
            if (seen.has(attribute)) throw new ValidationError(`Filter ${attribute} is given more than once`)
            seen.add(attribute)
            return {attribute, value: filterValue}
        })
}

function destinationOf(values: Record<string, unknown>, defaultRegion: string): Record<string, unknown> {
    const type = values.destinationType
    if (typeof type !== 'string' || !(GCP_EVENTARC_DESTINATION_TYPES as readonly string[]).includes(type)) {
        throw new ValidationError(`destinationType must be one of ${GCP_EVENTARC_DESTINATION_TYPES.join(', ')}`)
    }

    if (type === 'httpEndpoint') {
        const uri = text(values.httpUri)
        if (!uri) throw new ValidationError('httpUri is required')
        if (!isHttpUrl(uri)) throw new ValidationError('httpUri must be an http or https URL')
        return {httpEndpoint: {uri}}
    }

    const service = text(values.cloudRunService)
    if (!service) throw new ValidationError('cloudRunService is required')
    if (!CLOUD_RUN_SERVICE_PATTERN.test(service)) {
        throw new ValidationError('cloudRunService must be 1 to 63 lowercase letters, digits and hyphens')
    }
    const path = text(values.cloudRunPath)
    if (path && !path.startsWith('/')) throw new ValidationError('Path must start with /')
    return {cloudRun: {service, region: text(values.cloudRunRegion) || defaultRegion, ...(path ? {path} : {})}}
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter(
        (resource) => resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized),
    )
}
