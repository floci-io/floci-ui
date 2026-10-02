import {describe, expect, test} from 'bun:test'
import {
    CreateTopicCommand,
    DeleteTopicCommand,
    GetTopicAttributesCommand,
    ListTopicsCommand,
    type SNSClient,
} from '@aws-sdk/client-sns'
import {AwsSnsAdapter} from './AwsSnsAdapter'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:orders'
const FIFO_ARN = 'arn:aws:sns:us-east-1:000000000000:orders.fifo'

function stubSns(options: {
    pages?: Array<{Topics?: Array<{TopicArn?: string}>; NextToken?: string}>
    attributes?: Record<string, string>
    missing?: boolean
    createdArn?: string | null
} = {}) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            if (command instanceof ListTopicsCommand) {
                const index = command.input.NextToken ? Number(command.input.NextToken) : 0
                return options.pages?.[index] ?? {Topics: [{TopicArn: TOPIC_ARN}]}
            }
            if (command instanceof GetTopicAttributesCommand) {
                if (options.missing) {
                    const error = new Error('Topic does not exist')
                    error.name = 'NotFound'
                    throw error
                }
                return {Attributes: options.attributes ?? {Owner: '000000000000', SubscriptionsConfirmed: '2'}}
            }
            if (command instanceof CreateTopicCommand) {
                return {TopicArn: options.createdArn === undefined ? TOPIC_ARN : options.createdArn}
            }
            return {}
        },
    } as unknown as SNSClient
    return {client, sent}
}

describe('AwsSnsAdapter', () => {
    test('exposes a separate AWS SNS schema', () => {
        const adapter = new AwsSnsAdapter(stubSns().client)
        expect(adapter.service).toBe('sns')
        expect(adapter.schema().actions).toEqual(['list', 'create', 'inspect', 'delete'])
    })

    test('lists every page using topic ARNs as stable ids', async () => {
        const {client, sent} = stubSns({pages: [
            {Topics: [{TopicArn: TOPIC_ARN}], NextToken: '1'},
            {Topics: [{TopicArn: FIFO_ARN}]},
        ]})
        const topics = await new AwsSnsAdapter(client).list()

        expect(topics.map(({id}) => id)).toEqual([TOPIC_ARN, FIFO_ARN])
        expect(topics[0]).toMatchObject({name: 'orders', service: 'sns', type: 'topic', region: 'us-east-1'})
        expect(topics[1]?.type).toBe('fifo-topic')
        expect((sent[1] as ListTopicsCommand).input.NextToken).toBe('1')
        expect(sent).toHaveLength(2)
    })

    test('rejects a repeated ListTopics continuation token', async () => {
        let requests = 0
        const client = {
            async send() {
                requests += 1
                if (requests > 2) throw new Error('unexpected third page request')
                return {Topics: [{TopicArn: TOPIC_ARN}], NextToken: 'repeat'}
            },
        } as unknown as SNSClient

        await expect(new AwsSnsAdapter(client).list()).rejects.toThrow('SNS ListTopics repeated a continuation token')
        expect(requests).toBe(2)
    })

    test('searches topic names without fetching attributes for every row', async () => {
        const {client, sent} = stubSns({pages: [{Topics: [{TopicArn: TOPIC_ARN}, {TopicArn: FIFO_ARN}]}]})
        const topics = await new AwsSnsAdapter(client).list({search: ' .FIFO '})

        expect(topics.map(({id}) => id)).toEqual([FIFO_ARN])
        expect(sent).toHaveLength(1)
    })

    test('inspects topic attributes by ARN', async () => {
        const {client, sent} = stubSns({attributes: {
            Owner: '000000000000', DisplayName: 'Orders', SubscriptionsConfirmed: '2',
            SubscriptionsPending: '1', FifoTopic: 'true',
        }})
        const topic = await new AwsSnsAdapter(client).get(FIFO_ARN)

        expect((sent[0] as GetTopicAttributesCommand).input.TopicArn).toBe(FIFO_ARN)
        expect(topic).toMatchObject({
            id: FIFO_ARN,
            type: 'fifo-topic',
            metadata: {displayName: 'Orders', owner: '000000000000', subscriptionsConfirmed: 2, subscriptionsPending: 1},
        })
    })

    test('returns null when a topic no longer exists', async () => {
        await expect(new AwsSnsAdapter(stubSns({missing: true}).client).get(TOPIC_ARN)).resolves.toBeNull()
    })

    test('creates a standard topic without FIFO attributes', async () => {
        const {client, sent} = stubSns()
        const topic = await new AwsSnsAdapter(client).create({values: {name: 'orders'}})

        expect((sent[0] as CreateTopicCommand).input).toEqual({Name: 'orders'})
        expect(topic.id).toBe(TOPIC_ARN)
    })

    test('sets the AWS-required FIFO attribute for a .fifo topic', async () => {
        const {client, sent} = stubSns({createdArn: FIFO_ARN})
        const topic = await new AwsSnsAdapter(client).create({values: {name: 'orders.fifo'}})

        expect((sent[0] as CreateTopicCommand).input).toEqual({Name: 'orders.fifo', Attributes: {FifoTopic: 'true'}})
        expect(topic.type).toBe('fifo-topic')
    })

    test('rejects names that AWS SNS does not accept', async () => {
        const adapter = new AwsSnsAdapter(stubSns().client)
        for (const name of ['', 'contains space', 'standard.with.dot', 'a'.repeat(257), '.fifo']) {
            await expect(adapter.create({values: {name}})).rejects.toBeInstanceOf(ValidationError)
        }
    })

    test('reports an incomplete CreateTopic response as a runtime failure', async () => {
        const adapter = new AwsSnsAdapter(stubSns({createdArn: null}).client)
        await expect(adapter.create({values: {name: 'orders'}})).rejects.toBeInstanceOf(RuntimeError)
    })

    test('deletes the exact topic ARN', async () => {
        const {client, sent} = stubSns()
        await new AwsSnsAdapter(client).delete(TOPIC_ARN)
        expect((sent[0] as DeleteTopicCommand).input.TopicArn).toBe(TOPIC_ARN)
    })

    test('checks service health without describing every topic', async () => {
        const {client, sent} = stubSns()
        await new AwsSnsAdapter(client).health()
        expect(sent).toHaveLength(1)
        expect(sent[0]).toBeInstanceOf(ListTopicsCommand)
    })
})
