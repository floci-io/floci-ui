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
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {awsMessagingSchema} from '../cloud-spi/messagingSchema'
import {sqs as defaultSqs} from '../aws'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    QueueMessage,
    QueueMessageAttribute,
    ResourceQuery,
    SendQueueMessageResult,
    ServiceSchema,
    UpdateResourceInput,
} from '../cloud-spi/types'

/**
 * SQS queues as `messaging` resources.
 *
 * SQS identifies a queue by URL, but a URL is a poor id for the console: it is
 * long, embeds the endpoint, and changes if the runtime is re-pointed. The
 * adapter uses the queue name as the resource id and resolves it back to a URL
 * per call via GetQueueUrl, which is the same thing the AWS console does.
 */

interface QueueAttributes {
    QueueArn?: string
    ApproximateNumberOfMessages?: string
    ApproximateNumberOfMessagesNotVisible?: string
    ApproximateNumberOfMessagesDelayed?: string
    VisibilityTimeout?: string
    MessageRetentionPeriod?: string
    MaximumMessageSize?: string
    DelaySeconds?: string
    ReceiveMessageWaitTimeSeconds?: string
    CreatedTimestamp?: string
    LastModifiedTimestamp?: string
    FifoQueue?: string
}

export class AwsSqsAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'messaging' as const

    constructor(private readonly sqs: SQSClient = defaultSqs) {}

    schema(): ServiceSchema {
        return awsMessagingSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const res = await this.sqs.send(new ListQueuesCommand({}))
        const urls = res.QueueUrls ?? []

        const resources = await Promise.all(
            urls.map(async (url) => {
                const name = queueNameFromUrl(url)
                // A queue with no attributes is still a queue, so a failed
                // describe degrades to the bare row rather than failing the list.
                const attributes = await this.attributesFor(url).catch(() => ({}))
                return toResource(name, url, attributes)
            }),
        )

        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const url = await this.queueUrl(id)
        if (!url) return null
        return toResource(id, url, await this.attributesFor(url))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.queueName ?? input.values.name)
        if (!name) throw new ValidationError('queueName is required')
        if (!isValidQueueName(name)) {
            throw new ValidationError(
                'Use a valid SQS queue name: up to 80 alphanumeric characters, hyphens, or underscores.',
            )
        }

        const attributes: Record<string, string> = {}
        // Bounds are SQS's own, so a bad value fails in the form rather than as a
        // 400 from the runtime several seconds later.
        const visibilityTimeout = numericAttribute(input.values.visibilityTimeout, 'visibilityTimeout', 0, 43_200)
        const retention = numericAttribute(input.values.messageRetentionPeriod, 'messageRetentionPeriod', 60, 1_209_600)
        const delaySeconds = numericAttribute(input.values.delaySeconds, 'delaySeconds', 0, 900)
        const maxMessageSize = resolveMaximumMessageSize(input.values)
        const receiveWaitTime = numericAttribute(
            input.values.receiveMessageWaitTimeSeconds,
            'receiveMessageWaitTimeSeconds',
            0,
            20,
        )
        if (visibilityTimeout) attributes.VisibilityTimeout = visibilityTimeout
        if (retention) attributes.MessageRetentionPeriod = retention
        if (delaySeconds) attributes.DelaySeconds = delaySeconds
        if (maxMessageSize) attributes.MaximumMessageSize = maxMessageSize
        if (receiveWaitTime) attributes.ReceiveMessageWaitTimeSeconds = receiveWaitTime
        // A .fifo name alone is not enough: real SQS rejects the create unless
        // FifoQueue is set. Floci core infers it from the suffix, so omitting it
        // works locally and then fails against AWS.
        if (isFifoName(name)) attributes.FifoQueue = 'true'

        const res = await this.sqs.send(
            new CreateQueueCommand({
                QueueName: name,
                ...(Object.keys(attributes).length > 0 ? {Attributes: attributes} : {}),
            }),
        )

        const url = res.QueueUrl ?? (await this.queueUrl(name)) ?? ''
        return toResource(name, url, await this.attributesFor(url).catch(() => ({})))
    }

    async update(id: string, input: UpdateResourceInput): Promise<CloudResource> {
        const url = await this.requireQueueUrl(id)
        const values = input.values ?? {}
        const attributes: Record<string, string> = {}

        if (values.visibilityTimeout !== undefined) {
            const val = numericAttribute(values.visibilityTimeout, 'visibilityTimeout', 0, 43_200)
            if (val) attributes.VisibilityTimeout = val
        }
        if (values.messageRetentionPeriod !== undefined) {
            const val = numericAttribute(values.messageRetentionPeriod, 'messageRetentionPeriod', 60, 1_209_600)
            if (val) attributes.MessageRetentionPeriod = val
        }
        if (values.delaySeconds !== undefined) {
            const val = numericAttribute(values.delaySeconds, 'delaySeconds', 0, 900)
            if (val) attributes.DelaySeconds = val
        }
        if (values.maximumMessageSizeKb !== undefined || values.maximumMessageSize !== undefined) {
            const val = resolveMaximumMessageSize(values)
            if (val) attributes.MaximumMessageSize = val
        }
        if (values.receiveMessageWaitTimeSeconds !== undefined) {
            const val = numericAttribute(
                values.receiveMessageWaitTimeSeconds,
                'receiveMessageWaitTimeSeconds',
                0,
                20,
            )
            if (val) attributes.ReceiveMessageWaitTimeSeconds = val
        }

        if (Object.keys(attributes).length === 0) {
            throw new ValidationError('At least one queue attribute must be provided to update.')
        }

        await this.sqs.send(
            new SetQueueAttributesCommand({
                QueueUrl: url,
                Attributes: attributes,
            }),
        )

        return toResource(id, url, await this.attributesFor(url).catch(() => ({})))
    }

    async delete(id: string): Promise<void> {
        const url = await this.queueUrl(id)
        if (!url) throw new NotFoundError(`Queue ${id} does not exist`)
        await this.sqs.send(new DeleteQueueCommand({QueueUrl: url}))
    }

    async sendMessage(id: string, body: string, attributes?: Record<string, string>): Promise<SendQueueMessageResult> {
        const url = await this.requireQueueUrl(id)
        
        const MessageAttributes: Record<string, any> = attributes
            ? Object.fromEntries(
                Object.entries(attributes).map(([key, value]) => [
                    key,
                    { DataType: 'String', StringValue: value }
                ])
              )
            : {}

        // Real SQS requires MessageGroupId on every send to a FIFO queue. Derive
        // a default from the queue name so a FIFO send works without a form field.
        const res = await this.sqs.send(
            new SendMessageCommand({
                QueueUrl: url,
                MessageBody: body,
                ...(Object.keys(MessageAttributes).length > 0 ? { MessageAttributes } : {}),
                ...(isFifoName(id) ? {MessageGroupId: id.replace(/\.fifo$/, '')} : {}),
            }),
        )
        return {messageId: res.MessageId ?? '', md5OfMessageBody: res.MD5OfMessageBody}
    }

    async receiveMessages(id: string, maxMessages = 10): Promise<QueueMessage[]> {
        const url = await this.requireQueueUrl(id)
        
        const res = await this.sqs.send(
            new ReceiveMessageCommand({
                QueueUrl: url,
                MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), 10),
                // VisibilityTimeout 0 keeps this a non-consuming peek: messages
                // stay available in the queue instead of being hidden for the
                // queue's default visibility period.
                VisibilityTimeout: 0,
                // WaitTimeSeconds 0 ensures this peek returns immediately with whatever
                // messages are currently available, instead of inheriting ReceiveMessageWaitTimeSeconds
                // (which can be up to 20s and outlast browser request timeouts).
                WaitTimeSeconds: 0,
                MessageSystemAttributeNames: ['All'],
                MessageAttributeNames: ['All'],
            }),
        )

        const parsed = (res.Messages ?? []).map((message) => {
            const messageAttributes: Record<string, QueueMessageAttribute> = message.MessageAttributes
                ? Object.fromEntries(
                    Object.entries(message.MessageAttributes)
                        .filter(([_, value]) => value !== undefined)
                        .map(([key, value]) => [
                            key,
                            {dataType: value!.DataType ?? '', value: value!.StringValue ?? '<Binary Data>'}
                        ])
                  )
                : {}
            return {
                messageId: message.MessageId ?? '',
                body: message.Body ?? '',
                receiptHandle: message.ReceiptHandle ?? '',
                attributes: message.Attributes,
                messageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
                md5OfBody: message.MD5OfBody,
            }
        })
        return parsed;
    }

    async deleteMessage(id: string, receiptHandle: string): Promise<void> {
        const url = await this.requireQueueUrl(id)
        await this.sqs.send(new DeleteMessageCommand({QueueUrl: url, ReceiptHandle: receiptHandle}))
    }

    async purgeQueue(id: string): Promise<void> {
        const url = await this.requireQueueUrl(id)
        await this.sqs.send(new PurgeQueueCommand({QueueUrl: url}))
    }

    /** Listing queue names is cheaper than describing each one. */
    async health(): Promise<void> {
        await this.sqs.send(new ListQueuesCommand({}))
    }

    private async queueUrl(name: string): Promise<string | null> {
        try {
            const res = await this.sqs.send(new GetQueueUrlCommand({QueueName: name}))
            return res.QueueUrl ?? null
        } catch (error) {
            if (isQueueMissing(error)) return null
            throw error
        }
    }

    private async requireQueueUrl(name: string): Promise<string> {
        const url = await this.queueUrl(name)
        if (!url) throw new NotFoundError(`Queue ${name} does not exist`)
        return url
    }

    private async attributesFor(url: string): Promise<QueueAttributes> {
        if (!url) return {}
        const res = await this.sqs.send(
            new GetQueueAttributesCommand({QueueUrl: url, AttributeNames: ['All']}),
        )
        return (res.Attributes ?? {}) as QueueAttributes
    }
}

