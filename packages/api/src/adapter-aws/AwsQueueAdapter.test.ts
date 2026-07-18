import {describe, expect, test, vi} from 'bun:test'
import {
    CreateQueueCommand,
    DeleteMessageCommand,
    DeleteQueueCommand,
    GetQueueAttributesCommand,
    ListQueuesCommand,
    PurgeQueueCommand,
    ReceiveMessageCommand,
    SendMessageCommand,
    type SQSClient,
} from '@aws-sdk/client-sqs'
import {AwsQueueAdapter} from './AwsQueueAdapter'

function mockSqs(handler: (command: unknown) => unknown): SQSClient {
    return {send: vi.fn(handler)} as unknown as SQSClient
}

const QUEUE_URL = 'http://localhost:4566/000000000000/orders-queue'

describe('AwsQueueAdapter', () => {
    test('lists queues and normalizes them to queue resources', async () => {
        const sqs = mockSqs((command) => {
            if (command instanceof ListQueuesCommand) {
                return {QueueUrls: [QUEUE_URL, 'http://localhost:4566/000000000000/notifications-queue']}
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const resources = await adapter.list()

        expect(resources).toHaveLength(2)
        expect(resources[0]).toMatchObject({
            id: 'orders-queue',
            name: 'orders-queue',
            cloud: 'aws',
            service: 'queue',
            type: 'queue',
        })
        expect(resources[0].metadata).toMatchObject({queueService: 'sqs'})
    })

    test('filters listed queues by search term', async () => {
        const sqs = mockSqs((command) => {
            if (command instanceof ListQueuesCommand) {
                return {QueueUrls: [QUEUE_URL, 'http://localhost:4566/000000000000/notifications-queue']}
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const resources = await adapter.list({search: 'order'})

        expect(resources).toHaveLength(1)
        expect(resources[0].name).toBe('orders-queue')
    })

    test('creates a queue and returns the resource with the queue url', async () => {
        const sqs = mockSqs((command) => {
            if (command instanceof CreateQueueCommand) {
                return {QueueUrl: QUEUE_URL}
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const resource = await adapter.create({values: {queueName: 'orders-queue'}})

        expect(resource).toMatchObject({id: 'orders-queue', name: 'orders-queue', type: 'queue'})
    })

    test('appends .fifo and sets FifoQueue when the FIFO option is selected', async () => {
        let captured: unknown
        const sqs = mockSqs((command) => {
            if (command instanceof CreateQueueCommand) {
                captured = command
                return {QueueUrl: 'http://localhost:4566/000000000000/orders.fifo'}
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const resource = await adapter.create({values: {queueName: 'orders', fifoQueue: 'true'}})

        const command = captured as CreateQueueCommand
        expect(command.input.QueueName).toBe('orders.fifo')
        expect(command.input.Attributes?.FifoQueue).toBe('true')
        expect(resource.name).toBe('orders.fifo')
    })

    test('accepts an explicit .fifo queue name without double-suffixing', async () => {
        let captured: unknown
        const sqs = mockSqs((command) => {
            if (command instanceof CreateQueueCommand) {
                captured = command
                return {QueueUrl: 'http://localhost:4566/000000000000/orders.fifo'}
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        await adapter.create({values: {queueName: 'orders.fifo', fifoQueue: 'true'}})

        const command = captured as CreateQueueCommand
        expect(command.input.QueueName).toBe('orders.fifo')
    })

    test('rejects create without a queue name', async () => {
        const sqs = mockSqs(() => ({}))
        const adapter = new AwsQueueAdapter(sqs)

        await expect(adapter.create({values: {}})).rejects.toThrow('queueName is required')
    })

    test('rejects invalid queue names', async () => {
        const sqs = mockSqs(() => ({}))
        const adapter = new AwsQueueAdapter(sqs)

        await expect(adapter.create({values: {queueName: 'bad name!'}})).rejects.toThrow('Use a valid SQS queue name')
    })

    test('deletes a queue by url', async () => {
        let captured: unknown
        const send = vi.fn(async (command: unknown) => {
            captured = command
            return {}
        })
        const sqs = {send} as unknown as SQSClient
        const adapter = new AwsQueueAdapter(sqs)

        await adapter.delete(QUEUE_URL)

        expect(send).toHaveBeenCalledWith(expect.any(DeleteQueueCommand))
        const command = captured as DeleteQueueCommand
        expect(command.input.QueueUrl).toBe(QUEUE_URL)
    })

    test('get returns enriched attributes when available', async () => {
        const sqs = mockSqs((command) => {
            if (command instanceof GetQueueAttributesCommand) {
                return {
                    Attributes: {
                        CreatedTimestamp: '1700000000',
                        ApproximateNumberOfMessages: '5',
                    },
                }
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const resource = await adapter.get(QUEUE_URL)

        expect(resource?.createdAt).toBe(new Date(1700000000 * 1000).toISOString())
        expect(resource?.metadata.approximateNumberOfMessages).toBe('5')
    })

    test('get falls back to a basic resource when attributes are unavailable', async () => {
        const sqs = mockSqs((command) => {
            if (command instanceof GetQueueAttributesCommand) throw new Error('NotFound')
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const resource = await adapter.get(QUEUE_URL)

        expect(resource).toMatchObject({id: 'orders-queue', name: 'orders-queue', type: 'queue'})
    })

    test('receives messages and normalizes them', async () => {
        let captured: unknown
        const sqs = mockSqs((command) => {
            if (command instanceof ReceiveMessageCommand) {
                captured = command
                return {
                    Messages: [
                        {
                            MessageId: 'msg-1',
                            Body: 'hello',
                            ReceiptHandle: 'rh-1',
                            MD5OfBody: 'abc',
                            Attributes: {SentTimestamp: '1700000000000'},
                        },
                    ],
                }
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const messages = await adapter.receiveMessages(QUEUE_URL, 10)

        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
            messageId: 'msg-1',
            body: 'hello',
            receiptHandle: 'rh-1',
            md5OfBody: 'abc',
        })
        expect(messages[0].attributes).toMatchObject({SentTimestamp: '1700000000000'})

        const command = captured as ReceiveMessageCommand
        expect(command.input.VisibilityTimeout).toBe(0)
    })

    test('returns an empty list when the queue has no messages', async () => {
        const sqs = mockSqs((command) => {
            if (command instanceof ReceiveMessageCommand) return {}
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        const messages = await adapter.receiveMessages(QUEUE_URL)

        expect(messages).toEqual([])
    })

    test('deletes a single message by receipt handle', async () => {
        let captured: unknown
        const send = vi.fn(async (command: unknown) => {
            captured = command
            return {}
        })
        const sqs = {send} as unknown as SQSClient
        const adapter = new AwsQueueAdapter(sqs)

        await adapter.deleteMessage(QUEUE_URL, 'receipt-handle-1')

        expect(send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand))
        const command = captured as DeleteMessageCommand
        expect(command.input.QueueUrl).toBe(QUEUE_URL)
        expect(command.input.ReceiptHandle).toBe('receipt-handle-1')
    })

    test('purges all messages from a queue', async () => {
        let captured: unknown
        const send = vi.fn(async (command: unknown) => {
            captured = command
            return {}
        })
        const sqs = {send} as unknown as SQSClient
        const adapter = new AwsQueueAdapter(sqs)

        await adapter.purgeQueue(QUEUE_URL)

        expect(send).toHaveBeenCalledWith(expect.any(PurgeQueueCommand))
        const command = captured as PurgeQueueCommand
        expect(command.input.QueueUrl).toBe(QUEUE_URL)
    })

    test('sets MessageGroupId when sending to a FIFO queue', async () => {
        let captured: unknown
        const sqs = mockSqs((command) => {
            if (command instanceof SendMessageCommand) {
                captured = command
                return {MessageId: 'msg-fifo', MD5OfMessageBody: 'def'}
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        await adapter.sendMessage('orders.fifo', 'hello')

        const command = captured as SendMessageCommand
        expect(command.input.MessageGroupId).toBe('orders')
    })

    test('omits MessageGroupId when sending to a standard queue', async () => {
        let captured: unknown
        const sqs = mockSqs((command) => {
            if (command instanceof SendMessageCommand) {
                captured = command
                return {MessageId: 'msg-std', MD5OfMessageBody: 'def'}
            }
            return {}
        })

        const adapter = new AwsQueueAdapter(sqs)
        await adapter.sendMessage('orders-queue', 'hello')

        const command = captured as SendMessageCommand
        expect(command.input.MessageGroupId).toBeUndefined()
    })
})
