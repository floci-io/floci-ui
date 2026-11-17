import {
    BatchGetTracesCommand,
    GetSamplingRulesCommand,
    GetTraceGraphCommand,
    GetTraceSummariesCommand,
    type TraceSummary,
    type XRayClient,
} from '@aws-sdk/client-xray'
import {awsXraySchema} from '../cloud-spi/xraySchema'
import {NotImplementedByRuntimeError, NotSupportedError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CloudServiceDescriptorOverride,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {mapAwsSdkError} from './awsErrors'

/**
 * The windows the `window` filter accepts, in seconds. The schema does not declare the filter yet,
 * so the page lists the default window until the Cloud Explorer renders a filter row (#429).
 */
const WINDOWS: Record<string, number> = {'5m': 300, '15m': 900, '1h': 3600, '24h': 86400}
const DEFAULT_WINDOW = '1h'

/** How long a probe result is reused, since the sidebar asks for the service list often. */
const PROBE_TTL_MS = 5_000

const RUNTIME_GAP_REASON =
    'This Floci build does not serve X-Ray yet. It needs a build that includes floci-io/floci#7733.'

/** How many summary pages one list asks for, so a wide window cannot page forever. */
const MAX_SUMMARY_PAGES = 10

/** Same bound for a trace graph, which real AWS pages by service. */
const MAX_GRAPH_PAGES = 10

type GraphService = {
    referenceId: number | null
    name: string
    type: string | undefined
    state: string | undefined
    count: number
    averageMs: number | null
    edges: number[]
}

/** A trace, read from GetTraceSummaries and detail from BatchGetTraces. */
export class AwsXrayAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'xray' as const

    private probe: {at: number; gap: boolean} | null = null

    constructor(
        private readonly xray: XRayClient,
        private readonly region: string,
    ) {}

    schema(): ServiceSchema {
        return awsXraySchema()
    }

    descriptorOverride(): {displayName: string} {
        return {displayName: 'X-Ray'}
    }

    /**
     * A Floci build that predates floci-io/floci#7733 answers every X-Ray call with
     * `UnknownOperationException`. Only that answer marks the service as a runtime gap: an
     * unreachable runtime or any other failure leaves it available, since reachability is
     * reported on its own and a failed probe must not hide a service that works.
     */
    async resolveDescriptorOverride(): Promise<CloudServiceDescriptorOverride> {
        if (!(await this.runtimeLacksXray())) {
            return this.descriptorOverride()
        }
        return {...this.descriptorOverride(), availability: 'coming_soon', reason: RUNTIME_GAP_REASON}
    }

    private async runtimeLacksXray(): Promise<boolean> {
        if (this.probe && Date.now() - this.probe.at < PROBE_TTL_MS) {
            return this.probe.gap
        }
        let gap = false
        try {
            await this.health()
        } catch (error) {
            gap = mapAwsSdkError(error) instanceof NotImplementedByRuntimeError
        }
        this.probe = {at: Date.now(), gap}
        return gap
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const window = query.filters?.window || DEFAULT_WINDOW
        const seconds = WINDOWS[window]
        if (!seconds) {
            throw new ValidationError(`Unknown window "${window}". Use one of ${Object.keys(WINDOWS).join(', ')}.`)
        }
        const endTime = new Date()
        const startTime = new Date(endTime.getTime() - seconds * 1000)
        // Like the window, the expression is adapter support that waits for #429; the page sends neither.
        const expression = query.filters?.expression?.trim()

        const summaries: TraceSummary[] = []
        let nextToken: string | undefined
        let pages = 0
        do {
            const response = await this.xray.send(new GetTraceSummariesCommand({
                StartTime: startTime,
                EndTime: endTime,
                FilterExpression: expression || undefined,
                NextToken: nextToken,
            }))
            summaries.push(...(response.TraceSummaries ?? []))
            nextToken = response.NextToken
            pages += 1
        } while (nextToken && pages < MAX_SUMMARY_PAGES)

        const search = query.search?.trim().toLowerCase()
        return summaries
            .filter((summary) => !search || matchesSearch(summary, search))
            .map((summary) => summaryResource(summary, this.region))
    }

    async get(id: string): Promise<CloudResource | null> {
        const batch = await this.xray.send(new BatchGetTracesCommand({TraceIds: [id]}))
        const trace = batch.Traces?.[0]
        if (!trace) {
            return null
        }
        const documents = (trace.Segments ?? []).map((segment) => parseDocument(segment.Document))
        // The graph is paged by service, so a trace whose downstreams outnumber a page would
        // otherwise lose them here, and its edges would name references nothing holds.
        const services: GraphService[] = []
        let graphToken: string | undefined
        let graphPages = 0
        do {
            const graph = await this.xray.send(new GetTraceGraphCommand({TraceIds: [id], NextToken: graphToken}))
            services.push(...(graph.Services ?? []).map(toGraphService))
            graphToken = graph.NextToken
            graphPages += 1
        } while (graphToken && graphPages < MAX_GRAPH_PAGES)
        const startedAt = firstStartTime(documents)

        return {
            id,
            name: id,
            cloud: 'aws',
            service: 'xray',
            type: 'trace',
            region: this.region,
            createdAt: startedAt === null ? null : new Date(startedAt * 1000).toISOString(),
            status: statusOfDocuments(documents),
            metadata: {
                durationMs: Math.round((trace.Duration ?? 0) * 1000),
                segments: documents,
                segmentCount: documents.length,
                services,
            },
        }
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('A trace is written by an instrumented application, an SDK or the X-Ray daemon, not from the console.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Floci keeps traces for 30 days and the newest 10 000 per Region, so there is nothing to delete here.')
    }

    /** The cheapest call that proves the service is served. */
    async health(): Promise<void> {
        await this.xray.send(new GetSamplingRulesCommand({}))
    }
}