function toResource(name: string, url: string, attributes: QueueAttributes): CloudResource {
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'messaging',
        type: attributes.FifoQueue === 'true' ? 'fifo-queue' : 'queue',
        region: null,
        createdAt: epochSecondsToIso(attributes.CreatedTimestamp),
        metadata: {
            provider: 'aws',
            messagingService: 'sqs',
            queueUrl: url,
            arn: attributes.QueueArn,
            approximateMessages: numberValue(attributes.ApproximateNumberOfMessages),
            messagesInFlight: numberValue(attributes.ApproximateNumberOfMessagesNotVisible),
            messagesDelayed: numberValue(attributes.ApproximateNumberOfMessagesDelayed),
            visibilityTimeout: numberValue(attributes.VisibilityTimeout),
            messageRetentionPeriod: numberValue(attributes.MessageRetentionPeriod),
            maximumMessageSize: numberValue(attributes.MaximumMessageSize),
            maximumMessageSizeKb: wholeKilobytes(numberValue(attributes.MaximumMessageSize)),
            delaySeconds: numberValue(attributes.DelaySeconds),
            receiveMessageWaitTimeSeconds: numberValue(attributes.ReceiveMessageWaitTimeSeconds),
            lastModified: epochSecondsToIso(attributes.LastModifiedTimestamp),
        },
    }
}

