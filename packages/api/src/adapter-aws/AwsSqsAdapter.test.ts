import {describe, expect, test} from 'bun:test'
import {
    CreateQueueCommand,
    DeleteQueueCommand,
    GetQueueAttributesCommand,
    GetQueueUrlCommand,
    ListQueuesCommand,
    type SQSClient,
} from '@aws-sdk/client-sqs'
import {AwsSqsAdapter} from './AwsSqsAdapter'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

const BASE = 'http://localhost:4566/000000000000'

/** Attribute shape captured from Floci core. */
const ORDERS_ATTRIBUTES = {
    QueueArn: 'arn:aws:sqs:us-east-1:000000000000:orders-queue',
    ApproximateNumberOfMessages: '4',
    ApproximateNumberOfMessagesNotVisible: '1',
    VisibilityTimeout: '30',
    MessageRetentionPeriod: '345600',
    MaximumMessageSize: '1048576',
    DelaySeconds: '0',
    CreatedTimestamp: '1785177503',
    LastModifiedTimestamp: '1785177503',
}

function stubSqs(handlers: {
    queues?: string[]
    attributes?: Record<string, string>
    missingQueue?: boolean
} = {}) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            if (command instanceof ListQueuesCommand) {
                return {QueueUrls: handlers.queues ?? [`${BASE}/orders-queue`]}
            }
            if (command instanceof GetQueueUrlCommand) {
                if (handlers.missingQueue) {
                    const err = new Error('The specified queue does not exist')
                    err.name = 'QueueDoesNotExist'
                    throw err
                }
                return {QueueUrl: `${BASE}/${(command as GetQueueUrlCommand).input.QueueName}`}
            }
            if (command instanceof GetQueueAttributesCommand) {
                return {Attributes: handlers.attributes ?? ORDERS_ATTRIBUTES}
            }
            if (command instanceof CreateQueueCommand) {
                return {QueueUrl: `${BASE}/${(command as CreateQueueCommand).input.QueueName}`}
            }
            return {}
        },
    } as unknown as SQSClient
    return {client, sent}
}

