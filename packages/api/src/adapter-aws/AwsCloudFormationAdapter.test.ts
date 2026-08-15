import {describe, expect, test} from 'bun:test'
import {
    CreateStackCommand,
    DeleteStackCommand,
    DescribeStacksCommand,
    ListStackResourcesCommand,
    ListStacksCommand,
    type CloudFormationClient,
} from '@aws-sdk/client-cloudformation'
import {AwsCloudFormationAdapter} from './AwsCloudFormationAdapter'

function fakeClient(handler: (command: unknown) => unknown): CloudFormationClient {
    return {
        send: async (command: unknown) => handler(command),
    } as unknown as CloudFormationClient
}

const ordersStackSummary = {
    StackId: 'arn:aws:cloudformation:us-east-1:000000000000:stack/orders-stack/abc123',
    StackName: 'orders-stack',
    CreationTime: new Date('2026-01-02T03:04:05.000Z'),
    StackStatus: 'CREATE_COMPLETE',
}

const ordersStack = {
    StackId: 'arn:aws:cloudformation:us-east-1:000000000000:stack/orders-stack/abc123',
    StackName: 'orders-stack',
    CreationTime: new Date('2026-01-02T03:04:05.000Z'),
    LastUpdatedTime: new Date('2026-01-02T03:04:06.000Z'),
    StackStatus: 'CREATE_COMPLETE',
    Capabilities: [],
    Outputs: [{OutputKey: 'BucketName', OutputValue: 'orders-bucket', Description: 'The bucket name'}],
    Tags: [{Key: 'env', Value: 'dev'}],
    EnableTerminationProtection: false,
}

const bucketResource = {
    LogicalResourceId: 'OrdersBucket',
    PhysicalResourceId: 'orders-bucket',
    ResourceType: 'AWS::S3::Bucket',
    ResourceStatus: 'CREATE_COMPLETE',
}

describe('AwsCloudFormationAdapter', () => {
    test('lists every page and maps stacks to normalized resources', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient((command) => {
            if (!(command instanceof ListStacksCommand)) throw new Error('Unexpected command')
            if (!command.input.NextToken) return {StackSummaries: [ordersStackSummary], NextToken: 'next'}
            return {StackSummaries: [{...ordersStackSummary, StackName: 'accounts-stack'}]}
        }))

        const result = await adapter.list()

        expect(result).toHaveLength(2)
        expect(result[0]).toMatchObject({
            id: 'orders-stack',
            name: 'orders-stack',
            cloud: 'aws',
            service: 'iac',
            type: 'stack',
            region: null,
            createdAt: '2026-01-02T03:04:05.000Z',
            status: 'CREATE_COMPLETE',
        })
        expect(result[0].metadata).toMatchObject({
            stackId: ordersStackSummary.StackId,
        })
    })

    test('filters stacks by search term', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient(() => ({
            StackSummaries: [ordersStackSummary, {...ordersStackSummary, StackName: 'accounts-stack'}],
        })))

        const result = await adapter.list({search: 'ORDERS'})

        expect(result.map((resource) => resource.name)).toEqual(['orders-stack'])
    })

    test('gets and maps one stack, including its resources', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient((command) => {
            if (command instanceof DescribeStacksCommand) return {Stacks: [ordersStack]}
            if (command instanceof ListStackResourcesCommand) return {StackResourceSummaries: [bucketResource]}
            throw new Error('Unexpected command')
        }))

        const result = await adapter.get('orders-stack')

        expect(result?.id).toBe('orders-stack')
        expect(result?.status).toBe('CREATE_COMPLETE')
        expect(result?.metadata.outputs).toEqual([{key: 'BucketName', value: 'orders-bucket', description: 'The bucket name'}])
        expect(result?.metadata.tags).toEqual([{key: 'env', value: 'dev'}])
        expect(result?.metadata.resources).toEqual([{
            logicalId: 'OrdersBucket',
            physicalId: 'orders-bucket',
            resourceType: 'AWS::S3::Bucket',
            status: 'CREATE_COMPLETE',
        }])
    })

    test('paginates ListStackResources and combines resources from every page', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient((command) => {
            if (command instanceof DescribeStacksCommand) return {Stacks: [ordersStack]}
            if (command instanceof ListStackResourcesCommand) {
                if (!command.input.NextToken) {
                    return {StackResourceSummaries: [bucketResource], NextToken: 'next-page'}
                }
                return {StackResourceSummaries: [{...bucketResource, LogicalResourceId: 'OrdersQueue', PhysicalResourceId: 'orders-queue', ResourceType: 'AWS::SQS::Queue'}]}
            }
            throw new Error('Unexpected command')
        }))

        const result = await adapter.get('orders-stack')

        expect(result?.metadata.resources).toEqual([
            {
                logicalId: 'OrdersBucket',
                physicalId: 'orders-bucket',
                resourceType: 'AWS::S3::Bucket',
                status: 'CREATE_COMPLETE',
            },
            {
                logicalId: 'OrdersQueue',
                physicalId: 'orders-queue',
                resourceType: 'AWS::SQS::Queue',
                status: 'CREATE_COMPLETE',
            },
        ])
    })

    test('returns null when CloudFormation reports a missing stack', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient(() => {
            throw Object.assign(new Error('Stack with id missing-stack does not exist'), {name: 'ValidationError'})
        }))

        await expect(adapter.get('missing-stack')).resolves.toBeNull()
    })

    test('creates a stack from a stack name and template body', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(CreateStackCommand)
            expect((command as CreateStackCommand).input).toEqual({
                StackName: 'orders-stack',
                TemplateBody: '{"Resources":{}}',
            })
            return {StackId: ordersStack.StackId}
        }))

        const result = await adapter.create({values: {stackName: 'orders-stack', templateBody: '{"Resources":{}}'}})

        expect(result.id).toBe('orders-stack')
        expect(result.status).toBe('CREATE_IN_PROGRESS')
        expect(result.metadata.stackId).toBe(ordersStack.StackId)
    })

    test('rejects a missing stack name before calling CloudFormation', async () => {
        let called = false
        const adapter = new AwsCloudFormationAdapter(fakeClient(() => {
            called = true
            return {}
        }))

        await expect(adapter.create({values: {templateBody: '{}'}})).rejects.toThrow('stackName is required')
        expect(called).toBeFalse()
    })

    test('rejects a missing template body before calling CloudFormation', async () => {
        let called = false
        const adapter = new AwsCloudFormationAdapter(fakeClient(() => {
            called = true
            return {}
        }))

        await expect(adapter.create({values: {stackName: 'orders-stack'}})).rejects.toThrow('templateBody is required')
        expect(called).toBeFalse()
    })

    test('deletes the requested stack', async () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient((command) => {
            expect(command).toBeInstanceOf(DeleteStackCommand)
            expect((command as DeleteStackCommand).input.StackName).toBe('orders-stack')
            return {}
        }))

        await adapter.delete('orders-stack')
    })

    test('returns the AWS CloudFormation schema', () => {
        const adapter = new AwsCloudFormationAdapter(fakeClient(() => ({})))

        expect(adapter.schema()).toMatchObject({
            cloud: 'aws',
            service: 'iac',
            displayName: 'CloudFormation',
            actions: ['list', 'create', 'delete', 'inspect'],
        })
    })
})