/** SQS reports timestamps as epoch seconds; the contract uses ISO strings. */
function epochSecondsToIso(value: string | undefined): string | null {
    if (!value) return null
    const seconds = Number(value)
    return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null
}

function numberValue(value: string | undefined): number | null {
    if (value === undefined) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

/**
 * The edit form takes whole KB. A size that is not a multiple of 1024 bytes has no
 * exact KB value, so it stays blank instead of showing a rounded one the user could
 * not change (re-entering the rounded value would read as "No fields changed.").
 */
function wholeKilobytes(bytes: number | null): number | null {
    return bytes !== null && bytes % 1024 === 0 ? bytes / 1024 : null
}

function queueNameFromUrl(url: string): string {
    return url.split('/').filter(Boolean).pop() ?? url
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

/**
 * Validate an optional numeric queue attribute against SQS's documented range.
 *
 * Returns '' when the caller left it blank — these are optional, and an empty
 * field must not become an attribute.
 */
function numericAttribute(value: unknown, field: string, min: number, max: number, unit = 'seconds'): string {
    const raw = stringValue(value)
    if (!raw) return ''
    if (!/^\d+$/.test(raw)) {
        throw new ValidationError(`${field} must be a whole number of ${unit} between ${min} and ${max}.`)
    }
    const parsed = Number(raw)
    if (parsed < min || parsed > max) {
        throw new ValidationError(`${field} must be between ${min} and ${max} ${unit}.`)
    }
    return raw
}

/**
 * Validate and normalize maximumMessageSize according to AWS SQS quotas:
 * 1,024 bytes (1 KiB) up to 1,048,576 bytes (1 MiB / 1,024 KiB).
 *
 * Accepts either:
 * - `maximumMessageSizeKb`: A value in KB between 1 and 1,024 (as configured in the schema), converting it to bytes.
 * - `maximumMessageSize`: Raw byte count (1,024 - 1,048,576) for direct API callers.
 *
 * Returns '' when blank.
 */
function resolveMaximumMessageSize(values: Record<string, unknown>): string {
    const rawKb = stringValue(values.maximumMessageSizeKb)
    if (rawKb) {
        const kb = numericAttribute(rawKb, 'maximumMessageSizeKb', 1, 1024, 'KB')
        return String(Number(kb) * 1024)
    }

    const raw = stringValue(values.maximumMessageSize)
    if (!raw) return ''

    if (!/^\d+$/.test(raw)) {
        throw new ValidationError('maximumMessageSize must be a whole number of bytes between 1024 and 1048576.')
    }
    const bytes = Number(raw)
    if (bytes < 1024 || bytes > 1_048_576) {
        throw new ValidationError('maximumMessageSize must be between 1024 and 1048576 bytes.')
    }
    return String(bytes)
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isFifoName(value: string): boolean {
    return value.endsWith('.fifo')
}

function isValidQueueName(value: string): boolean {
    // FIFO queues must end in .fifo, which is the one place a dot is allowed.
    return /^[A-Za-z0-9_-]{1,80}$/.test(value) || /^[A-Za-z0-9_-]{1,75}\.fifo$/.test(value)
}

function isQueueMissing(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const name = (error as {name?: string}).name
    return name === 'QueueDoesNotExist' || name === 'AWS.SimpleQueueService.NonExistentQueue'
}
