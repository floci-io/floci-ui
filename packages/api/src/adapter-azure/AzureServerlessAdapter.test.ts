import { describe, expect, test } from 'bun:test'
import type { AzureRuntimeClient, AzureRuntimeFetchOptions } from '../azure'
import { AzureServerlessAdapter } from './AzureServerlessAdapter'

interface RecordedCall {
    path: string
    init: RequestInit
    options?: AzureRuntimeFetchOptions
}

function azureFunction(name: string) {
    return {
        id: name,
        name,
        kind: 'functionapp',
        location: 'centralus',
        type: 'Microsoft.Web/sites/functions',
        properties: {
            state: 'Running',
            runtime: 'node',
            functionAppName: 'floci-functions',
            lastModifiedTimeUtc: '2026-06-22T05:29:13Z',
            scriptHref: `http://localhost:4577/functions/${name}/script`,
            invokeUrlTemplate: `http://localhost:4577/functions/${name}/invoke`,
            config: {
                bindings: [
                    {
                        type: 'httpTrigger',
                        direction: 'in',
                        name: 'req',
                    },
                ],
            },
            files: {
                'index.js': 'module.exports = async () => ({statusCode: 200})',
            },
        },
    }
}

function testClient(
    handler: (
        path: string,
        init: RequestInit,
        options?: AzureRuntimeFetchOptions,
    ) => Promise<Response | null>,
): AzureRuntimeClient {
    return {
        endpoint: 'http://localhost:4577',
        accountName: 'devstoreaccount1',
        fetch: handler,
    }
}

