import {afterEach, describe, expect, test} from 'bun:test'
import {OciRestRuntimeClient, ociEndpoint, ociNamespace, ociRegion, ociTenancyId} from './oci'
import {ConflictError, NotFoundError, RuntimeUnavailableError} from './cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'

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

function client(namespace?: string): OciRestRuntimeClient {
    return new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', namespace)
}

describe('environment defaults', () => {
    test("fall back to Floci-OCI's documented local defaults", () => {
        expect(ociEndpoint()).toBe(ENDPOINT)
        expect(ociTenancyId()).toBe(TENANCY)
        expect(ociRegion()).toBe('us-ashburn-1')
        expect(ociNamespace()).toBeUndefined()
    })
})

describe('OciRestRuntimeClient.fetch', () => {
    test('prefixes the endpoint and returns the response', async () => {
        const calls = stubFetch(() => new Response('[]', {status: 200}))
        const res = await client().fetch('/n/floci-local/b')

        expect(calls[0]).toBe(`${ENDPOINT}/n/floci-local/b`)
        expect(res?.status).toBe(200)
    })

    test('turns a transport failure into a runtime-unavailable error', async () => {
        stubFetch(() => {
            throw Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})
        })
        await expect(client().fetch('/n/')).rejects.toThrow(`Cannot reach Floci-OCI at ${ENDPOINT}`)
    })

    test('returns null for a 404 when asked to', async () => {
        stubFetch(() => new Response('', {status: 404}))
        await expect(client().fetch('/x', {}, {emptyOnNotFound: true})).resolves.toBeNull()
    })

    test("maps the status and surfaces OCI's code and message as detail", async () => {
        stubFetch(() => new Response(
            JSON.stringify({code: 'BucketNotFound', message: "Either the bucket named 'nope' does not exist"}),
            {status: 404, headers: {'content-type': 'application/json'}},
        ))
        const error = await client().fetch('/n/floci-local/b/nope').catch((e: unknown) => e)

        expect(error).toBeInstanceOf(NotFoundError)
        expect((error as Error).message).toContain("BucketNotFound: Either the bucket named 'nope' does not exist")
    })

    test('maps a 409 to a conflict', async () => {
        stubFetch(() => new Response(JSON.stringify({code: 'Conflict', message: 'not empty'}), {status: 409}))
        await expect(client().fetch('/x')).rejects.toBeInstanceOf(ConflictError)
    })

    test('falls back to the raw body when it is not an OCI error body', async () => {
        stubFetch(() => new Response('<html>boom</html>', {status: 500}))
        await expect(client().fetch('/x')).rejects.toThrow('boom')
    })
})

describe('OciRestRuntimeClient.listAll', () => {
    test('follows opc-next-page until it is absent', async () => {
        const calls = stubFetch((url) => url.includes('page=p2')
            ? new Response('[{"name":"b"}]', {status: 200})
            : new Response('[{"name":"a"}]', {status: 200, headers: {'opc-next-page': 'p2'}}))

        await expect(client().listAll('/n/ns/b?compartmentId=c')).resolves.toEqual([{name: 'a'}, {name: 'b'}])
        expect(calls).toEqual([
            `${ENDPOINT}/n/ns/b?compartmentId=c`,
            `${ENDPOINT}/n/ns/b?compartmentId=c&page=p2`,
        ])
    })
})

describe('OciRestRuntimeClient.namespace', () => {
    test('discovers the namespace once and caches it', async () => {
        const calls = stubFetch(() => new Response('"floci-local"', {status: 200}))
        const runtime = client()

        await expect(runtime.namespace()).resolves.toBe('floci-local')
        await expect(runtime.namespace()).resolves.toBe('floci-local')
        expect(calls).toEqual([`${ENDPOINT}/n/`])
    })

    test('retries discovery after a failure', async () => {
        let up = false
        stubFetch(() => {
            if (!up) throw Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})
            return new Response('"floci-local"', {status: 200})
        })
        const runtime = client()

        await expect(runtime.namespace()).rejects.toBeInstanceOf(RuntimeUnavailableError)
        up = true
        await expect(runtime.namespace()).resolves.toBe('floci-local')
    })

    test('uses a configured namespace without calling the runtime', async () => {
        const calls = stubFetch(() => new Response('"other"', {status: 200}))

        await expect(client('configured').namespace()).resolves.toBe('configured')
        expect(calls).toEqual([])
    })
})

describe('OciRestRuntimeClient.health', () => {
    test("probes the runtime's own health endpoint", async () => {
        const calls = stubFetch(() => new Response('{"services":{"objectstorage":"running"}}', {status: 200}))
        await client().health()

        expect(calls[0]).toBe(`${ENDPOINT}/_floci-oci/health`)
    })

    test('reports 5xx as unavailable', async () => {
        stubFetch(() => new Response('', {status: 503}))
        await expect(client().health()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })
})
