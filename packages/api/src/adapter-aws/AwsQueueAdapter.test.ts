import {describe, expect, test} from 'bun:test'
import {AwsQueueAdapter} from './AwsQueueAdapter'

const QUEUE_URL = 'http://localhost:4566/000000000000/orders'

function fakeSqs(overrides: Record<string, (input: unknown) => unknown> = {}) {
    return {
        async send(command: {constructor: {name: string}; input: unknown}) {
            const handler = overrides[command.constructor.name]
            if (handler) return handler(command.input)

            switch (command.constructor.name) {
                case 'ListQueuesCommand':
                    return {QueueUrls: [QUEUE_URL]}
                case 'GetQueueAttributesCommand':
                    return {
                        Attributes: {
                            QueueArn: 'arn:aws:sqs:us-east-1:000000000000:orders',
                            ApproximateNumberOfMessages: '3',
                            ApproximateNumberOfMessagesNotVisible: '1',
                            ApproximateNumberOfMessagesDelayed: '0',
                            CreatedTimestamp: '1700000000',
                            FifoQueue: 'false',
                        },
                    }
                default:
                    throw new Error(`Unhandled command: ${command.constructor.name}`)
            }
        },
    } as never
}

describe('AwsQueueAdapter', () => {
    test('list returns mapped CloudResource array with message counts in metadata', async () => {
        const adapter = new AwsQueueAdapter(fakeSqs())
        const result = await adapter.list()

        expect(result).toHaveLength(1)
        expect(result[0].id).toBe(QUEUE_URL)
        expect(result[0].name).toBe('orders')
        expect(result[0].cloud).toBe('aws')
        expect(result[0].service).toBe('queue')
        expect(result[0].type).toBe('queue')
        expect(result[0].metadata.messagesAvailable).toBe(3)
        expect(result[0].metadata.messagesInFlight).toBe(1)
    })

    test('list filters results by search term', async () => {
        const adapter = new AwsQueueAdapter(fakeSqs({
            ListQueuesCommand: () => ({QueueUrls: [QUEUE_URL, `${QUEUE_URL}-dlq`]}),
        }))

        const result = await adapter.list({search: 'orders-dlq'})

        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('orders-dlq')
    })

    test('create builds a queue and returns the mapped resource', async () => {
        const adapter = new AwsQueueAdapter(fakeSqs({
            CreateQueueCommand: () => ({QueueUrl: QUEUE_URL}),
        }))

        const resource = await adapter.create({values: {queueName: 'orders'}})

        expect(resource.id).toBe(QUEUE_URL)
        expect(resource.name).toBe('orders')
    })

    test('create rejects a missing queueName', async () => {
        const adapter = new AwsQueueAdapter(fakeSqs())
        await expect(adapter.create({values: {}})).rejects.toThrow('queueName is required')
    })

    test('sendMessage returns the message id from the SDK response', async () => {
        const adapter = new AwsQueueAdapter(fakeSqs({
            SendMessageCommand: () => ({MessageId: 'msg-1'}),
        }))

        const message = await adapter.sendMessage(QUEUE_URL, '{"hello":"world"}')

        expect(message.id).toBe('msg-1')
        expect(message.body).toBe('{"hello":"world"}')
    })

    test('receiveMessages maps SDK messages into QueueMessage records', async () => {
        const adapter = new AwsQueueAdapter(fakeSqs({
            ReceiveMessageCommand: () => ({
                Messages: [
                    {
                        MessageId: 'msg-1',
                        ReceiptHandle: 'receipt-1',
                        Body: '{"hello":"world"}',
                        Attributes: {SentTimestamp: '1700000000000', ApproximateReceiveCount: '2'},
                        MessageAttributes: {source: {StringValue: 'flow-panel', DataType: 'String'}},
                    },
                ],
            }),
        }))

        const messages = await adapter.receiveMessages(QUEUE_URL)

        expect(messages).toHaveLength(1)
        expect(messages[0].id).toBe('msg-1')
        expect(messages[0].receiptHandle).toBe('receipt-1')
        expect(messages[0].receiveCount).toBe(2)
        expect(messages[0].messageAttributes.source).toBe('flow-panel')
    })

    test('deleteMessage and purgeQueue delegate to the SDK without throwing', async () => {
        const adapter = new AwsQueueAdapter(fakeSqs({
            DeleteMessageCommand: () => ({}),
            PurgeQueueCommand: () => ({}),
        }))

        await expect(adapter.deleteMessage(QUEUE_URL, 'receipt-1')).resolves.toBeUndefined()
        await expect(adapter.purgeQueue(QUEUE_URL)).resolves.toBeUndefined()
    })
})