function summaryResource(summary: TraceSummary, region: string): CloudResource {
    const durationSeconds = summary.Duration ?? 0
    return {
        id: summary.Id ?? '',
        name: summary.Id ?? '',
        cloud: 'aws',
        service: 'xray',
        type: 'trace',
        region,
        createdAt: summary.StartTime ? summary.StartTime.toISOString() : null,
        status: statusOf(summary),
        metadata: {
            duration: `${(durationSeconds * 1000).toFixed(0)} ms`,
            durationMs: Math.round(durationSeconds * 1000),
            services: (summary.ServiceIds ?? []).map((service) => service.Name).filter(Boolean),
            httpStatus: summary.Http?.HttpStatus ?? null,
            entryPoint: summary.EntryPoint?.Name ?? null,
            hasError: summary.HasError ?? false,
            hasFault: summary.HasFault ?? false,
            hasThrottle: summary.HasThrottle ?? false,
        },
    }
}

function statusOf(summary: TraceSummary): string {
    if (summary.HasFault) {
        return 'fault'
    }
    if (summary.HasError) {
        return 'error'
    }
    if (summary.HasThrottle) {
        return 'throttle'
    }
    return 'ok'
}

function matchesSearch(summary: TraceSummary, search: string): boolean {
    if ((summary.Id ?? '').toLowerCase().includes(search)) {
        return true
    }
    return (summary.ServiceIds ?? []).some((service) => (service.Name ?? '').toLowerCase().includes(search))
}

function averageResponseMs(totalResponseTime: number | undefined, count: number | undefined): number | null {
    // A total of zero over calls that happened is a real zero, not a missing value: only an absent
    // total or no calls leave the average unknown.
    if (totalResponseTime == null || !count) {
        return null
    }
    return Math.round((totalResponseTime / count) * 1000)
}

/**
 * A trace's start is only in its segments: the SDK models the root without a timestamp. The
 * earliest segment wins, because a downstream segment can arrive before its root in the batch.
 */
function firstStartTime(documents: Array<Record<string, unknown>>): number | null {
    let earliest: number | null = null
    for (const document of documents) {
        const start = document.start_time
        if (typeof start === 'number' && (earliest === null || start < earliest)) {
            earliest = start
        }
    }
    return earliest
}

/**
 * A trace's outcome, read from its documents with fault over error over throttle. Subsegments
 * are walked too: a healthy root that called something that failed is a failed trace, and the
 * flag lives on the nested subsegment, not on the root.
 */
function statusOfDocuments(documents: Array<Record<string, unknown>>): string {
    let fault = false
    let error = false
    let throttle = false
    const pending = [...documents]
    while (pending.length > 0) {
        const document = pending.pop() as Record<string, unknown>
        fault = fault || document.fault === true
        error = error || document.error === true
        throttle = throttle || document.throttle === true
        const subsegments = document.subsegments
        if (Array.isArray(subsegments)) {
            for (const subsegment of subsegments) {
                if (subsegment && typeof subsegment === 'object') {
                    pending.push(subsegment as Record<string, unknown>)
                }
            }
        }
    }
    if (fault) {
        return 'fault'
    }
    if (error) {
        return 'error'
    }
    if (throttle) {
        return 'throttle'
    }
    return 'ok'
}

function toGraphService(service: {
    ReferenceId?: number
    Name?: string
    Type?: string
    State?: string
    SummaryStatistics?: {TotalCount?: number; TotalResponseTime?: number}
    Edges?: Array<{ReferenceId?: number}>
}): GraphService {
    return {
        referenceId: service.ReferenceId ?? null,
        name: service.Name ?? '',
        type: service.Type,
        state: service.State,
        count: service.SummaryStatistics?.TotalCount ?? 0,
        averageMs: averageResponseMs(service.SummaryStatistics?.TotalResponseTime, service.SummaryStatistics?.TotalCount),
        edges: (service.Edges ?? []).map((edge) => edge.ReferenceId ?? 0).filter((referenceId) => referenceId !== 0),
    }
}

function parseDocument(document: string | undefined): Record<string, unknown> {
    if (!document) {
        return {}
    }
    try {
        return JSON.parse(document) as Record<string, unknown>
    } catch {
        return {document}
    }
}