describe('AwsSqsAdapter', () => {
    test('identifies itself as the AWS messaging adapter', () => {
        const adapter = new AwsSqsAdapter(stubSqs().client)
        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('messaging')
        expect(adapter.schema().displayName).toBe('AWS SQS')
    })

    test('uses the queue name as the id, not the URL', async () => {
        // A URL embeds the endpoint and changes if the runtime is re-pointed,
        // which would make resource links unstable.
        const {client} = stubSqs()
        const [resource] = await new AwsSqsAdapter(client).list()

        expect(resource?.id).toBe('orders-queue')
        expect(resource?.name).toBe('orders-queue')
        expect(resource?.metadata.queueUrl).toBe(`${BASE}/orders-queue`)
    })

    test('normalizes queue attributes', async () => {
        const {client} = stubSqs()
        const [resource] = await new AwsSqsAdapter(client).list()

        expect(resource).toMatchObject({cloud: 'aws', service: 'messaging', type: 'queue'})
        expect(resource?.metadata.arn).toBe('arn:aws:sqs:us-east-1:000000000000:orders-queue')
        expect(resource?.metadata.approximateMessages).toBe(4)
        expect(resource?.metadata.messagesInFlight).toBe(1)
        expect(resource?.metadata.visibilityTimeout).toBe(30)
    })

    test('converts SQS epoch-second timestamps to ISO', async () => {
        const {client} = stubSqs()
        const [resource] = await new AwsSqsAdapter(client).list()

        expect(resource?.createdAt).toBe(new Date(1785177503 * 1000).toISOString())
    })

    test('marks a FIFO queue with its own type', async () => {
        const {client} = stubSqs({attributes: {...ORDERS_ATTRIBUTES, FifoQueue: 'true'}})
        const [resource] = await new AwsSqsAdapter(client).list()

        expect(resource?.type).toBe('fifo-queue')
    })

    test('still lists a queue whose attributes cannot be read', async () => {
        // A describe failure should not blank the whole list.
        const client = {
            async send(command: object) {
                if (command instanceof ListQueuesCommand) return {QueueUrls: [`${BASE}/orders-queue`]}
                throw new Error('AccessDenied')
            },
        } as unknown as SQSClient

        const [resource] = await new AwsSqsAdapter(client).list()
        expect(resource?.id).toBe('orders-queue')
        expect(resource?.metadata.arn).toBeUndefined()
    })

    test('handles an empty queue list', async () => {
        const {client} = stubSqs({queues: []})
        await expect(new AwsSqsAdapter(client).list()).resolves.toEqual([])
    })

    test('filters the list by search term', async () => {
        const {client} = stubSqs({queues: [`${BASE}/orders-queue`, `${BASE}/dead-letter-queue`]})
        const adapter = new AwsSqsAdapter(client)

        await expect(adapter.list({search: 'orders'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'queue'})).resolves.toHaveLength(2)
    })

    test('resolves a name to a URL when inspecting', async () => {
        const {client, sent} = stubSqs()
        const resource = await new AwsSqsAdapter(client).get('orders-queue')

        expect(sent[0]).toBeInstanceOf(GetQueueUrlCommand)
        expect(resource?.id).toBe('orders-queue')
    })

    test('returns null for a queue that does not exist', async () => {
        const {client} = stubSqs({missingQueue: true})
        await expect(new AwsSqsAdapter(client).get('nope')).resolves.toBeNull()
    })

    test('creates a queue with optional attributes', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).create({
            values: {queueName: 'orders-queue', visibilityTimeout: '60', messageRetentionPeriod: '600'},
        })

        const command = sent[0] as CreateQueueCommand
        expect(command).toBeInstanceOf(CreateQueueCommand)
        expect(command.input.QueueName).toBe('orders-queue')
        expect(command.input.Attributes).toEqual({VisibilityTimeout: '60', MessageRetentionPeriod: '600'})
    })

    test('omits the attributes block when nothing was supplied', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).create({values: {queueName: 'orders-queue'}})

        expect((sent[0] as CreateQueueCommand).input.Attributes).toBeUndefined()
    })

    test('requires a queue name', async () => {
        const {client} = stubSqs()
        await expect(new AwsSqsAdapter(client).create({values: {}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('rejects a name SQS would refuse but accepts a FIFO name', async () => {
        const adapter = new AwsSqsAdapter(stubSqs().client)

        for (const name of ['has space', 'has/slash', 'a'.repeat(81), 'plain.name']) {
            await expect(adapter.create({values: {queueName: name}})).rejects.toBeInstanceOf(ValidationError)
        }
        await expect(adapter.create({values: {queueName: 'orders.fifo'}})).resolves.toBeDefined()
    })

    test('sets FifoQueue when the name ends in .fifo', async () => {
        // Real SQS rejects a .fifo create without this attribute. Floci core
        // infers it from the suffix, so a stub or the emulator alone would not
        // catch its absence.
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).create({values: {queueName: 'orders.fifo'}})

        expect((sent[0] as CreateQueueCommand).input.Attributes).toEqual({FifoQueue: 'true'})
    })

    test('does not set FifoQueue for a standard queue', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).create({values: {queueName: 'orders-queue'}})

        expect((sent[0] as CreateQueueCommand).input.Attributes).toBeUndefined()
    })

    test('deletes a queue by resolving its URL first', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).delete('orders-queue')

        expect(sent[0]).toBeInstanceOf(GetQueueUrlCommand)
        expect((sent[1] as DeleteQueueCommand).input.QueueUrl).toBe(`${BASE}/orders-queue`)
    })

    test('reports a missing queue on delete rather than silently succeeding', async () => {
        const {client} = stubSqs({missingQueue: true})
        await expect(new AwsSqsAdapter(client).delete('nope')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('health lists queues without describing each one', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).health()

        expect(sent).toHaveLength(1)
        expect(sent[0]).toBeInstanceOf(ListQueuesCommand)
    })

    /**
     * Bounds are SQS's own. Without them a non-numeric value only fails at the
     * CreateQueue call, so the form reports a runtime error instead of a field error.
     */
    test('rejects out-of-range and non-numeric queue attributes', async () => {
        const {client} = stubSqs()
        const adapter = new AwsSqsAdapter(client)

        await expect(
            adapter.create({values: {queueName: 'q', visibilityTimeout: 'soon'}}),
        ).rejects.toThrow(ValidationError)
        await expect(
            adapter.create({values: {queueName: 'q', visibilityTimeout: '43201'}}),
        ).rejects.toThrow(ValidationError)
        await expect(
            adapter.create({values: {queueName: 'q', messageRetentionPeriod: '59'}}),
        ).rejects.toThrow(ValidationError)
    })

    test('accepts attributes inside the SQS range and omits blanks', async () => {
        const {client, sent} = stubSqs()

        await new AwsSqsAdapter(client).create({
            values: {queueName: 'q', visibilityTimeout: '30', messageRetentionPeriod: ''},
        })

        const create = sent.find((command) => command instanceof CreateQueueCommand)
        expect(create?.input.Attributes).toEqual({VisibilityTimeout: '30'})
    })
})
