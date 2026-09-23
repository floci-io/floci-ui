import {
    CreateStreamCommand,
    DeleteStreamCommand,
    DescribeStreamSummaryCommand,
    ListStreamsCommand,
    type CreateStreamCommandInput,
    type KinesisClient,
    type StreamDescriptionSummary,
    type StreamMode,
} from '@aws-sdk/client-kinesis'
import {kinesis as defaultKinesis} from '../aws'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {awsKinesisSchema} from '../cloud-spi/kinesisSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const STREAM_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/
const STREAM_MODES: StreamMode[] = ['PROVISIONED', 'ON_DEMAND']
const DESCRIBE_BATCH_SIZE = 10

/** AWS Kinesis Data Streams through the provider-neutral Streams category. */
export class AwsKinesisAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'streams' as const

    constructor(private readonly kinesis: KinesisClient = defaultKinesis) {}

    schema(): ServiceSchema {
        return awsKinesisSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const names = await this.listStreamNames()
        const filteredNames = filterBySearch(names, query.search)
        const resources: CloudResource[] = []

        for (let index = 0; index < filteredNames.length; index += DESCRIBE_BATCH_SIZE) {
            const batch = filteredNames.slice(index, index + DESCRIBE_BATCH_SIZE)
            const described = await Promise.all(batch.map((name) => this.describe(name)))
            resources.push(...described.filter((resource): resource is CloudResource => resource !== null))
        }

        return resources
    }

    async get(id: string): Promise<CloudResource | null> {
        return this.describe(id)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = streamName(input.values.name)
        const mode = streamMode(input.values.streamMode)
        const commandInput: CreateStreamCommandInput = {
            StreamName: name,
            StreamModeDetails: {StreamMode: mode},
        }

        if (mode === 'PROVISIONED') {
            commandInput.ShardCount = positiveInteger(input.values.shardCount, 'shardCount', 1)
        }

        await this.kinesis.send(new CreateStreamCommand(commandInput))
        return (await this.describe(name)) ?? pendingStreamResource(name, mode, commandInput.ShardCount)
    }

    async delete(id: string): Promise<void> {
        await this.kinesis.send(new DeleteStreamCommand({StreamName: id}))
    }

    /** Stream-name listing avoids the per-stream describe fan-out used by the resource table. */
    async health(): Promise<void> {
        await this.kinesis.send(new ListStreamsCommand({Limit: 1}))
    }

    private async listStreamNames(): Promise<string[]> {
        const names: string[] = []
        let nextToken: string | undefined
        let exclusiveStartStreamName: string | undefined

        do {
            const response = await this.kinesis.send(new ListStreamsCommand(
                nextToken
                    ? {NextToken: nextToken}
                    : exclusiveStartStreamName
                        ? {ExclusiveStartStreamName: exclusiveStartStreamName}
                        : {},
            ))
            const pageNames = response.StreamNames?.length
                ? response.StreamNames
                : (response.StreamSummaries ?? []).flatMap((stream) => stream.StreamName ? [stream.StreamName] : [])
            names.push(...pageNames)

            if (response.NextToken) {
                nextToken = response.NextToken
                exclusiveStartStreamName = undefined
                continue
            }

            nextToken = undefined
            if (!response.HasMoreStreams) {
                exclusiveStartStreamName = undefined
                continue
            }

            const lastName = pageNames.at(-1)
            if (!lastName || lastName === exclusiveStartStreamName) {
                throw new RuntimeError('Kinesis returned HasMoreStreams without a usable continuation point')
            }
            exclusiveStartStreamName = lastName
        } while (nextToken || exclusiveStartStreamName)

        return [...new Set(names)]
    }

    private async describe(name: string): Promise<CloudResource | null> {
        try {
            const response = await this.kinesis.send(new DescribeStreamSummaryCommand({StreamName: name}))
            if (!response.StreamDescriptionSummary) {
                throw new RuntimeError(`Kinesis did not return a summary for stream ${name}`)
            }
            return streamResource(response.StreamDescriptionSummary)
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }
}

function streamResource(summary: StreamDescriptionSummary): CloudResource {
    const name = summary.StreamName ?? ''
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'streams',
        type: 'kinesis-stream',
        region: regionFromArn(summary.StreamARN),
        createdAt: summary.StreamCreationTimestamp?.toISOString() ?? null,
        status: summary.StreamStatus ?? null,
        metadata: {
            provider: 'aws',
            streamsService: 'kinesis',
            arn: summary.StreamARN,
            streamMode: summary.StreamModeDetails?.StreamMode,
            openShardCount: summary.OpenShardCount,
            retentionPeriodHours: summary.RetentionPeriodHours,
            encryptionType: summary.EncryptionType,
            keyId: summary.KeyId,
            consumerCount: summary.ConsumerCount,
            maxRecordSizeInKiB: summary.MaxRecordSizeInKiB,
        },
    }
}

function pendingStreamResource(name: string, mode: StreamMode, shardCount?: number): CloudResource {
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'streams',
        type: 'kinesis-stream',
        region: null,
        createdAt: null,
        status: 'CREATING',
        metadata: {
            provider: 'aws',
            streamsService: 'kinesis',
            streamMode: mode,
            openShardCount: shardCount,
        },
    }
}

function streamName(value: unknown): string {
    const name = typeof value === 'string' ? value : ''
    if (!name) throw new ValidationError('name is required')
    if (!STREAM_NAME_PATTERN.test(name)) {
        throw new ValidationError('Use a valid Kinesis stream name: 1-128 letters, numbers, underscores, hyphens, or periods.')
    }
    return name
}

function streamMode(value: unknown): StreamMode {
    const mode = stringValue(value) || 'PROVISIONED'
    if (!STREAM_MODES.includes(mode as StreamMode)) {
        throw new ValidationError(`streamMode must be one of ${STREAM_MODES.join(', ')}`)
    }
    return mode as StreamMode
}

function positiveInteger(value: unknown, field: string, defaultValue: number): number {
    if (value === undefined || value === null || value === '') return defaultValue
    const parsed = typeof value === 'number' ? value : Number(stringValue(value))
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ValidationError(`${field} must be a positive whole number`)
    }
    return parsed
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(names: string[], search?: string): string[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return names
    return names.filter((name) => name.toLowerCase().includes(normalized))
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const candidate = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return candidate.name === 'ResourceNotFoundException' || candidate.$metadata?.httpStatusCode === 404
}
