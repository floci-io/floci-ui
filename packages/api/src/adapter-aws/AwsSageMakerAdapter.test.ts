import {describe, expect, test} from 'bun:test'
import {
    CreateModelCommand,
    DeleteEndpointCommand,
    DeleteEndpointConfigCommand,
    DeleteModelCommand,
    ListEndpointConfigsCommand,
    ListEndpointsCommand,
    ListModelsCommand,
    ListTrainingJobsCommand,
    type SageMakerClient,
} from '@aws-sdk/client-sagemaker'
import {AwsSageMakerAdapter} from './AwsSageMakerAdapter'
import {ValidationError} from '../cloud-spi/errors'

function stubSageMaker(handlers: Record<string, () => object> = {}) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            for (const [name, handler] of Object.entries(handlers)) {
                if (command.constructor.name === name) return handler()
            }
            return {}
        },
    } as unknown as SageMakerClient
    return {client, sent}
}

describe('AwsSageMakerAdapter', () => {
    test('identifies itself as the AWS SageMaker adapter', () => {
        const adapter = new AwsSageMakerAdapter(stubSageMaker().client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('sagemaker')
        expect(adapter.schema().displayName).toBe('SageMaker AI')
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('lists models, endpoint configs, endpoints, and training jobs together', async () => {
        const {client, sent} = stubSageMaker({
            ListModelsCommand: () => ({Models: [{ModelName: 'm', ModelArn: 'arn:model', CreationTime: new Date('2026-01-01T00:00:00Z')}]}),
            ListEndpointConfigsCommand: () => ({EndpointConfigs: [{EndpointConfigName: 'cfg', EndpointConfigArn: 'arn:cfg'}]}),
            ListEndpointsCommand: () => ({Endpoints: [{EndpointName: 'ep', EndpointArn: 'arn:ep', EndpointStatus: 'InService'}]}),
            ListTrainingJobsCommand: () => ({TrainingJobSummaries: [{TrainingJobName: 'train', TrainingJobArn: 'arn:train', TrainingJobStatus: 'Completed'}]}),
        })

        const resources = await new AwsSageMakerAdapter(client).list()

        expect(resources.map((resource) => resource.id)).toEqual([
            'model:m',
            'endpoint-config:cfg',
            'endpoint:ep',
            'training-job:train',
        ])
        expect(resources.map((resource) => resource.metadata.kind)).toEqual(['Model', 'Endpoint config', 'Endpoint', 'Training job'])
        expect(sent.some((command) => command instanceof ListModelsCommand)).toBe(true)
        expect(sent.some((command) => command instanceof ListEndpointConfigsCommand)).toBe(true)
        expect(sent.some((command) => command instanceof ListEndpointsCommand)).toBe(true)
        expect(sent.some((command) => command instanceof ListTrainingJobsCommand)).toBe(true)
    })

    test('creates a model from JSON primary container fields', async () => {
        const {client, sent} = stubSageMaker({
            CreateModelCommand: () => ({ModelArn: 'arn:model'}),
            DescribeModelCommand: () => ({ModelName: 'm', ModelArn: 'arn:model'}),
        })

        const resource = await new AwsSageMakerAdapter(client).create({
            values: {
                resourceType: 'model',
                modelName: 'm',
                executionRoleArn: 'arn:aws:iam::000000000000:role/r',
                primaryContainer: '{"Image":"example"}',
            },
        })

        expect(resource.id).toBe('model:m')
        expect((sent[0] as CreateModelCommand).input).toEqual({
            ModelName: 'm',
            ExecutionRoleArn: 'arn:aws:iam::000000000000:role/r',
            PrimaryContainer: {Image: 'example'},
        })
    })

    test('redacts model container environment values before inspection', async () => {
        const {client} = stubSageMaker({
            DescribeModelCommand: () => ({
                ModelName: 'm',
                ModelArn: 'arn:model',
                PrimaryContainer: {
                    Image: 'example',
                    Environment: {TOKEN: 'secret-token', MODE: 'test'},
                },
                Containers: [
                    {
                        Image: 'sidecar',
                        Environment: {PASSWORD: 'secret-password'},
                    },
                ],
            }),
        })

        const resource = await new AwsSageMakerAdapter(client).get('model:m')

        expect(resource?.metadata.primaryContainer).toEqual({
            Image: 'example',
            Environment: {TOKEN: '[redacted]', MODE: '[redacted]'},
        })
        expect(resource?.metadata.containers).toEqual([
            {
                Image: 'sidecar',
                Environment: {PASSWORD: '[redacted]'},
            },
        ])
    })

    test('rejects invalid JSON create input', async () => {
        const adapter = new AwsSageMakerAdapter(stubSageMaker().client)

        await expect(adapter.create({
            values: {resourceType: 'model', modelName: 'm', primaryContainer: '{nope'},
        })).rejects.toBeInstanceOf(ValidationError)
    })

    test('routes delete by encoded resource kind', async () => {
        const {client, sent} = stubSageMaker()
        const adapter = new AwsSageMakerAdapter(client)

        await adapter.delete('model:m')
        await adapter.delete('endpoint-config:cfg')
        await adapter.delete('endpoint:ep')

        expect((sent[0] as DeleteModelCommand).input).toEqual({ModelName: 'm'})
        expect((sent[1] as DeleteEndpointConfigCommand).input).toEqual({EndpointConfigName: 'cfg'})
        expect((sent[2] as DeleteEndpointCommand).input).toEqual({EndpointName: 'ep'})
    })

    test('does not offer a fake training job delete', async () => {
        const adapter = new AwsSageMakerAdapter(stubSageMaker().client)

        await expect(adapter.delete('training-job:train')).rejects.toBeInstanceOf(ValidationError)
    })
})
