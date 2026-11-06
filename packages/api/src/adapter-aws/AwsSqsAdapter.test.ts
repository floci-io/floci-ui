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
    SetQueueAttributesCommand,
    type SQSClient,
} from '@aws-sdk/client-sqs'
import {AwsSqsAdapter} from './AwsSqsAdapter'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {awsMessagingSchema, sqsValidations} from '../cloud-spi/messagingSchema'

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
    messages?: Array<{
        MessageId: string
        Body: string
        ReceiptHandle: string
        MessageAttributes?: Record<string, {DataType: string; StringValue?: string; BinaryValue?: Uint8Array}>
    }>
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
            if (command instanceof SetQueueAttributesCommand) {
                return {}
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

    test('declares update in schema actions, capabilities, and updateFields with shared validations', () => {
        const schema = new AwsSqsAdapter(stubSqs().client).schema()
        expect(schema.actions).toContain('update')
        expect(schema.capabilities?.resourceActions?.some((a) => a.name === 'update')).toBe(true)
        expect(schema.updateFields?.map((f) => f.name)).toEqual([
            'visibilityTimeout',
            'messageRetentionPeriod',
            'delaySeconds',
            'maximumMessageSizeKb',
            'receiveMessageWaitTimeSeconds',
        ])
        for (const updateField of schema.updateFields ?? []) {
            const createField = schema.fields.find((f) => f.name === updateField.name)
            expect(createField).toBeDefined()
            expect(updateField.validation).toBe(createField?.validation)
            expect(updateField.validation).toBe(sqsValidations[updateField.name as keyof typeof sqsValidations])
            expect(updateField.valuePath).toBe(`metadata.${updateField.name}`)
        }
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
        expect(resource?.metadata.messageRetentionPeriod).toBe(345600)
        expect(resource?.metadata.maximumMessageSize).toBe(1048576)
        expect(resource?.metadata.delaySeconds).toBe(0)
    })

    test('normalizes receiveMessageWaitTimeSeconds when present', async () => {
        const {client} = stubSqs({
            attributes: {...ORDERS_ATTRIBUTES, ReceiveMessageWaitTimeSeconds: '15'},
        })
        const [resource] = await new AwsSqsAdapter(client).list()
        expect(resource?.metadata.receiveMessageWaitTimeSeconds).toBe(15)
    })

    test('normalizes maximumMessageSizeKb in resource metadata', async () => {
        const {client} = stubSqs({
            attributes: {...ORDERS_ATTRIBUTES, MaximumMessageSize: '262144'},
        })
        const [resource] = await new AwsSqsAdapter(client).list()
        expect(resource?.metadata.maximumMessageSize).toBe(262144)
        expect(resource?.metadata.maximumMessageSizeKb).toBe(256)
    })

    test('leaves maximumMessageSizeKb blank when the size is not a whole number of KB', async () => {
        const {client} = stubSqs({
            attributes: {...ORDERS_ATTRIBUTES, MaximumMessageSize: '1536'},
        })
        const [resource] = await new AwsSqsAdapter(client).list()
        expect(resource?.metadata.maximumMessageSize).toBe(1536)
        expect(resource?.metadata.maximumMessageSizeKb).toBeNull()
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
            values: {
                queueName: 'orders-queue',
                visibilityTimeout: '60',
                messageRetentionPeriod: '600',
                delaySeconds: '10',
                maximumMessageSize: '65536',
                receiveMessageWaitTimeSeconds: '5',
            },
        })

        const command = sent[0] as CreateQueueCommand
        expect(command).toBeInstanceOf(CreateQueueCommand)
        expect(command.input.QueueName).toBe('orders-queue')
        expect(command.input.Attributes).toEqual({
            VisibilityTimeout: '60',
            MessageRetentionPeriod: '600',
            DelaySeconds: '10',
            MaximumMessageSize: '65536',
            ReceiveMessageWaitTimeSeconds: '5',
        })
    })

    test('resolves maximumMessageSize from KB (schema field) and raw bytes (direct calls)', async () => {
        // UI field maximumMessageSizeKb
        const {client: client1, sent: sent1} = stubSqs()
        await new AwsSqsAdapter(client1).create({
            values: {
                queueName: 'orders-queue',
                maximumMessageSizeKb: '1',
            },
        })
        const cmd1 = sent1.find((c) => c instanceof CreateQueueCommand) as CreateQueueCommand
        expect(cmd1.input.Attributes?.MaximumMessageSize).toBe('1024')

        const {client: client2, sent: sent2} = stubSqs()
        await new AwsSqsAdapter(client2).create({
            values: {
                queueName: 'orders-queue',
                maximumMessageSizeKb: '1024',
            },
        })
        const cmd2 = sent2.find((c) => c instanceof CreateQueueCommand) as CreateQueueCommand
        expect(cmd2.input.Attributes?.MaximumMessageSize).toBe('1048576')

        // Direct API call: raw bytes without unit (1024 means 1024 bytes / 1 KiB, not 1 MiB)
        const {client: client3, sent: sent3} = stubSqs()
        await new AwsSqsAdapter(client3).create({
            values: {
                queueName: 'orders-queue',
                maximumMessageSize: '1024',
            },
        })
        const cmd3 = sent3.find((c) => c instanceof CreateQueueCommand) as CreateQueueCommand
        expect(cmd3.input.Attributes?.MaximumMessageSize).toBe('1024')
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

    test('updates a single queue attribute', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).update('orders-queue', {
            values: {
                visibilityTimeout: '45',
            },
        })

        expect(sent[0]).toBeInstanceOf(GetQueueUrlCommand)
        const setCommand = sent.find((c) => c instanceof SetQueueAttributesCommand) as SetQueueAttributesCommand
        expect(setCommand).toBeInstanceOf(SetQueueAttributesCommand)
        expect(setCommand.input.QueueUrl).toBe(`${BASE}/orders-queue`)
        expect(setCommand.input.Attributes).toEqual({
            VisibilityTimeout: '45',
        })
    })

    test('updates multiple queue attributes and converts maximumMessageSizeKb to bytes', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).update('orders-queue', {
            values: {
                visibilityTimeout: '60',
                messageRetentionPeriod: '1209600',
                delaySeconds: '15',
                maximumMessageSizeKb: '512',
                receiveMessageWaitTimeSeconds: '10',
            },
        })

        const setCommand = sent.find((c) => c instanceof SetQueueAttributesCommand) as SetQueueAttributesCommand
        expect(setCommand.input.Attributes).toEqual({
            VisibilityTimeout: '60',
            MessageRetentionPeriod: '1209600',
            DelaySeconds: '15',
            MaximumMessageSize: '524288',
            ReceiveMessageWaitTimeSeconds: '10',
        })
    })

    test('updates maximumMessageSize using raw bytes', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).update('orders-queue', {
            values: {
                maximumMessageSize: '65536',
            },
        })

        const setCommand = sent.find((c) => c instanceof SetQueueAttributesCommand) as SetQueueAttributesCommand
        expect(setCommand.input.Attributes).toEqual({
            MaximumMessageSize: '65536',
        })
    })

    test('rejects update with no attributes or empty values', async () => {
        const adapter = new AwsSqsAdapter(stubSqs().client)
        await expect(adapter.update('orders-queue', {values: {}})).rejects.toThrow(
            'At least one queue attribute must be provided to update.',
        )
        await expect(
            adapter.update('orders-queue', {values: {visibilityTimeout: '', delaySeconds: ''}}),
        ).rejects.toThrow('At least one queue attribute must be provided to update.')
    })

    test('rejects out-of-range attributes on update', async () => {
        const adapter = new AwsSqsAdapter(stubSqs().client)
        await expect(
            adapter.update('orders-queue', {values: {visibilityTimeout: '43201'}}),
        ).rejects.toThrow(ValidationError)
        await expect(
            adapter.update('orders-queue', {values: {messageRetentionPeriod: '59'}}),
        ).rejects.toThrow(ValidationError)
        await expect(
            adapter.update('orders-queue', {values: {delaySeconds: '901'}}),
        ).rejects.toThrow(ValidationError)
        await expect(
            adapter.update('orders-queue', {values: {maximumMessageSizeKb: '0'}}),
        ).rejects.toThrow('maximumMessageSizeKb must be between 1 and 1024 KB.')
        await expect(
            adapter.update('orders-queue', {values: {maximumMessageSizeKb: '1025'}}),
        ).rejects.toThrow('maximumMessageSizeKb must be between 1 and 1024 KB.')
        await expect(
            adapter.update('orders-queue', {values: {receiveMessageWaitTimeSeconds: '21'}}),
        ).rejects.toThrow(ValidationError)
    })

    test('reports a missing queue on update rather than a runtime error', async () => {
        const {client} = stubSqs({missingQueue: true})
        await expect(
            new AwsSqsAdapter(client).update('nope', {values: {visibilityTimeout: '30'}}),
        ).rejects.toBeInstanceOf(NotFoundError)
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
        await expect(
            adapter.create({values: {queueName: 'q', delaySeconds: '901'}}),
        ).rejects.toThrow(ValidationError)
        await expect(
            adapter.create({values: {queueName: 'q', maximumMessageSizeKb: '0'}}),
        ).rejects.toThrow('maximumMessageSizeKb must be between 1 and 1024 KB.')
        await expect(
            adapter.create({values: {queueName: 'q', maximumMessageSizeKb: '1025'}}),
        ).rejects.toThrow('maximumMessageSizeKb must be between 1 and 1024 KB.')
        await expect(
            adapter.create({values: {queueName: 'q', maximumMessageSize: '1023'}}),
        ).rejects.toThrow('maximumMessageSize must be between 1024 and 1048576 bytes.')
        await expect(
            adapter.create({values: {queueName: 'q', maximumMessageSize: '1048577'}}),
        ).rejects.toThrow('maximumMessageSize must be between 1024 and 1048576 bytes.')
        await expect(
            adapter.create({values: {queueName: 'q', maximumMessageSize: 'invalid'}}),
        ).rejects.toThrow('maximumMessageSize must be a whole number of bytes between 1024 and 1048576.')
        await expect(
            adapter.create({values: {queueName: 'q', receiveMessageWaitTimeSeconds: '21'}}),
        ).rejects.toThrow(ValidationError)
    })

    test('accepts attributes at min and max SQS boundaries and omits blanks', async () => {
        // Min boundaries
        const {client: minClient, sent: minSent} = stubSqs()
        await new AwsSqsAdapter(minClient).create({
            values: {
                queueName: 'min-queue',
                visibilityTimeout: '0',
                messageRetentionPeriod: '60',
                delaySeconds: '0',
                maximumMessageSizeKb: '1',
                receiveMessageWaitTimeSeconds: '0',
            },
        })
        const minCommand = minSent.find((c) => c instanceof CreateQueueCommand) as CreateQueueCommand
        expect(minCommand.input.Attributes).toEqual({
            VisibilityTimeout: '0',
            MessageRetentionPeriod: '60',
            DelaySeconds: '0',
            MaximumMessageSize: '1024',
            ReceiveMessageWaitTimeSeconds: '0',
        })

        // Max boundaries
        const {client: maxClient, sent: maxSent} = stubSqs()
        await new AwsSqsAdapter(maxClient).create({
            values: {
                queueName: 'max-queue',
                visibilityTimeout: '43200',
                messageRetentionPeriod: '1209600',
                delaySeconds: '900',
                maximumMessageSizeKb: '1024',
                receiveMessageWaitTimeSeconds: '20',
            },
        })
        const maxCommand = maxSent.find((c) => c instanceof CreateQueueCommand) as CreateQueueCommand
        expect(maxCommand.input.Attributes).toEqual({
            VisibilityTimeout: '43200',
            MessageRetentionPeriod: '1209600',
            DelaySeconds: '900',
            MaximumMessageSize: '1048576',
            ReceiveMessageWaitTimeSeconds: '20',
        })

        // Omit blanks
        const {client: blankClient, sent: blankSent} = stubSqs()
        await new AwsSqsAdapter(blankClient).create({
            values: {queueName: 'blank-queue', visibilityTimeout: '30', messageRetentionPeriod: ''},
        })
        const blankCommand = blankSent.find((c) => c instanceof CreateQueueCommand) as CreateQueueCommand
        expect(blankCommand.input.Attributes).toEqual({VisibilityTimeout: '30'})
    })

    test('enforces exact min and max validation patterns on all queue creation and update fields in schema', () => {
        const schema = awsMessagingSchema()
        for (const fieldList of [schema.fields, schema.updateFields!]) {
            const field = (name: string) => fieldList.find((f) => f.name === name)!

            // VisibilityTimeout: 0 to 43200
            const vtPattern = new RegExp(field('visibilityTimeout').validation!.pattern!)
            expect(vtPattern.test('0')).toBe(true)
            expect(vtPattern.test('43200')).toBe(true)
            expect(vtPattern.test('43201')).toBe(false)
            expect(vtPattern.test('-1')).toBe(false)

            // MessageRetentionPeriod: 60 to 1209600
            const retPattern = new RegExp(field('messageRetentionPeriod').validation!.pattern!)
            expect(retPattern.test('59')).toBe(false)
            expect(retPattern.test('60')).toBe(true)
            expect(retPattern.test('1209600')).toBe(true)
            expect(retPattern.test('1209601')).toBe(false)

            // DelaySeconds: 0 to 900
            const delayPattern = new RegExp(field('delaySeconds').validation!.pattern!)
            expect(delayPattern.test('0')).toBe(true)
            expect(delayPattern.test('900')).toBe(true)
            expect(delayPattern.test('901')).toBe(false)

            // MaximumMessageSize: 1 to 1024 KB
            const sizePattern = new RegExp(field('maximumMessageSizeKb').validation!.pattern!)
            expect(sizePattern.test('0')).toBe(false)
            expect(sizePattern.test('1')).toBe(true)
            expect(sizePattern.test('1024')).toBe(true)
            expect(sizePattern.test('1025')).toBe(false)

            // ReceiveMessageWaitTimeSeconds: 0 to 20
            const waitPattern = new RegExp(field('receiveMessageWaitTimeSeconds').validation!.pattern!)
            expect(waitPattern.test('0')).toBe(true)
            expect(waitPattern.test('20')).toBe(true)
            expect(waitPattern.test('21')).toBe(false)
        }
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
        expect(send.input.MessageAttributes).toBeUndefined()
        expect(result).toEqual({messageId: 'msg-1', md5OfMessageBody: 'abc123'})
    })

    test('maps custom attributes to MessageAttributes when sending a message', async () => {
        const {client, sent} = stubSqs()
        await new AwsSqsAdapter(client).sendMessage('orders-queue', 'hello', { foo: 'bar', baz: 'qux' })

        const send = sent[1] as SendMessageCommand
        expect(send.input.MessageAttributes).toEqual({
            foo: { DataType: 'String', StringValue: 'bar' },
            baz: { DataType: 'String', StringValue: 'qux' },
        })
    })

    test('safely maps __proto__ attribute without prototype pollution', async () => {
        const {client, sent} = stubSqs()
        const attributes = JSON.parse('{"__proto__": "polluted", "valid": "data"}')
        await new AwsSqsAdapter(client).sendMessage('orders-queue', 'hello', attributes)

        const send = sent[1] as SendMessageCommand
        expect(send.input.MessageAttributes).toHaveProperty('__proto__')
        expect(send.input.MessageAttributes?.['__proto__']).toEqual({ DataType: 'String', StringValue: 'polluted' })
        expect(send.input.MessageAttributes).toHaveProperty('valid')
        expect(send.input.MessageAttributes?.['valid']).toEqual({ DataType: 'String', StringValue: 'data' })
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
        expect(receive.input.WaitTimeSeconds).toBe(0)
        expect(messages).toEqual([{messageId: 'msg-1', body: 'hello', receiptHandle: 'handle-1', attributes: undefined, messageAttributes: undefined, md5OfBody: undefined}])
    })

    test('maps user-defined MessageAttributes to messageAttributes', async () => {
        const {client} = stubSqs({
            messages: [{
                MessageId: 'msg-2',
                Body: 'test',
                ReceiptHandle: 'handle-2',
                MessageAttributes: {
                    CustomId: {DataType: 'String', StringValue: '1234'},
                    BinaryAttr: {DataType: 'Binary', BinaryValue: new Uint8Array([1, 2])},
                },
            }],
        })
        const messages = await new AwsSqsAdapter(client).receiveMessages('orders-queue')
        expect(messages[0].messageAttributes).toEqual({
            CustomId: {dataType: 'String', value: '1234'},
            BinaryAttr: {dataType: 'Binary', value: '<Binary Data>'},
        })
    })

    test('skips entries with undefined values when mapping received MessageAttributes', async () => {
        const {client} = stubSqs({
            messages: [{
                MessageId: 'msg-3',
                Body: 'test undefined',
                ReceiptHandle: 'handle-3',
                // Simulate an SDK return where a prototype key or a malformed entry has an undefined value
                MessageAttributes: {
                    valid: {DataType: 'String', StringValue: 'present'},
                    ['__proto__']: undefined as any,
                    malformed: undefined as any,
                },
            }],
        })
        const messages = await new AwsSqsAdapter(client).receiveMessages('orders-queue')
        expect(messages[0].messageAttributes).toEqual({
            valid: {dataType: 'String', value: 'present'},
        })
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
