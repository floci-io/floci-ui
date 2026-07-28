import {afterEach, describe, expect, test} from 'bun:test'
import {GcpCloudFunctionsAdapter} from './GcpCloudFunctionsAdapter'
import {GcpRestRuntimeClient} from '../gcp'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const FUNCTIONS_PATH = '/v2/projects/floci-local/locations/us-central1/functions'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpCloudFunctionsAdapter {
    return new GcpCloudFunctionsAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function gen2Function(name: string) {
    return {
        name: `projects/floci-local/locations/us-central1/functions/${name}`,
        buildConfig: {runtime: 'nodejs20', entryPoint: 'helloWorld'},
        serviceConfig: {
            uri: `https://us-central1-floci-local.cloudfunctions.net/${name}`,
            availableMemory: '256M',
            service: `projects/floci-local/locations/us-central1/services/${name}`,
            revision: `projects/floci-local/locations/us-central1/functions/${name}/revisions/${name}-00001`,
            allTrafficOnLatestRevision: true,
        },
        state: 'ACTIVE',
        environment: 'GEN_2',
        url: `https://us-central1-floci-local.cloudfunctions.net/${name}`,
        createTime: '2026-06-22T05:29:13Z',
        updateTime: '2026-06-22T05:29:13Z',
    }
}

describe('GcpCloudFunctionsAdapter', () => {
    test('lists functions and maps the Gen2 resource shape', async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({
            functions: [gen2Function('hello')],
        }), {status: 200})) as unknown as typeof fetch

        const resources = await adapter().list()
        expect(resources).toEqual([
            {
                id: 'hello',
                name: 'hello',
                cloud: 'gcp',
                service: 'serverless',
                type: 'gcp-function',
                region: 'us-central1',
                createdAt: '2026-06-22T05:29:13Z',
                status: 'ACTIVE',
                metadata: {
                    provider: 'gcp',
                    serverlessService: 'cloud-functions',
                    resourceName: 'projects/floci-local/locations/us-central1/functions/hello',
                    environment: 'GEN_2',
                    runtime: 'nodejs20',
                    entryPoint: 'helloWorld',
                    availableMemory: '256M',
                    timeoutSeconds: undefined,
                    uri: 'https://us-central1-floci-local.cloudfunctions.net/hello',
                    service: 'projects/floci-local/locations/us-central1/services/hello',
                    revision: 'projects/floci-local/locations/us-central1/functions/hello/revisions/hello-00001',
                    allTrafficOnLatestRevision: true,
                    updateTime: '2026-06-22T05:29:13Z',
                    // Shared key so one serverless column works across all clouds.
                    lastModified: '2026-06-22T05:29:13Z',
                    labels: undefined,
                },
            },
        ])
    })

    test('normalizes an empty list payload', async () => {
        globalThis.fetch = (async () => new Response('{}', {status: 200})) as unknown as typeof fetch
        await expect(adapter().list()).resolves.toEqual([])
    })

    test('filters the list by search term', async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({
            functions: [gen2Function('alpha'), gen2Function('beta')],
        }), {status: 200})) as unknown as typeof fetch

        const resources = await adapter().list({search: 'bet'})
        expect(resources.map((r) => r.name)).toEqual(['beta'])
    })

    test('get returns null when the function is missing', async () => {
        globalThis.fetch = (async () => new Response('Not Found', {status: 404})) as unknown as typeof fetch
        await expect(adapter().get('missing')).resolves.toBeNull()
    })

    test('create posts buildConfig with functionId and unwraps the operation response', async () => {
        const calls: Array<{url: string; init: RequestInit}> = []
        globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
            calls.push({url: String(url), init})
            return new Response(JSON.stringify({
                done: true,
                response: gen2Function('hello'),
            }), {status: 200})
        }) as unknown as typeof fetch

        const resource = await adapter().create({
            values: {functionName: 'hello', runtime: 'nodejs20', entryPoint: 'helloWorld'},
        })

        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe(`${ENDPOINT}${FUNCTIONS_PATH}?functionId=hello`)
        expect(calls[0].init.method).toBe('POST')
        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            buildConfig: {runtime: 'nodejs20', entryPoint: 'helloWorld'},
        })
        expect(resource.id).toBe('hello')
        expect(resource.status).toBe('ACTIVE')
        expect(resource.metadata.runtime).toBe('nodejs20')
    })

    test('create includes inline code as buildConfig.source when provided', async () => {
        let sentBody = ''
        globalThis.fetch = (async (_url: RequestInfo | URL, init: RequestInit) => {
            sentBody = String(init.body)
            return new Response(JSON.stringify({done: true, response: gen2Function('hello')}), {status: 200})
        }) as unknown as typeof fetch

        await adapter().create({
            values: {functionName: 'hello', runtime: 'nodejs20', entryPoint: 'helloWorld', code: 'exports.helloWorld = () => {}'},
        })
        expect(JSON.parse(sentBody)).toEqual({
            buildConfig: {
                runtime: 'nodejs20',
                entryPoint: 'helloWorld',
                source: {inlineCode: 'exports.helloWorld = () => {}'},
            },
        })
    })

    test('create rejects when required fields are missing', async () => {
        await expect(adapter().create({values: {functionName: 'hello'}})).rejects.toThrow('runtime is required')
    })

    test('delete issues a DELETE against the function path', async () => {
        const calls: Array<{url: string; method?: string}> = []
        globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit) => {
            calls.push({url: String(url), method: init.method})
            return new Response(JSON.stringify({done: true, response: {}}), {status: 200})
        }) as unknown as typeof fetch

        await adapter().delete('hello')
        expect(calls[0].url).toBe(`${ENDPOINT}${FUNCTIONS_PATH}/hello`)
        expect(calls[0].method).toBe('DELETE')
    })
})