describe('AzureServerlessAdapter', () => {
    test('lists functions and maps the Azure resource shape', async () => {
        const client = testClient(async () =>
            new Response(
                JSON.stringify({
                    value: [azureFunction('hello')],
                }),
                { status: 200 },
            ),
        )

        const resources = await new AzureServerlessAdapter(client).list()

        expect(resources).toEqual([
            {
                id: 'hello',
                name: 'hello',
                cloud: 'azure',
                service: 'serverless',
                type: 'azure-function',
                region: 'centralus',
                createdAt: '2026-06-22T05:29:13Z',
                status: 'Running',
                metadata: {
                    provider: 'azure',
                    serverlessService: 'functions',
                    kind: 'functionapp',
                    resourceType: 'Microsoft.Web/sites/functions',
                    runtime: 'node',
                    functionAppName: 'floci-functions',
                    lastModified: '2026-06-22T05:29:13Z',
                    triggerType: 'httpTrigger',
                    scriptHref: 'http://localhost:4577/functions/hello/script',
                    invokeUrlTemplate: 'http://localhost:4577/functions/hello/invoke',
                    config: {
                        bindings: [
                            {
                                type: 'httpTrigger',
                                direction: 'in',
                                name: 'req',
                            },
                        ],
                    },
                    files: {
                        'index.js':
                            'module.exports = async () => ({statusCode: 200})',
                    },
                },
            },
        ])
    })

    test('handles missing trigger metadata gracefully', async () => {
        const functionWithoutBindings = azureFunction('hello')
        functionWithoutBindings.properties.config = {
            bindings: [],
        }

        const client = testClient(async () =>
            new Response(
                JSON.stringify({
                    value: [functionWithoutBindings],
                }),
                { status: 200 },
            ),
        )

        const resources = await new AzureServerlessAdapter(client).list()

        expect(resources[0].metadata.lastModified).toBe(
            '2026-06-22T05:29:13Z',
        )
        expect(resources[0].metadata.triggerType).toBeUndefined()
    })

    test('normalizes a missing list endpoint to an empty list', async () => {
        const client = testClient(async (_path, _init, options) => {
            if (options?.emptyOnNotFound) return null
            return new Response('Not Found', { status: 404 })
        })

        await expect(new AzureServerlessAdapter(client).list()).resolves.toEqual([])
    })

    test('filters listed functions by search term', async () => {
        const client = testClient(async () =>
            new Response(
                JSON.stringify({
                    value: [azureFunction('alpha'), azureFunction('beta')],
                }),
                { status: 200 },
            ),
        )

        const resources = await new AzureServerlessAdapter(client).list({
            search: 'bet',
        })

        expect(resources.map((resource) => resource.name)).toEqual(['beta'])
    })

    test('gets and maps a single function', async () => {
        const client = testClient(async () =>
            new Response(JSON.stringify(azureFunction('hello')), { status: 200 }),
        )

        const resource = await new AzureServerlessAdapter(client).get('hello')

        expect(resource?.id).toBe('hello')
        expect(resource?.status).toBe('Running')
        expect(resource?.metadata.runtime).toBe('node')
    })

    test('get returns null when the function is missing', async () => {
        const client = testClient(async (_path, _init, options) => {
            if (options?.emptyOnNotFound) return null
            return new Response('Not Found', { status: 404 })
        })

        await expect(
            new AzureServerlessAdapter(client).get('missing'),
        ).resolves.toBeNull()
    })

    test('create posts the expected payload and maps the response', async () => {
        const calls: RecordedCall[] = []

        const client = testClient(async (path, init, options) => {
            calls.push({ path, init, options })
            return new Response(JSON.stringify(azureFunction('hello')), {
                status: 201,
            })
        })

        const resource = await new AzureServerlessAdapter(client).create({
            values: {
                functionName: 'hello',
                runtime: 'node',
                handler: 'index.handler',
                code: 'module.exports.handler = async () => ({statusCode: 200})',
                location: 'centralus',
                functionAppName: 'floci-functions',
            },
        })

        expect(calls).toHaveLength(1)
        expect(calls[0].path).toBe('/functions')
        expect(calls[0].init.method).toBe('POST')
        expect(calls[0].init.headers).toEqual({
            accept: 'application/json',
            'content-type': 'application/json',
        })
        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            name: 'hello',
            runtime: 'node',
            handler: 'index.handler',
            code: 'module.exports.handler = async () => ({statusCode: 200})',
            location: 'centralus',
            functionAppName: 'floci-functions',
        })
        expect(resource.id).toBe('hello')
    })

    test('create defaults runtime to node', async () => {
        let sentBody = ''

        const client = testClient(async (_path, init) => {
            sentBody = String(init.body)
            return new Response(JSON.stringify(azureFunction('hello')), {
                status: 201,
            })
        })

        await new AzureServerlessAdapter(client).create({
            values: {
                functionName: 'hello',
            },
        })

        expect(JSON.parse(sentBody)).toEqual({
            name: 'hello',
            runtime: 'node',
        })
    })

    test('create rejects when functionName is missing', async () => {
        const client = testClient(async () =>
            new Response(JSON.stringify({}), { status: 200 }),
        )

        await expect(
            new AzureServerlessAdapter(client).create({
                values: {},
            }),
        ).rejects.toThrow('functionName is required')
    })

    test('create rejects when the runtime returns an empty response', async () => {
        const client = testClient(async () =>
            new Response(null, { status: 204 }),
        )

        await expect(
            new AzureServerlessAdapter(client).create({
                values: {
                    functionName: 'hello',
                },
            }),
        ).rejects.toThrow('Azure Functions create returned an empty response')
    })

    test('delete issues a DELETE request against the function path', async () => {
        const calls: RecordedCall[] = []

        const client = testClient(async (path, init, options) => {
            calls.push({ path, init, options })
            return new Response(null, { status: 204 })
        })

        await new AzureServerlessAdapter(client).delete('hello')

        expect(calls).toHaveLength(1)
        expect(calls[0].path).toBe('/functions/hello')
        expect(calls[0].init.method).toBe('DELETE')
        expect(calls[0].options).toEqual({
            emptyOnNotFound: true,
        })
    })

    test('invoke posts the payload and maps the response', async () => {
        const calls: RecordedCall[] = []

        const client = testClient(async (path, init, options) => {
            calls.push({ path, init, options })
            return new Response(
                JSON.stringify({
                    statusCode: 202,
                    payload: {
                        message: 'accepted',
                    },
                    functionError: 'Handled',
                    logResult: 'execution log',
                }),
                { status: 200 },
            )
        })

        const result = await new AzureServerlessAdapter(client).invoke(
            'hello',
            '{"name":"Hajira"}',
        )

        expect(calls).toHaveLength(1)
        expect(calls[0].path).toBe('/functions/hello/invoke')
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            payload: '{"name":"Hajira"}',
        })
        expect(result.statusCode).toBe(202)
        expect(result.payload).toBe('{"message":"accepted"}')
        expect(result.functionError).toBe('Handled')
        expect(result.logResult).toBe('execution log')
        expect(result.executionDuration).toBeGreaterThanOrEqual(0)
    })

    test('invoke uses an empty JSON object when payload is blank', async () => {
        let sentBody = ''

        const client = testClient(async (_path, init) => {
            sentBody = String(init.body)
            return new Response(
                JSON.stringify({
                    statusCode: 200,
                    body: 'ok',
                }),
                { status: 200 },
            )
        })

        const result = await new AzureServerlessAdapter(client).invoke(
            'hello',
            '   ',
        )

        expect(JSON.parse(sentBody)).toEqual({
            payload: '{}',
        })
        expect(result.payload).toBe('ok')
    })

    test('lists functions from a direct array response', async () => {
        const client = testClient(async () =>
            new Response(
                JSON.stringify([azureFunction('hello')]),
                { status: 200 },
            ),
        )

        const resources = await new AzureServerlessAdapter(client).list()

        expect(resources).toHaveLength(1)
        expect(resources[0].id).toBe('hello')
        expect(resources[0].type).toBe('azure-function')
    })
    test('propagates runtime errors from the Azure client', async () => {
        const client = testClient(async () => {
            throw new Error('Azure Functions request failed: HTTP 500')
        })

        await expect(
            new AzureServerlessAdapter(client).list(),
        ).rejects.toThrow('Azure Functions request failed: HTTP 500')
    })
})
