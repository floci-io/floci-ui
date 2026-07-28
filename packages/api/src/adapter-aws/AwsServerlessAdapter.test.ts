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
})
