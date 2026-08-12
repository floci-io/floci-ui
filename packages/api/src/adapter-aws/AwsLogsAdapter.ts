import {
    type CloudWatchLogsClient,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    DeleteLogGroupCommand,
    DeleteLogStreamCommand,
    DescribeLogGroupsCommand,
    DescribeLogStreamsCommand,
    GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {awsLogsSchema} from '../cloud-spi/logsSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * `creationTime` is the field real AWS returns and the only one the SDK models.
 *
 * The local runtime sends `createdTime` instead, and the SDK deserializer drops
 * wire fields it does not model — so that value is unrecoverable here and
 * `createdAt` is null for every log group and stream against the emulator.
 * Reading the emulator's spelling instead would be dead code in production and
 * would only ever pass against hand-built stubs, which is how this shipped
 * wrong the first time. See
 * .claude/memory/aws-sdk-error-names-differ-from-wire-codes.md — same failure
 * mode, different field.
 */
interface LogGroupShape {
    logGroupName?: string
    creationTime?: number
    arn?: string
    storedBytes?: number
    metricFilterCount?: number
    retentionInDays?: number
}

function createdAtOf(record: {creationTime?: number}): string | null {
    return record.creationTime ? new Date(record.creationTime).toISOString() : null
}

export class AwsLogsAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'logs' as const

    readonly documents: DocumentStoreAdapter

    constructor(private readonly client: CloudWatchLogsClient) {
        this.documents = new LogGroupDocumentStore(client)
    }

    schema(): ServiceSchema {
        return awsLogsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const prefix = query.search?.trim()
        const response = await this.client.send(
            new DescribeLogGroupsCommand(prefix ? {logGroupNamePrefix: prefix} : {}),
        )
        return (response.logGroups ?? []).map(toResource)
    }

    async get(id: string): Promise<CloudResource | null> {
        const group = await this.describeExact(id)
        return group ? toResource(group) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = String(input.values.name ?? '').trim()
        if (!name) throw new ValidationError('A log group name is required.')

        await this.client.send(new CreateLogGroupCommand({logGroupName: name}))

        const group = await this.describeExact(name)
        if (!group) throw new NotFoundError(`Log group ${name} was created but could not be read back.`)
        return toResource(group)
    }

    async delete(id: string): Promise<void> {
        await this.client.send(new DeleteLogGroupCommand({logGroupName: id}))
    }

    /**
     * DescribeLogGroups filters by prefix, so `/floci/probe` also returns
     * `/floci/probe-two`. Filtering to an exact match keeps `get` honest.
     */
    private async describeExact(name: string): Promise<LogGroupShape | null> {
        const response = await this.client.send(new DescribeLogGroupsCommand({logGroupNamePrefix: name}))
        return (response.logGroups ?? []).find((group) => group.logGroupName === name) ?? null
    }
}

/** AWS rejects a DescribeLogStreams Limit above this. GetLogEvents allows 10,000. */
const MAX_DESCRIBE_LOG_STREAMS_LIMIT = 50

interface LogStreamShape {
    logStreamName?: string
    arn?: string
    creationTime?: number
    storedBytes?: number
    firstEventTimestamp?: number
    lastEventTimestamp?: number
}

/**
 * Streams are the collection level, events the leaf. There is deliberately no
 * putItem/deleteItem/queryItems: AWS has no DeleteLogEvent, and PutLogEvents is
 * not something a resource browser should expose.
 */
class LogGroupDocumentStore implements DocumentStoreAdapter {
    constructor(private readonly client: CloudWatchLogsClient) {}

