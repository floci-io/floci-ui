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
import {sqs as defaultSqs, defaultAccountId} from '../aws'
import {awsQueueSchema} from '../cloud-spi/queueSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    QueueMessage,
    ResourceQuery,
    SendMessageResult,
    ServiceSchema,
} from '../cloud-spi/types'

export class AwsQueueAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'queue' as const

    constructor(private readonly sqs: SQSClient = defaultSqs) {}

    schema(): ServiceSchema {
        return awsQueueSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const res = await this.sqs.send(new ListQueuesCommand({}))
        const resources = (res.QueueUrls ?? []).map((url) => toResource(url))

        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const queueUrl = resolveQueueUrl(id)
        const base = toResource(queueUrl)
        try {
            const res = await this.sqs.send(
                new GetQueueAttributesCommand({
                    QueueUrl: queueUrl,
                    AttributeNames: ['CreatedTimestamp', 'ApproximateNumberOfMessages'],
                }),
            )
            const attributes = res.Attributes ?? {}
            const createdAt = attributes.CreatedTimestamp
                ? new Date(Number(attributes.CreatedTimestamp) * 1000).toISOString()
                : null
            return {
                ...base,
                createdAt,
                metadata: {
                    ...base.metadata,
                    approximateNumberOfMessages: attributes.ApproximateNumberOfMessages ?? null,
                },
            }
        } catch {
            return base
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        let queueName = stringValue(input.values.queueName)
        if (!queueName) throw new Error('queueName is required')
        if (!/^[a-zA-Z0-9_-]{1,75}(\.fifo)?$/.test(queueName)) {
            throw new Error('Use a valid SQS queue name: 1-80 characters using letters, numbers, hyphens, and underscores. FIFO queues must end with .fifo.')
        }

        // SQS requires FIFO queue names to end with .fifo. Normalize the name so
        // selecting the FIFO option without typing the suffix still works.
        if (stringValue(input.values.fifoQueue) === 'true' && !queueName.endsWith('.fifo')) {
            queueName = `${queueName}.fifo`
        }

        const attributes = collectAttributes(input.values)

        const res = await this.sqs.send(
            new CreateQueueCommand({
                QueueName: queueName,
                Attributes: Object.keys(attributes).length ? attributes : undefined,
            }),
        )

        return toResource(res.QueueUrl ?? '')
    }

    async delete(id: string): Promise<void> {
        await this.sqs.send(new DeleteQueueCommand({QueueUrl: resolveQueueUrl(id)}))
    }

    async sendMessage(id: string, body: string): Promise<SendMessageResult> {
        const res = await this.sqs.send(
            new SendMessageCommand({QueueUrl: resolveQueueUrl(id), MessageBody: body}),
        )
        return {
            messageId: res.MessageId ?? '',
            md5OfMessageBody: res.MD5OfMessageBody,
        }
    }

    async receiveMessages(id: string, maxMessages = 10): Promise<QueueMessage[]> {
        const res = await this.sqs.send(
            new ReceiveMessageCommand({
                QueueUrl: resolveQueueUrl(id),
                MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), 10),
                // VisibilityTimeout 0 keeps the receive a non-consuming peek: the
                // messages are returned for inspection but stay available in the
                // queue instead of being hidden (consumed) for the default period.
                VisibilityTimeout: 0,
                AttributeNames: ['All'],
                MessageAttributeNames: ['All'],
            }),
        )
        return (res.Messages ?? []).map((message) => ({
            messageId: message.MessageId ?? '',
            body: message.Body ?? '',
            receiptHandle: message.ReceiptHandle ?? '',
            attributes: message.Attributes,
            md5OfBody: message.MD5OfBody,
        }))
    }

    async deleteMessage(id: string, receiptHandle: string): Promise<void> {
        await this.sqs.send(
            new DeleteMessageCommand({
                QueueUrl: resolveQueueUrl(id),
                ReceiptHandle: receiptHandle,
            }),
        )
    }

    async purgeQueue(id: string): Promise<void> {
        await this.sqs.send(
            new PurgeQueueCommand({QueueUrl: resolveQueueUrl(id)}),
        )
    }
}

function toResource(queueUrl: string): CloudResource {
    const name = queueUrl.split('/').pop() ?? queueUrl
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'queue',
        type: 'queue',
        region: null,
        createdAt: null,
        metadata: {
            provider: 'aws',
            queueService: 'sqs',
            queueUrl,
        },
    }
}

// The resource id is the queue name (a safe, slash-free path segment). The full
// SQS QueueUrl is reconstructed here so the adapter can call the SDK. A full URL
// is accepted as-is for backward compatibility (e.g. direct SDK-style callers).
function resolveQueueUrl(id: string): string {
    if (/^https?:\/\//i.test(id)) return id
    const endpoint = process.env.FLOCI_ENDPOINT ?? 'http://localhost:4566'
    const account = defaultAccountId()
    return `${endpoint}/${account}/${id}`
}

function collectAttributes(values: Record<string, unknown>): Record<string, string> {
    const attributes: Record<string, string> = {}
    const visibilityTimeout = stringValue(values.visibilityTimeout)
    if (visibilityTimeout) attributes.VisibilityTimeout = visibilityTimeout
    const messageRetentionPeriod = stringValue(values.messageRetentionPeriod)
    if (messageRetentionPeriod) attributes.MessageRetentionPeriod = messageRetentionPeriod
    const delaySeconds = stringValue(values.delaySeconds)
    if (delaySeconds) attributes.DelaySeconds = delaySeconds
    const fifoQueue = stringValue(values.fifoQueue)
    if (fifoQueue === 'true') attributes.FifoQueue = 'true'
    return attributes
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}