import {describe, expect, test} from 'bun:test'
import {
    CreateStreamCommand,
    DeleteStreamCommand,
    DescribeStreamSummaryCommand,
    ListStreamsCommand,
    type KinesisClient,
    type StreamDescriptionSummary,
} from '@aws-sdk/client-kinesis'
import {ValidationError} from '../cloud-spi/errors'
import {AwsKinesisAdapter} from './AwsKinesisAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

const ORDERS_SUMMARY: StreamDescriptionSummary = {
    StreamName: 'orders',
    StreamARN: 'arn:aws:kinesis:eu-west-1:000000000000:stream/orders',
    StreamStatus: 'ACTIVE',
    StreamModeDetails: {StreamMode: 'PROVISIONED'},
    RetentionPeriodHours: 24,
    StreamCreationTimestamp: new Date('2026-09-19T00:00:00.000Z'),
    EnhancedMonitoring: [],
    EncryptionType: 'KMS',
    KeyId: 'alias/orders',
    OpenShardCount: 2,
    ConsumerCount: 1,
    MaxRecordSizeInKiB: 1024,
}

describe('AwsKinesisAdapter', () => {
    test('identifies Kinesis as the AWS streams adapter', () => {
        const adapter = createAdapter()

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('streams')
        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'streams', displayName: 'Kinesis'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'inspect', 'delete'])
    })

    test('follows modern NextToken pagination and describes each stream', async () => {
        const listInputs: Array<{NextToken?: string}> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListStreamsCommand) {
                listInputs.push(command.input)
                return command.input.NextToken
                    ? {StreamNames: ['billing'], HasMoreStreams: false}
                    : {StreamNames: ['orders'], HasMoreStreams: true, NextToken: 'page-2'}
            }
            if (command instanceof DescribeStreamSummaryCommand) {
                return {StreamDescriptionSummary: summary(command.input.StreamName ?? '')}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        await expect(adapter.list()).resolves.toMatchObject([{name: 'orders'}, {name: 'billing'}])
        expect(listInputs.map((input) => input.NextToken)).toEqual([undefined, 'page-2'])
    })

    test('supports the Floci HasMoreStreams continuation contract', async () => {
        const starts: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListStreamsCommand) {
                starts.push(command.input.ExclusiveStartStreamName)
                return command.input.ExclusiveStartStreamName
                    ? {StreamNames: ['billing'], HasMoreStreams: false}
                    : {StreamNames: ['orders'], HasMoreStreams: true}
            }
            if (command instanceof DescribeStreamSummaryCommand) {
                return {StreamDescriptionSummary: summary(command.input.StreamName ?? '')}
            }
            return {}
        })

        await expect(adapter.list()).resolves.toHaveLength(2)
        expect(starts).toEqual([undefined, 'orders'])
    })

    test('filters names before issuing summary requests', async () => {
        const described: string[] = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListStreamsCommand) {
                return {StreamNames: ['orders', 'audit'], HasMoreStreams: false}
            }
            if (command instanceof DescribeStreamSummaryCommand) {
                const name = command.input.StreamName ?? ''
                described.push(name)
                return {StreamDescriptionSummary: summary(name)}
            }
            return {}
        })

        await expect(adapter.list({search: 'ord'})).resolves.toMatchObject([{name: 'orders'}])
        expect(described).toEqual(['orders'])
    })

    test('describes streams in bounded batches', async () => {
        let activeDescriptions = 0
        let maximumActiveDescriptions = 0
        const streamNames = Array.from({length: 21}, (_, index) => `stream-${index}`)
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListStreamsCommand) {
                return {StreamNames: streamNames, HasMoreStreams: false}
            }
            if (command instanceof DescribeStreamSummaryCommand) {
                activeDescriptions += 1
                maximumActiveDescriptions = Math.max(maximumActiveDescriptions, activeDescriptions)
                await Promise.resolve()
                activeDescriptions -= 1
                return {StreamDescriptionSummary: summary(command.input.StreamName ?? '')}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resources = await adapter.list()

        expect(resources).toHaveLength(21)
        expect(maximumActiveDescriptions).toBe(10)
    })

    test('normalizes the stream summary metadata', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListStreamsCommand) return {StreamNames: ['orders'], HasMoreStreams: false}
            return {StreamDescriptionSummary: ORDERS_SUMMARY}
        })

        const [resource] = await adapter.list()

        expect(resource).toMatchObject({
            id: 'orders',
            name: 'orders',
            service: 'streams',
            type: 'kinesis-stream',
            region: 'eu-west-1',
            status: 'ACTIVE',
            createdAt: '2026-09-19T00:00:00.000Z',
            metadata: {
                arn: ORDERS_SUMMARY.StreamARN,
                streamMode: 'PROVISIONED',
                openShardCount: 2,
                retentionPeriodHours: 24,
                encryptionType: 'KMS',
                consumerCount: 1,
                maxRecordSizeInKiB: 1024,
            },
        })
    })

    test('inspects a stream and returns null when it is missing', async () => {
        const adapter = createAdapter(async (command) => {
            expect(command).toBeInstanceOf(DescribeStreamSummaryCommand)
            return {StreamDescriptionSummary: ORDERS_SUMMARY}
        })
        await expect(adapter.get('orders')).resolves.toMatchObject({name: 'orders'})

        const missing = createAdapter(async () => {
            throw Object.assign(new Error('missing'), {name: 'ResourceNotFoundException'})
        })
        await expect(missing.get('missing')).resolves.toBeNull()
    })

    test('creates a provisioned stream with a positive shard count', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            if (command instanceof CreateStreamCommand) return {}
            return {StreamDescriptionSummary: ORDERS_SUMMARY}
        })

        await expect(adapter.create({values: {name: 'orders', streamMode: 'PROVISIONED', shardCount: '2'}}))
            .resolves.toMatchObject({name: 'orders', metadata: {openShardCount: 2}})

        expect((sent[0] as CreateStreamCommand).input).toEqual({
            StreamName: 'orders',
            StreamModeDetails: {StreamMode: 'PROVISIONED'},
            ShardCount: 2,
        })
        expect(sent[1]).toBeInstanceOf(DescribeStreamSummaryCommand)
    })

    test('creates an on-demand stream without sending ShardCount', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            if (command instanceof CreateStreamCommand) return {}
            return {StreamDescriptionSummary: {...ORDERS_SUMMARY, StreamModeDetails: {StreamMode: 'ON_DEMAND'}}}
        })

        await adapter.create({values: {name: 'orders', streamMode: 'ON_DEMAND', shardCount: '9'}})

        expect((sent[0] as CreateStreamCommand).input).toEqual({
            StreamName: 'orders',
            StreamModeDetails: {StreamMode: 'ON_DEMAND'},
        })
    })

    test('defaults provisioned streams to one shard', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            if (command instanceof CreateStreamCommand) return {}
            return {StreamDescriptionSummary: ORDERS_SUMMARY}
        })

        await adapter.create({values: {name: 'orders'}})

        expect((sent[0] as CreateStreamCommand).input.ShardCount).toBe(1)
    })

    test('validates stream names, modes, and shard counts before calling Kinesis', async () => {
        const adapter = createAdapter()

        for (const name of ['', 'has space', ' orders ', 'a'.repeat(129)]) {
            await expect(adapter.create({values: {name}})).rejects.toBeInstanceOf(ValidationError)
        }
        await expect(adapter.create({values: {name: 'orders', streamMode: 'AUTO'}}))
            .rejects.toBeInstanceOf(ValidationError)
        for (const shardCount of ['0', '-1', '1.5', 'many']) {
            await expect(adapter.create({values: {name: 'orders', shardCount}}))
                .rejects.toBeInstanceOf(ValidationError)
        }
    })

    test('deletes a stream by name', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        await adapter.delete('orders')

        expect(sent[0]).toBeInstanceOf(DeleteStreamCommand)
        expect((sent[0] as DeleteStreamCommand).input.StreamName).toBe('orders')
    })

    test('health checks only the list operation', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {StreamNames: [], HasMoreStreams: false}
        })

        await adapter.health()

        expect(sent).toHaveLength(1)
        expect(sent[0]).toBeInstanceOf(ListStreamsCommand)
        expect((sent[0] as ListStreamsCommand).input.Limit).toBe(1)
    })
})

function summary(name: string): StreamDescriptionSummary {
    return {
        ...ORDERS_SUMMARY,
        StreamName: name,
        StreamARN: `arn:aws:kinesis:us-east-1:000000000000:stream/${name}`,
    }
}

function createAdapter(handler: SendHandler = async () => ({StreamNames: [], HasMoreStreams: false})): AwsKinesisAdapter {
    return new AwsKinesisAdapter({send: handler} as unknown as KinesisClient)
}
