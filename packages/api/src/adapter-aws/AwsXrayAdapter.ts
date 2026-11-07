import {
    BatchGetTracesCommand,
    GetSamplingRulesCommand,
    GetTraceGraphCommand,
    GetTraceSummariesCommand,
    type TraceSummary,
    type XRayClient,
} from '@aws-sdk/client-xray'
import {awsXraySchema} from '../cloud-spi/xraySchema'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

/** The windows the schema offers, in seconds. */
const WINDOWS: Record<string, number> = {'5m': 300, '15m': 900, '1h': 3600, '24h': 86400}
const DEFAULT_WINDOW = '1h'

/** How many summary pages one list asks for, so a wide window cannot page forever. */
const MAX_SUMMARY_PAGES = 10

/** A trace, read from GetTraceSummaries and detail from BatchGetTraces. */
export class AwsXrayAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'xray' as const

    constructor(
        private readonly xray: XRayClient,
        private readonly region = process.env.AWS_REGION || 'us-east-1',
    ) {}

    schema(): ServiceSchema {
        return awsXraySchema()
    }

    descriptorOverride(): {displayName: string} {
        return {displayName: 'X-Ray'}
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const window = query.filters?.window || DEFAULT_WINDOW
        const seconds = WINDOWS[window]
        if (!seconds) {
            throw new ValidationError(`Unknown window "${window}". Use one of ${Object.keys(WINDOWS).join(', ')}.`)
        }
        const endTime = new Date()
        const startTime = new Date(endTime.getTime() - seconds * 1000)
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
        const graph = await this.xray.send(new GetTraceGraphCommand({TraceIds: [id]}))
        const documents = (trace.Segments ?? []).map((segment) => parseDocument(segment.Document))
        const services = (graph.Services ?? []).map((service) => ({
            referenceId: service.ReferenceId ?? null,
            name: service.Name,
            type: service.Type,
            state: service.State,
            count: service.SummaryStatistics?.TotalCount ?? 0,
            averageMs: averageResponseMs(service.SummaryStatistics?.TotalResponseTime, service.SummaryStatistics?.TotalCount),
            edges: (service.Edges ?? []).map((edge) => edge.ReferenceId),
        }))
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
    if (!totalResponseTime || !count) {
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

function statusOfDocuments(documents: Array<Record<string, unknown>>): string {
    for (const document of documents) {
        if (document.fault === true) {
            return 'fault'
        }
    }
    for (const document of documents) {
        if (document.error === true) {
            return 'error'
        }
    }
    for (const document of documents) {
        if (document.throttle === true) {
            return 'throttle'
        }
    }
    return 'ok'
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
