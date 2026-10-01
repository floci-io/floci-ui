import {describe, expect, test} from 'bun:test'
import {
    CreateFunctionCommand,
    DeleteFunctionCommand,
    GetFunctionCommand,
    InvokeCommand,
    type LambdaClient,
    ListFunctionsCommand,
} from '@aws-sdk/client-lambda'
import {AwsServerlessAdapter} from './AwsServerlessAdapter'
import {ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

/** Minimal LambdaClient stub that records the commands it was sent. */
function stubLambda(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as LambdaClient
    return {client, sent}
}

const listPayload = {
    Functions: [
        {
            FunctionName: 'hello',
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
            Runtime: 'nodejs20.x',
            Handler: 'index.handler',
            LastModified: '2026-07-01T10:00:00.000+0000',
            State: 'Active',
            MemorySize: 128,
            Timeout: 3,
        },
    ],
}

describe('AwsServerlessAdapter', () => {
    test('identifies itself as the AWS serverless adapter', () => {
        const {client} = stubLambda(() => ({}))
        const adapter = new AwsServerlessAdapter(client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('serverless')
        expect(adapter.schema().displayName).toBe('AWS Lambda')
    })

    test('lists functions and exposes runtime detail under metadata', async () => {
        const {client, sent} = stubLambda(() => listPayload)
        const [resource] = await new AwsServerlessAdapter(client).list()

        expect(sent[0]).toBeInstanceOf(ListFunctionsCommand)
        expect(resource).toMatchObject({
            id: 'hello',
            name: 'hello',
            cloud: 'aws',
            service: 'serverless',
            type: 'lambda',
            status: 'Active',
        })
        // The serverless schema reads these through metadata paths.
        expect(resource?.metadata.runtime).toBe('nodejs20.x')
        expect(resource?.metadata.lastModified).toBe('2026-07-01T10:00:00.000+0000')
    })

    test('filters the list by search term', async () => {
        const {client} = stubLambda(() => listPayload)
        const adapter = new AwsServerlessAdapter(client)

        await expect(adapter.list({search: 'hell'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('returns null when a function does not exist', async () => {
        const {client} = stubLambda(() => {
            throw Object.assign(new Error('ResourceNotFoundException'), {$metadata: {httpStatusCode: 404}})
        })
        await expect(new AwsServerlessAdapter(client).get('missing')).resolves.toBeNull()
    })

    test('rethrows a non-404 failure from get', async () => {
        const {client} = stubLambda(() => {
            throw Object.assign(new Error('AccessDenied'), {$metadata: {httpStatusCode: 403}})
        })
        await expect(new AwsServerlessAdapter(client).get('hello')).rejects.toThrow('AccessDenied')
    })

    test('inspects a function through GetFunction', async () => {
        const {client, sent} = stubLambda(() => ({
            Configuration: {FunctionName: 'hello', Runtime: 'nodejs20.x', Role: 'arn:aws:iam::000000000000:role/lambda'},
        }))
        const resource = await new AwsServerlessAdapter(client).get('hello')

        expect(sent[0]).toBeInstanceOf(GetFunctionCommand)
        expect(resource?.id).toBe('hello')
        expect(resource?.metadata.role).toBe('arn:aws:iam::000000000000:role/lambda')
    })

    test('requires the fields the schema marks required', async () => {
        const {client} = stubLambda(() => ({}))
        const adapter = new AwsServerlessAdapter(client)

        const cases: Array<[Record<string, unknown>, string]> = [
            [{}, 'functionName is required'],
            [{functionName: 'a'}, 'runtime is required'],
            [{functionName: 'a', runtime: 'nodejs20.x'}, 'handler is required'],
            [{functionName: 'a', runtime: 'nodejs20.x', handler: 'index.handler'}, 'role is required'],
        ]

        for (const [values, message] of cases) {
            await expect(adapter.create({values})).rejects.toThrow(new ValidationError(message))
        }
    })

    test('creates a function with a default inline handler', async () => {
        const {client, sent} = stubLambda(() => ({FunctionName: 'hello', State: 'Pending'}))
        await new AwsServerlessAdapter(client).create({
            values: {functionName: 'hello', runtime: 'nodejs20.x', handler: 'index.handler', role: 'arn:role'},
        })

        const command = sent[0] as CreateFunctionCommand
        expect(command).toBeInstanceOf(CreateFunctionCommand)
        expect(command.input.FunctionName).toBe('hello')
        expect(command.input.MemorySize).toBe(128)
        expect(command.input.Timeout).toBe(3)
        expect(command.input.Code?.ZipFile).toBeInstanceOf(Uint8Array)
    })

    test('deletes a function by name', async () => {
        const {client, sent} = stubLambda(() => ({}))
        await new AwsServerlessAdapter(client).delete('hello')

        expect((sent[0] as DeleteFunctionCommand).input.FunctionName).toBe('hello')
    })

    describe('invoke', () => {
        test('returns the decoded payload, status and duration', async () => {
            const {client, sent} = stubLambda(() => ({
                StatusCode: 200,
                Payload: new TextEncoder().encode('{"ok":true}'),
            }))
            const result = await new AwsServerlessAdapter(client).invoke('hello', '{"a":1}')

            const command = sent[0] as InvokeCommand
            expect(command).toBeInstanceOf(InvokeCommand)
            expect(command.input.FunctionName).toBe('hello')
            expect(command.input.LogType).toBe('Tail')
            expect(new TextDecoder().decode(command.input.Payload as Uint8Array)).toBe('{"a":1}')

            expect(result.statusCode).toBe(200)
            expect(result.payload).toBe('{"ok":true}')
            expect(result.executionDuration).toBeGreaterThanOrEqual(0)
            expect(result.functionError).toBeUndefined()
        })

        test('defaults an empty payload to an empty JSON object', async () => {
            const {client, sent} = stubLambda(() => ({StatusCode: 200}))
            await new AwsServerlessAdapter(client).invoke('hello', '')

            const command = sent[0] as InvokeCommand
            expect(new TextDecoder().decode(command.input.Payload as Uint8Array)).toBe('{}')
        })

        test('surfaces a handler error alongside the response payload', async () => {
            const {client} = stubLambda(() => ({
                StatusCode: 200,
                FunctionError: 'Unhandled',
                Payload: new TextEncoder().encode('{"errorMessage":"boom"}'),
            }))
            const result = await new AwsServerlessAdapter(client).invoke('hello', '{}')

            expect(result.functionError).toBe('Unhandled')
            expect(result.payload).toContain('boom')
        })

        test('decodes the base64 tailed log', async () => {
            const {client} = stubLambda(() => ({
                StatusCode: 200,
                LogResult: Buffer.from('START RequestId: abc\nEND', 'utf8').toString('base64'),
            }))
            const result = await new AwsServerlessAdapter(client).invoke('hello', '{}')

            expect(result.logResult).toContain('START RequestId: abc')
        })

        test('handles a missing payload without throwing', async () => {
            const {client} = stubLambda(() => ({StatusCode: 202}))
            const result = await new AwsServerlessAdapter(client).invoke('hello', '{}')

            expect(result.statusCode).toBe(202)
            expect(result.payload).toBe('')
        })
    })

    describe('triggers', () => {
        test('lists ESM triggers and S3 triggers for a function', async () => {
            const {client: lambdaClient} = stubLambda((cmd) => {
                if (cmd instanceof ListFunctionsCommand || (cmd as {constructor: {name: string}}).constructor.name === 'GetFunctionCommand') {
                    return {
                        Configuration: {
                            FunctionName: 'hello',
                            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                        },
                    }
                }
                return {
                    EventSourceMappings: [
                        {
                            UUID: 'esm-123',
                            EventSourceArn: 'arn:aws:dynamodb:us-east-1:000000000000:table/my-table/stream/2026-01-01',
                            State: 'Enabled',
                            BatchSize: 100,
                            StartingPosition: 'LATEST',
                        },
                        {
                            UUID: 'esm-456',
                            EventSourceArn: 'arn:aws:sqs:us-east-1:000000000000:my-queue',
                            State: 'Enabled',
                            BatchSize: 10,
                        },
                    ],
                }
            })

            const s3Client = {
                async send(cmd: {constructor: {name: string}; input?: {Bucket?: string}}) {
                    if (cmd.constructor.name === 'ListBucketsCommand') {
                        return {Buckets: [{Name: 'my-bucket', CreationDate: new Date('2026-01-01')}]}
                    }
                    if (cmd.constructor.name === 'GetBucketNotificationConfigurationCommand') {
                        return {
                            LambdaFunctionConfigurations: [
                                {
                                    Id: 's3-trig-1',
                                    LambdaFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                                    Events: ['s3:ObjectCreated:*'],
                                    Filter: {
                                        Key: {
                                            FilterRules: [{Name: 'prefix', Value: 'uploads/'}],
                                        },
                                    },
                                },
                            ],
                        }
                    }
                    return {}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, s3Client)
            const triggers = await adapter.listLambdaTriggers('hello')

            expect(triggers).toHaveLength(3)
            expect(triggers[0]).toMatchObject({
                id: 'esm-123',
                type: 'dynamodb',
                sourceName: 'my-table',
                status: 'Enabled',
            })
            expect(triggers[1]).toMatchObject({
                id: 'esm-456',
                type: 'sqs',
                sourceName: 'my-queue',
                status: 'Enabled',
            })
            expect(triggers[2]).toMatchObject({
                id: 's3-trig-1',
                type: 's3',
                sourceName: 'my-bucket',
                status: 'Active',
            })
            expect(triggers[2].details.prefix).toBe('uploads/')
        })

        test('lists ESM triggers following pagination markers', async () => {
            const {client: lambdaClient} = stubLambda((cmd) => {
                if (cmd.constructor.name === 'ListEventSourceMappingsCommand') {
                    const marker = (cmd as {input: {Marker?: string}}).input.Marker
                    if (!marker) {
                        return {
                            EventSourceMappings: [
                                {
                                    UUID: 'esm-page-1',
                                    EventSourceArn: 'arn:aws:sqs:us-east-1:000000000000:queue-1',
                                    State: 'Enabled',
                                },
                            ],
                            NextMarker: 'marker-2',
                        }
                    }
                    return {
                        EventSourceMappings: [
                            {
                                UUID: 'esm-page-2',
                                EventSourceArn: 'arn:aws:sqs:us-east-1:000000000000:queue-2',
                                State: 'Enabled',
                            },
                        ],
                    }
                }
                return {}
            })

            const s3Client = {
                async send(cmd: {constructor: {name: string}}) {
                    if (cmd.constructor.name === 'ListBucketsCommand') {
                        return {Buckets: []}
                    }
                    return {}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, s3Client)
            const triggers = await adapter.listLambdaTriggers('hello')

            expect(triggers).toHaveLength(2)
            expect(triggers[0].id).toBe('esm-page-1')
            expect(triggers[1].id).toBe('esm-page-2')
        })

        test('creates S3 trigger with AddPermission and updates bucket notification configuration', async () => {
            let addPermissionInput: unknown = null
            const {client: lambdaClient} = stubLambda((cmd) => {
                if (cmd.constructor.name === 'AddPermissionCommand') {
                    addPermissionInput = (cmd as {input: unknown}).input
                    return {}
                }
                return {
                    Configuration: {
                        FunctionName: 'hello',
                        FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                    },
                }
            })

            let putNotificationInput: unknown = null
            const s3Client = {
                async send(cmd: {constructor: {name: string}; input?: unknown}) {
                    if (cmd.constructor.name === 'GetBucketNotificationConfigurationCommand') {
                        return {LambdaFunctionConfigurations: []}
                    }
                    if (cmd.constructor.name === 'PutBucketNotificationConfigurationCommand') {
                        putNotificationInput = cmd.input
                        return {}
                    }
                    return {}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, s3Client)
            const created = await adapter.createLambdaTrigger('hello', {
                type: 's3',
                bucketName: 'test-bucket',
                events: ['s3:ObjectCreated:*'],
                prefix: 'raw/',
                suffix: '.json',
            })

            expect(created.type).toBe('s3')
            expect(created.sourceName).toBe('test-bucket')
            expect(created.details.prefix).toBe('raw/')
            expect(created.details.suffix).toBe('.json')
            expect(addPermissionInput).toMatchObject({
                FunctionName: 'hello',
                Action: 'lambda:InvokeFunction',
                Principal: 's3.amazonaws.com',
                SourceArn: 'arn:aws:s3:::test-bucket',
            })
            expect(putNotificationInput).not.toBeNull()
        })

        test('creates DynamoDB trigger with stream discovery', async () => {
            let createEsmInput: unknown = null
            const {client: lambdaClient} = stubLambda((cmd) => {
                if (cmd.constructor.name === 'CreateEventSourceMappingCommand') {
                    createEsmInput = (cmd as {input: unknown}).input
                    return {
                        UUID: 'esm-dynamo-1',
                        State: 'Enabled',
                        BatchSize: 100,
                        StartingPosition: 'LATEST',
                    }
                }
                return {}
            })

            const dynamoClient = {
                async send() {
                    return {
                        Table: {
                            LatestStreamArn: 'arn:aws:dynamodb:us-east-1:000000000000:table/users/stream/2026-01-01',
                        },
                    }
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, undefined as never, dynamoClient)
            const created = await adapter.createLambdaTrigger('hello', {
                type: 'dynamodb',
                tableName: 'users',
                batchSize: 50,
            })

            expect(created.type).toBe('dynamodb')
            expect(created.id).toBe('esm-dynamo-1')
            expect(created.sourceName).toBe('users')
            expect(createEsmInput).toMatchObject({
                FunctionName: 'hello',
                EventSourceArn: 'arn:aws:dynamodb:us-east-1:000000000000:table/users/stream/2026-01-01',
                BatchSize: 50,
            })
        })

        test('fails to create DynamoDB trigger if stream ARN is missing', async () => {
            const {client: lambdaClient} = stubLambda(() => ({}))
            const dynamoClient = {
                async send() {
                    return {Table: {LatestStreamArn: undefined}}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, undefined as never, dynamoClient)
            await expect(
                adapter.createLambdaTrigger('hello', {type: 'dynamodb', tableName: 'users'}),
            ).rejects.toThrow('DynamoDB stream is not enabled')
        })

        test('creates SQS trigger with queue name resolution via GetQueueUrl and GetQueueAttributes', async () => {
            let createEsmInput: unknown = null
            const {client: lambdaClient} = stubLambda((cmd) => {
                if (cmd.constructor.name === 'CreateEventSourceMappingCommand') {
                    createEsmInput = (cmd as {input: unknown}).input
                    return {
                        UUID: 'esm-sqs-1',
                        State: 'Enabled',
                        BatchSize: 10,
                    }
                }
                return {}
            })

            const sqsClient = {
                async send(cmd: {constructor: {name: string}; input?: unknown}) {
                    if (cmd.constructor.name === 'GetQueueUrlCommand') {
                        return {
                            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/my-test-queue',
                        }
                    }
                    if (cmd.constructor.name === 'GetQueueAttributesCommand') {
                        return {
                            Attributes: {
                                QueueArn: 'arn:aws:sqs:us-east-1:123456789012:my-test-queue',
                            },
                        }
                    }
                    return {}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, undefined as never, undefined as never, sqsClient)
            const created = await adapter.createLambdaTrigger('hello', {
                type: 'sqs',
                queueNameOrUrl: 'my-test-queue',
                batchSize: 10,
            })

            expect(created.type).toBe('sqs')
            expect(created.id).toBe('esm-sqs-1')
            expect(created.sourceName).toBe('my-test-queue')
            expect(createEsmInput).toMatchObject({
                FunctionName: 'hello',
                EventSourceArn: 'arn:aws:sqs:us-east-1:123456789012:my-test-queue',
                BatchSize: 10,
            })
        })

        test('deletes ESM trigger by UUID after verifying function ownership', async () => {
            let deletedUuid: string | null = null
            const {client: lambdaClient} = stubLambda((cmd) => {
                if (cmd.constructor.name === 'GetFunctionCommand') {
                    return {
                        Configuration: {
                            FunctionName: 'hello',
                            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                        },
                    }
                }
                if (cmd.constructor.name === 'GetEventSourceMappingCommand') {
                    return {
                        UUID: 'esm-123',
                        FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                    }
                }
                if (cmd.constructor.name === 'DeleteEventSourceMappingCommand') {
                    deletedUuid = (cmd as {input: {UUID: string}}).input.UUID
                    return {}
                }
                return {}
            })

            const adapter = new AwsServerlessAdapter(lambdaClient)
            await adapter.deleteLambdaTrigger('hello', 'esm-123')

            expect(deletedUuid as string | null).toBe('esm-123')
        })

        test('rejects ESM deletion when mapping belongs to another function', async () => {
            const {client: lambdaClient} = stubLambda((cmd) => {
                if (cmd.constructor.name === 'GetFunctionCommand') {
                    return {
                        Configuration: {
                            FunctionName: 'functionA',
                            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:functionA',
                        },
                    }
                }
                if (cmd.constructor.name === 'GetEventSourceMappingCommand') {
                    return {
                        UUID: 'esm-123',
                        FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:functionB',
                    }
                }
                return {}
            })

            const adapter = new AwsServerlessAdapter(lambdaClient)
            await expect(
                adapter.deleteLambdaTrigger('functionA', 'esm-123'),
            ).rejects.toThrow('Event source mapping esm-123 does not belong to function functionA')
        })

        test('deletes S3 trigger by synthetic bucket-index and checks function ARN', async () => {
            const {client: lambdaClient} = stubLambda(() => ({
                Configuration: {
                    FunctionName: 'hello',
                    FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                },
            }))
            let putNotificationInput: unknown = null
            const s3Client = {
                async send(cmd: {constructor: {name: string}; input?: unknown}) {
                    if (cmd.constructor.name === 'GetBucketNotificationConfigurationCommand') {
                        return {
                            LambdaFunctionConfigurations: [
                                {LambdaFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello'},
                                {Id: 'other-id', LambdaFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:other'},
                            ],
                        }
                    }
                    if (cmd.constructor.name === 'PutBucketNotificationConfigurationCommand') {
                        putNotificationInput = cmd.input
                        return {}
                    }
                    return {}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, s3Client)
            // Delete synthetic ID 'my-bucket-0'
            await adapter.deleteLambdaTrigger('hello', 'my-bucket-0', {type: 's3', bucket: 'my-bucket'})

            expect(putNotificationInput).toMatchObject({
                Bucket: 'my-bucket',
                NotificationConfiguration: {
                    LambdaFunctionConfigurations: [
                        {Id: 'other-id', LambdaFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:other'},
                    ],
                },
            })
        })

        test('does not delete notification using index ID if notification already has an explicit stored ID', async () => {
            const {client: lambdaClient} = stubLambda(() => ({
                Configuration: {
                    FunctionName: 'hello',
                    FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                },
            }))
            const s3Client = {
                async send(cmd: {constructor: {name: string}}) {
                    if (cmd.constructor.name === 'GetBucketNotificationConfigurationCommand') {
                        return {
                            LambdaFunctionConfigurations: [
                                {Id: 'real-stored-id', LambdaFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello'},
                            ],
                        }
                    }
                    return {}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, s3Client)
            // Attempting to delete using 'my-bucket-0' when the config has 'real-stored-id' must fail
            await expect(
                adapter.deleteLambdaTrigger('hello', 'my-bucket-0', {type: 's3', bucket: 'my-bucket'}),
            ).rejects.toThrow('not found or does not belong to function hello')
        })

        test('rejects S3 trigger deletion when trigger does not belong to target function', async () => {
            const {client: lambdaClient} = stubLambda(() => ({
                Configuration: {
                    FunctionName: 'hello',
                    FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:hello',
                },
            }))
            const s3Client = {
                async send(cmd: {constructor: {name: string}}) {
                    if (cmd.constructor.name === 'GetBucketNotificationConfigurationCommand') {
                        return {
                            LambdaFunctionConfigurations: [
                                {Id: 'victim-trigger', LambdaFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:otherFunction'},
                            ],
                        }
                    }
                    return {}
                },
            } as never

            const adapter = new AwsServerlessAdapter(lambdaClient, s3Client)
            await expect(
                adapter.deleteLambdaTrigger('hello', 'victim-trigger', {type: 's3', bucket: 'my-bucket'}),
            ).rejects.toThrow('not found or does not belong to function hello')
        })
    })
})

