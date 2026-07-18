import {
    CreateQueueCommand,
    DeleteMessageCommand,
    DeleteQueueCommand,
    GetQueueAttributesCommand,
    ListQueuesCommand,
    PurgeQueueCommand,
    QueueAttributeName,
    ReceiveMessageCommand,
    SendMessageCommand,
    type SQSClient,
} from '@aws-sdk/client-sqs'
import {awsQueueSchema} from '../cloud-spi/queueSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    QueueMessage,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {sqs as defaultSqs} from '../aws'

const ATTRIBUTES_FOR_LIST: QueueAttributeName[] = [
    QueueAttributeName.QueueArn,
    QueueAttributeName.ApproximateNumberOfMessages,
    QueueAttributeName.ApproximateNumberOfMessagesNotVisible,
    QueueAttributeName.ApproximateNumberOfMessagesDelayed,
    QueueAttributeName.CreatedTimestamp,
    QueueAttributeName.VisibilityTimeout,
    QueueAttributeName.DelaySeconds,
    QueueAttributeName.MessageRetentionPeriod,
    QueueAttributeName.RedrivePolicy,
    QueueAttributeName.FifoQueue,
]

export class AwsQueueAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'queue' as const

    constructor(private readonly sqs: SQSClient = defaultSqs) {}

    schema(): ServiceSchema {
        return awsQueueSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const res = await this.sqs.send(new ListQueuesCommand({}))
        const urls = res.QueueUrls ?? []

        const resources = await Promise.all(
            urls.map((url) => this.toResource(url)),
        )

        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return await this.toResource(id)
        } catch (error) {
            if (isQueueMissing(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const values = input.values
        const queueName = stringValue(values.queueName)
        if (!queueName) throw new Error('queueName is required')

        const fifo = String(values.fifo ?? '') === 'fifo' || queueName.endsWith('.fifo')
        const name = fifo && !queueName.endsWith('.fifo') ? `${queueName}.fifo` : queueName

        const attributes: Record<string, string> = {}
        if (fifo) attributes.FifoQueue = 'true'
        const visibilityTimeout = stringValue(values.visibilityTimeout)
        if (visibilityTimeout) attributes.VisibilityTimeout = visibilityTimeout
        const delaySeconds = stringValue(values.delaySeconds)
        if (delaySeconds) attributes.DelaySeconds = delaySeconds
        const messageRetentionPeriod = stringValue(values.messageRetentionPeriod)
        if (messageRetentionPeriod) attributes.MessageRetentionPeriod = messageRetentionPeriod

        const res = await this.sqs.send(new CreateQueueCommand({
            QueueName: name,
            Attributes: Object.keys(attributes).length ? attributes : undefined,
        }))

        if (!res.QueueUrl) throw new Error('Floci runtime did not return a queue URL')
        return this.toResource(res.QueueUrl)
    }

    async delete(id: string): Promise<void> {
        await this.sqs.send(new DeleteQueueCommand({QueueUrl: id}))
    }

    async sendMessage(queueId: string, body: string, messageAttributes?: Record<string, string>): Promise<QueueMessage> {
        const res = await this.sqs.send(new SendMessageCommand({
            QueueUrl: queueId,
            MessageBody: body,
            MessageAttributes: messageAttributes
                ? Object.fromEntries(
                    Object.entries(messageAttributes).map(([key, value]) => [
                        key,
                        {DataType: 'String', StringValue: value},
                    ]),
                )
                : undefined,
        }))

        return {
            id: res.MessageId ?? '',
            receiptHandle: '',
            body,
            attributes: {},
            messageAttributes: messageAttributes ?? {},
            sentAt: new Date().toISOString(),
            receiveCount: null,
        }
    }

    async receiveMessages(queueId: string, maxMessages = 5, waitTimeSeconds = 0): Promise<QueueMessage[]> {
        const res = await this.sqs.send(new ReceiveMessageCommand({
            QueueUrl: queueId,
            MaxNumberOfMessages: clamp(maxMessages, 1, 10),
            WaitTimeSeconds: clamp(waitTimeSeconds, 0, 20),
            MessageAttributeNames: ['All'],
            AttributeNames: [QueueAttributeName.All],
        }))

        return (res.Messages ?? []).map((message) => ({
            id: message.MessageId ?? '',
            receiptHandle: message.ReceiptHandle ?? '',
            body: message.Body ?? '',
            attributes: message.Attributes ?? {},
            messageAttributes: Object.fromEntries(
                Object.entries(message.MessageAttributes ?? {}).map(([key, value]) => [key, value.StringValue ?? '']),
            ),
            sentAt: message.Attributes?.SentTimestamp
                ? new Date(Number(message.Attributes.SentTimestamp)).toISOString()
                : null,
            receiveCount: message.Attributes?.ApproximateReceiveCount
                ? Number(message.Attributes.ApproximateReceiveCount)
                : null,
        }))
    }

    async deleteMessage(queueId: string, receiptHandle: string): Promise<void> {
        await this.sqs.send(new DeleteMessageCommand({QueueUrl: queueId, ReceiptHandle: receiptHandle}))
    }

    async purgeQueue(queueId: string): Promise<void> {
        await this.sqs.send(new PurgeQueueCommand({QueueUrl: queueId}))
    }

    private async toResource(queueUrl: string): Promise<CloudResource> {
        const res = await this.sqs.send(new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ATTRIBUTES_FOR_LIST,
        }))
        const attrs = res.Attributes ?? {}
        const name = queueUrl.split('/').pop() ?? queueUrl

        return {
            id: queueUrl,
            name,
            cloud: 'aws',
            service: 'queue',
            type: 'queue',
            region: null,
            createdAt: attrs.CreatedTimestamp
                ? new Date(Number(attrs.CreatedTimestamp) * 1000).toISOString()
                : null,
            status: 'Active',
            metadata: {
                queueUrl,
                queueArn: attrs.QueueArn,
                fifo: attrs.FifoQueue === 'true',
                messagesAvailable: numberOr(attrs.ApproximateNumberOfMessages, 0),
                messagesInFlight: numberOr(attrs.ApproximateNumberOfMessagesNotVisible, 0),
                messagesDelayed: numberOr(attrs.ApproximateNumberOfMessagesDelayed, 0),
                visibilityTimeout: numberOr(attrs.VisibilityTimeout, null),
                delaySeconds: numberOr(attrs.DelaySeconds, null),
                messageRetentionPeriod: numberOr(attrs.MessageRetentionPeriod, null),
                redrivePolicy: attrs.RedrivePolicy ? JSON.parse(attrs.RedrivePolicy) : null,
            },
        }
    }
}

function numberOr(value: string | undefined, fallback: number | null): number | null {
    if (value === undefined) return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.min(max, Math.max(min, value))
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((r) => r.name.toLowerCase().includes(normalized))
}

function isQueueMissing(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const name = (error as {name?: string}).name
    return name === 'QueueDoesNotExist' || name === 'AWS.SimpleQueueService.NonExistentQueue'
}
