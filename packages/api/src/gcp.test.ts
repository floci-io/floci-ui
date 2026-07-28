import {afterEach, describe, expect, test} from 'bun:test'
import {GcpRestRuntimeClient, gcpEndpoint, gcpLocation, gcpProject} from './gcp'
import {NotFoundError, NotImplementedByRuntimeError, RuntimeUnavailableError, ValidationError} from './cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: string[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push(String(url))
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function client(): GcpRestRuntimeClient {
    return new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1')
}

describe('environment defaults', () => {
    test('falls back to the documented local endpoints', () => {
        expect(gcpEndpoint()).toBe(ENDPOINT)
        expect(gcpProject()).toBe('floci-local')
        expect(gcpLocation()).toBe('us-central1')
    })
})

describe('GcpRestRuntimeClient.fetch', () => {
    test('prefixes the endpoint and returns the response', async () => {
        const calls = stubFetch(() => new Response('{"ok":true}', {status: 200}))
        const res = await client().fetch('/storage/v1/b')

        expect(calls[0]).toBe(`${ENDPOINT}/storage/v1/b`)
        expect(res?.status).toBe(200)
    })

    test('turns a transport failure into a runtime-unavailable error', async () => {
        stubFetch(() => {
            throw Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})
        })
        await expect(client().fetch('/storage/v1/b')).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })

    test('returns null for a 404 when asked to', async () => {
        stubFetch(() => new Response('not found', {status: 404}))
        await expect(client().fetch('/x', {}, {emptyOnNotFound: true})).resolves.toBeNull()
    })

    test('throws a typed error for a 404 otherwise', async () => {
        stubFetch(() => new Response('not found', {status: 404}))
        await expect(client().fetch('/x')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('maps a runtime 501 to not-implemented', async () => {
        stubFetch(() => new Response('nope', {status: 501}))
        await expect(client().fetch('/x')).rejects.toBeInstanceOf(NotImplementedByRuntimeError)
    })

    test('maps a runtime 400 to a validation error', async () => {
        stubFetch(() => new Response('bad', {status: 400}))
        await expect(client().fetch('/x')).rejects.toBeInstanceOf(ValidationError)
    })

    test("surfaces Google's structured error message as detail", async () => {
        // The previous per-adapter fetch discarded the body entirely, leaving
        // callers with a bare "HTTP 500".
        stubFetch(() => new Response(
            JSON.stringify({error: {code: 404, message: 'Bucket nope does not exist', status: 'NOT_FOUND'}}),
            {status: 404, headers: {'content-type': 'application/json'}},
        ))

        await expect(client().fetch('/storage/v1/b/nope')).rejects.toThrow('Bucket nope does not exist')
    })

    test('falls back to the raw body when it is not a Google error envelope', async () => {
        stubFetch(() => new Response('<html>Resource not found</html>', {status: 404}))
        await expect(client().fetch('/x')).rejects.toThrow('Resource not found')
    })
})

describe('GcpRestRuntimeClient.json', () => {
    test('parses the body', async () => {
        stubFetch(() => new Response('{"kind":"storage#buckets"}', {status: 200}))
        await expect(client().json('/storage/v1/b')).resolves.toEqual({kind: 'storage#buckets'})
    })

    test('returns null when the resource is absent', async () => {
        stubFetch(() => new Response('', {status: 404}))
        await expect(client().json('/x', {}, {emptyOnNotFound: true})).resolves.toBeNull()
    })
})

describe('GcpRestRuntimeClient.health', () => {
    test("probes the runtime's own health endpoint", async () => {
        const calls = stubFetch(() => new Response('{"services":{"gcs":"running"}}', {status: 200}))
        await client().health()

        // Deliberately not /_floci/health, which this runtime 404s.
        expect(calls[0]).toBe(`${ENDPOINT}/_floci-gcp/health`)
    })

    test('treats any non-5xx as reachable', async () => {
        // "Responded at all" is the signal — an older runtime without this exact
        // path still proves the process is up and routing.
        for (const status of [200, 401, 403, 404]) {
            stubFetch(() => new Response('', {status}))
            await expect(client().health()).resolves.toBeUndefined()
        }
    })

    test('reports 5xx as unavailable', async () => {
        stubFetch(() => new Response('', {status: 503}))
        await expect(client().health()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })

    test('reports a refused connection as unavailable', async () => {
        stubFetch(() => {
            throw Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})
        })
        await expect(client().health()).rejects.toThrow(`Cannot reach Floci-GCP at ${ENDPOINT}`)
    })
})
