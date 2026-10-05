import {describe, expect, test} from 'bun:test'
import {
    CreateQueueCommand,
    DeleteMessageCommand,
    DeleteQueueCommand,
    GetQueueAttributesCommand,
    GetQueueUrlCommand,
    ListQueuesCommand,
    PurgeQueueCommand,
    ReceiveMessageCommand,
    SendMessageCommand,
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
    messages?: Array<{MessageId: string; Body: string; ReceiptHandle: string}>
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
            if (command instanceof SendMessageCommand) {
                return {MessageId: 'msg-1', MD5OfMessageBody: 'abc123'}
            }
            if (command instanceof ReceiveMessageCommand) {
                return {Messages: handlers.messages ?? []}
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

    test('sends a message by resolving the queue URL first', async () => {
        const {client, sent} = stubSqs()
        const result = await new AwsSqsAdapter(client).sendMessage('orders-queue', 'hello')

        expect(sent[0]).toBeInstanceOf(GetQueueUrlCommand)
        const send = sent[1] as SendMessageCommand
        expect(send).toBeInstanceOf(SendMessageCommand)
        expect(send.input.QueueUrl).toBe(`${BASE}/orders-queue`)
        expect(send.input.MessageBody).toBe('hello')
        expect(send.input.MessageGroupId).toBeUndefined()
        expect(result).toEqual({messageId: 'msg-1', md5OfMessageBody: 'abc123'})
    })

    test('sets MessageGroupId when sending to a FIFO queue', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).sendMessage('orders.fifo', 'hello')

        const send = sent[1] as SendMessageCommand
        expect(send.input.MessageGroupId).toBe('orders')
    })

    test('reports a missing queue on send rather than a runtime error', async () => {
        const {client} = stubSqs({missingQueue: true})
        await expect(new AwsSqsAdapter(client).sendMessage('nope', 'hi')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('receives messages as a non-consuming peek', async () => {
        const {client, sent} = stubSqs({
            messages: [{MessageId: 'msg-1', Body: 'hello', ReceiptHandle: 'handle-1'}],
        })
        const messages = await new AwsSqsAdapter(client).receiveMessages('orders-queue')

        const receive = sent[1] as ReceiveMessageCommand
        expect(receive).toBeInstanceOf(ReceiveMessageCommand)
        expect(receive.input.VisibilityTimeout).toBe(0)
        expect(messages).toEqual([{messageId: 'msg-1', body: 'hello', receiptHandle: 'handle-1', attributes: undefined, md5OfBody: undefined}])
    })

    test('clamps maxMessages to the SQS-documented 1-10 range', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).receiveMessages('orders-queue', 50)
        expect((sent[1] as ReceiveMessageCommand).input.MaxNumberOfMessages).toBe(10)

        await new AwsSqsAdapter(client).receiveMessages('orders-queue', 0)
        expect((sent[3] as ReceiveMessageCommand).input.MaxNumberOfMessages).toBe(1)
    })

    test('deletes a message by receipt handle', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).deleteMessage('orders-queue', 'handle-1')

        expect(sent[0]).toBeInstanceOf(GetQueueUrlCommand)
        const del = sent[1] as DeleteMessageCommand
        expect(del).toBeInstanceOf(DeleteMessageCommand)
        expect(del.input.QueueUrl).toBe(`${BASE}/orders-queue`)
        expect(del.input.ReceiptHandle).toBe('handle-1')
    })

    test('reports a missing queue on message delete rather than silently succeeding', async () => {
        const {client} = stubSqs({missingQueue: true})
        await expect(new AwsSqsAdapter(client).deleteMessage('nope', 'handle-1')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('purges a queue by resolving its URL first', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).purgeQueue('orders-queue')

        expect(sent[0]).toBeInstanceOf(GetQueueUrlCommand)
        expect((sent[1] as PurgeQueueCommand).input.QueueUrl).toBe(`${BASE}/orders-queue`)
    })

    test('reports a missing queue on purge rather than silently succeeding', async () => {
        const {client} = stubSqs({missingQueue: true})
        await expect(new AwsSqsAdapter(client).purgeQueue('nope')).rejects.toBeInstanceOf(NotFoundError)
    })
})
