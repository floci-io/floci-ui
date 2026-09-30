import {
    CreateTopicCommand,
    DeleteTopicCommand,
    GetTopicAttributesCommand,
    ListTopicsCommand,
    type SNSClient,
} from '@aws-sdk/client-sns'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {awsSnsSchema} from '../cloud-spi/snsSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

export class AwsSnsAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'sns' as const

    constructor(private readonly sns: SNSClient) {}

    schema(): ServiceSchema {
        return awsSnsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const topics: CloudResource[] = []
        let nextToken: string | undefined
        do {
            const response = await this.sns.send(new ListTopicsCommand({NextToken: nextToken}))
            for (const topic of response.Topics ?? []) {
                if (topic.TopicArn) topics.push(topicResource(topic.TopicArn))
            }
            nextToken = response.NextToken
        } while (nextToken)

        const search = query.search?.trim().toLowerCase()
        return search ? topics.filter((topic) => topic.name.toLowerCase().includes(search)) : topics
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const response = await this.sns.send(new GetTopicAttributesCommand({TopicArn: id}))
            return topicResource(id, response.Attributes)
        } catch (error) {
            if (isTopicMissing(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = typeof input.values.name === 'string' ? input.values.name.trim() : ''
        if (!isValidTopicName(name)) {
            throw new ValidationError('Use a valid SNS topic name of up to 256 characters, with .fifo only as the FIFO suffix.')
        }

        const fifo = name.endsWith('.fifo')
        const response = await this.sns.send(new CreateTopicCommand({
            Name: name,
            ...(fifo ? {Attributes: {FifoTopic: 'true'}} : {}),
        }))
        if (!response.TopicArn) throw new RuntimeError('CreateTopic did not return a TopicArn')
        return topicResource(response.TopicArn, fifo ? {FifoTopic: 'true'} : undefined)
    }

    async delete(id: string): Promise<void> {
        await this.sns.send(new DeleteTopicCommand({TopicArn: id}))
    }

    async health(): Promise<void> {
        await this.sns.send(new ListTopicsCommand({}))
    }
}

function topicResource(arn: string, attributes: Record<string, string> = {}): CloudResource {
    const parts = arn.split(':')
    return {
        id: arn,
        name: parts.slice(5).join(':') || arn,
        cloud: 'aws',
        service: 'sns',
        type: attributes.FifoTopic === 'true' || arn.endsWith('.fifo') ? 'fifo-topic' : 'topic',
        region: parts[3] || null,
        createdAt: null,
        metadata: {
            provider: 'aws',
            arn,
            displayName: attributes.DisplayName || null,
            owner: attributes.Owner || null,
            subscriptionsConfirmed: count(attributes.SubscriptionsConfirmed),
            subscriptionsPending: count(attributes.SubscriptionsPending),
        },
    }
}

function count(value: string | undefined): number | null {
    if (value === undefined) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function isValidTopicName(name: string): boolean {
    return /^[A-Za-z0-9_-]{1,256}$/.test(name) || /^[A-Za-z0-9_-]{1,251}\.fifo$/.test(name)
}

function isTopicMissing(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return value.name === 'NotFound' || value.name === 'NotFoundException' || value.$metadata?.httpStatusCode === 404
}