    async listCollections(resourceId: string, page: PageQuery = {}): Promise<CollectionPage<ChildCollection>> {
        const response = await this.client.send(
            new DescribeLogStreamsCommand({
                logGroupName: resourceId,
                orderBy: 'LastEventTime',
                descending: true,
                // Real AWS caps this at 50 and rejects anything higher with a
                // ValidationException; the SPI defaults to 100 and permits 1000.
                // The local runtime does not enforce the cap, so an unclamped
                // value passes here and 400s in production.
                //
                // Clamping is safe where rejecting would be wrong: `limit` is a
                // maximum, not a quota, and the response still carries
                // `nextCursor`, so a short page is honest rather than a silent
                // truncation. That is the opposite of `clampLimit`, which
                // rejects — there the caller has no cursor to tell them more
                // exists.
                limit: Math.min(page.limit ?? MAX_DESCRIBE_LOG_STREAMS_LIMIT, MAX_DESCRIBE_LOG_STREAMS_LIMIT),
                nextToken: page.cursor,
            }),
        )
        return {
            items: (response.logStreams ?? []).map((stream) => toCollection(stream, resourceId)),
            nextCursor: response.nextToken ?? null,
        }
    }

    async createCollection(resourceId: string, input: CreateResourceInput): Promise<ChildCollection> {
        const name = String(input.values.name ?? '').trim()
        if (!name) throw new ValidationError('A log stream name is required.')

        await this.client.send(new CreateLogStreamCommand({logGroupName: resourceId, logStreamName: name}))

        const response = await this.client.send(
            new DescribeLogStreamsCommand({logGroupName: resourceId, logStreamNamePrefix: name}),
        )
        const stream = (response.logStreams ?? []).find((candidate) => candidate.logStreamName === name)
        if (!stream) throw new NotFoundError(`Log stream ${name} was created but could not be read back.`)
        return toCollection(stream, resourceId)
    }

    async deleteCollection(resourceId: string, collectionId: string): Promise<void> {
        await this.client.send(new DeleteLogStreamCommand({logGroupName: resourceId, logStreamName: collectionId}))
    }

    async listItems(resourceId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const response = await this.client.send(
            new GetLogEventsCommand({
                logGroupName: resourceId,
                logStreamName: collectionId,
                // Without this the runtime returns the newest page, so paging
                // forward from a fresh cursor would skip the history.
                startFromHead: true,
                limit: page.limit,
                nextToken: page.cursor,
            }),
        )

        const events = response.events ?? []
        const forward = response.nextForwardToken ?? null

        return {
            items: events.map((event, index) => ({
                // Real AWS gives log events no identifier — the SDK models only
                // timestamp/message/ingestionTime, and the emulator's `eventId`
                // is discarded by the deserializer. Position within the page is
                // the only thing available, so it is not stable across calls and
                // must not be used as a durable key.
                id: `${event.timestamp ?? 0}-${index}`,
                collectionId,
                timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : null,
                body: {message: event.message ?? ''},
                metadata: {
                    ingestionTime: event.ingestionTime ? new Date(event.ingestionTime).toISOString() : null,
                },
            })),
            // GetLogEvents echoes the supplied token back at the end of the
            // stream instead of returning null, so a naive loop never
            // terminates. Verified against the runtime on 2026-07-28.
            nextCursor: events.length === 0 || forward === page.cursor ? null : forward,
        }
    }
}

function toCollection(stream: LogStreamShape, parentId: string): ChildCollection {
    const name = stream.logStreamName ?? ''
    return {
        id: name,
        name,
        parentId,
        createdAt: createdAtOf(stream),
        metadata: {
            arn: stream.arn,
            storedBytes: stream.storedBytes ?? 0,
            firstEventTimestamp: stream.firstEventTimestamp
                ? new Date(stream.firstEventTimestamp).toISOString()
                : null,
            lastEventTimestamp: stream.lastEventTimestamp
                ? new Date(stream.lastEventTimestamp).toISOString()
                : null,
        },
    }
}

function toResource(group: LogGroupShape): CloudResource {
    const name = group.logGroupName ?? ''
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'logs',
        type: 'log-group',
        region: null,
        createdAt: createdAtOf(group),
        metadata: {
            arn: group.arn,
            storedBytes: group.storedBytes ?? 0,
            metricFilterCount: group.metricFilterCount ?? 0,
            retentionInDays: group.retentionInDays ?? null,
        },
    }
}
