import {afterEach, describe, expect, test} from 'bun:test'
import {OciFunctionsAdapter} from './OciFunctionsAdapter'
import {OciRestRuntimeClient} from '../oci'
import {ConflictError, NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const API = `${ENDPOINT}/20181201`
const APP_ID = 'ocid1.fnapp.oc1.iad.app1'
const FN_ID = 'ocid1.fnfunc.oc1.iad.fn1'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciFunctionsAdapter {
    return new OciFunctionsAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

const application = {
    id: APP_ID,
    compartmentId: TENANCY,
    displayName: 'demo-app',
    lifecycleState: 'ACTIVE',
    subnetIds: ['ocid1.subnet.oc1.iad.a'],
    shape: 'GENERIC_X86',
    timeCreated: '2026-09-29T00:00:00Z',
    timeUpdated: '2026-09-29T00:00:01Z',
}

const fn = {
    id: FN_ID,
    applicationId: APP_ID,
    compartmentId: TENANCY,
    displayName: 'hello',
    lifecycleState: 'ACTIVE',
    image: 'iad.ocir.io/t/hello:0.0.1',
    imageDigest: 'sha256:abc',
    shape: 'GENERIC_X86',
    memoryInMBs: 128,
    timeoutInSeconds: 30,
    invokeEndpoint: 'http://localhost:4599',
    timeCreated: '2026-09-29T00:00:02Z',
    timeUpdated: '2026-09-29T00:00:03Z',
}

function listHandler(url: string): Response {
    if (url.startsWith(`${API}/applications?`)) return json([application])
    if (url.startsWith(`${API}/functions?`)) return json([fn])
    return json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404})
}

describe('OciFunctionsAdapter', () => {
    test('identifies itself as the OCI serverless adapter with invoke available', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('serverless')
        const schema = instance.schema()
        expect(schema.displayName).toBe('OCI Functions')
        const invoke = schema.capabilities?.resourceActions?.find((c) => c.name === 'invoke')
        expect(invoke?.status).toBe('available')
    })

    test('lists applications in the root compartment and functions per application', async () => {
        const calls = stubFetch(listHandler)
        const resources = await adapter().list()

        expect(calls[0]?.url).toBe(`${API}/applications?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(calls[1]?.url).toBe(`${API}/functions?applicationId=${encodeURIComponent(APP_ID)}`)
        expect(resources.map((r) => [r.type, r.id])).toEqual([
            ['oci-function-application', APP_ID],
            ['oci-function', FN_ID],
        ])
        expect(resources[0]).toMatchObject({
            name: 'demo-app',
            cloud: 'oci',
            service: 'serverless',
            region: 'us-ashburn-1',
            status: 'ACTIVE',
            createdAt: '2026-09-29T00:00:00Z',
        })
        expect(resources[0]?.metadata).toMatchObject({kind: 'application', subnetIds: ['ocid1.subnet.oc1.iad.a']})
        expect(resources[1]?.metadata).toMatchObject({
            kind: 'function',
            applicationId: APP_ID,
            applicationName: 'demo-app',
            image: 'iad.ocir.io/t/hello:0.0.1',
            memoryInMBs: 128,
            timeoutInSeconds: 30,
            lastModified: '2026-09-29T00:00:03Z',
        })
    })

    test('does not call ListFunctions when there are no applications', async () => {
        const calls = stubFetch(() => json([]))
        expect(await adapter().list()).toEqual([])
        expect(calls).toHaveLength(1)
    })

    test('follows opc-next-page when listing applications', async () => {
        const calls = stubFetch((url) => {
            if (url.includes('page=p2')) return json([{...application, id: 'ocid1.fnapp.oc1.iad.app2', displayName: 'second'}])
            if (url.startsWith(`${API}/applications?`)) {
                return new Response(JSON.stringify([application]), {headers: {'opc-next-page': 'p2'}})
            }
            return json([])
        })
        const resources = await adapter().list({filters: {kind: 'application'}})
        expect(resources.map((r) => r.name)).toEqual(['demo-app', 'second'])
        expect(calls.some((c) => c.url.includes('/functions?'))).toBe(false)
    })

    test('filters by kind and search', async () => {
        stubFetch(listHandler)
        expect((await adapter().list({filters: {kind: 'function'}})).map((r) => r.id)).toEqual([FN_ID])
        expect((await adapter().list({search: 'HEL'})).map((r) => r.id)).toEqual([FN_ID])
    })

    test('rejects an unknown kind filter', async () => {
        stubFetch(listHandler)
        await expect(adapter().list({filters: {kind: 'trigger'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('gets an application by OCID', async () => {
        const calls = stubFetch(() => json(application))
        const resource = await adapter().get(APP_ID)
        expect(calls[0]?.url).toBe(`${API}/applications/${APP_ID}`)
        expect(resource?.type).toBe('oci-function-application')
    })

    test('gets a function and resolves its application name', async () => {
        const calls = stubFetch((url) => json(url.includes('/functions/') ? fn : application))
        const resource = await adapter().get(FN_ID)
        expect(calls.map((c) => c.url)).toEqual([`${API}/functions/${FN_ID}`, `${API}/applications/${APP_ID}`])
        expect(resource?.metadata.applicationName).toBe('demo-app')
        expect(resource?.metadata.invokeEndpoint).toBe('http://localhost:4599')
    })

    test('returns null for a missing resource or a non-Functions OCID', async () => {
        stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'gone'}, {status: 404}))
        expect(await adapter().get(FN_ID)).toBeNull()
        expect(await adapter().get(APP_ID)).toBeNull()
        const calls = stubFetch(() => json({}))
        expect(await adapter().get('ocid1.bucket.oc1..x')).toBeNull()
        expect(calls).toHaveLength(0)
    })

    test('creates an application in the root compartment with its subnets', async () => {
        const calls = stubFetch(() => json(application))
        const resource = await adapter().create({
            values: {resourceType: 'application', displayName: 'demo-app', subnetIds: 'ocid1.subnet.oc1.iad.a, ocid1.subnet.oc1.iad.b', shape: 'GENERIC_ARM'},
        })
        expect(calls[0]?.url).toBe(`${API}/applications`)
        expect(calls[0]?.init?.method).toBe('POST')
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            compartmentId: TENANCY,
            displayName: 'demo-app',
            subnetIds: ['ocid1.subnet.oc1.iad.a', 'ocid1.subnet.oc1.iad.b'],
            shape: 'GENERIC_ARM',
        })
        expect(resource.id).toBe(APP_ID)
    })

    test('rejects an application without valid subnet OCIDs', async () => {
        const calls = stubFetch(() => json(application))
        await expect(adapter().create({values: {resourceType: 'application', displayName: 'a'}}))
            .rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {resourceType: 'application', displayName: 'a', subnetIds: 'subnet-1'}}))
            .rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('creates a function with image and memoryInMBs', async () => {
        const calls = stubFetch(() => json(fn))
        const resource = await adapter().create({
            values: {resourceType: 'function', displayName: 'hello', applicationId: APP_ID, image: fn.image, memoryInMBs: '256', timeoutInSeconds: '60'},
        })
        expect(calls[0]?.url).toBe(`${API}/functions`)
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            applicationId: APP_ID,
            displayName: 'hello',
            image: fn.image,
            memoryInMBs: 256,
            timeoutInSeconds: 60,
        })
        expect(resource.type).toBe('oci-function')
    })

    test('defaults create to a function and omits an unset timeout', async () => {
        const calls = stubFetch(() => json(fn))
        await adapter().create({values: {displayName: 'hello', applicationId: APP_ID, image: fn.image, memoryInMBs: 128}})
        expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty('timeoutInSeconds')
    })

    test('validates function input before calling the runtime', async () => {
        const calls = stubFetch(() => json(fn))
        const base = {resourceType: 'function', displayName: 'hello', applicationId: APP_ID, image: fn.image, memoryInMBs: '128'}
        for (const values of [
            {...base, applicationId: ''},
            {...base, applicationId: 'ocid1.subnet.oc1.iad.a'},
            {...base, image: ''},
            {...base, memoryInMBs: ''},
            {...base, memoryInMBs: '12.5'},
            {...base, memoryInMBs: '0'},
            {...base, timeoutInSeconds: '301'},
            {...base, resourceType: 'trigger'},
        ]) {
            await expect(adapter().create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('deletes by OCID kind and ignores an already-deleted resource', async () => {
        const calls = stubFetch(() => new Response(null, {status: 404}))
        await adapter().delete(FN_ID)
        await adapter().delete(APP_ID)
        expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
            ['DELETE', `${API}/functions/${FN_ID}`],
            ['DELETE', `${API}/applications/${APP_ID}`],
        ])
    })

    test('surfaces the 409 for an application that still has functions', async () => {
        stubFetch(() => json({code: 'Conflict', message: 'Application still contains functions.'}, {status: 409}))
        await expect(adapter().delete(APP_ID)).rejects.toBeInstanceOf(ConflictError)
    })

    test('rejects deleting an OCID that is not an application or function', async () => {
        const calls = stubFetch(() => json({}))
        await expect(adapter().delete('ocid1.bucket.oc1..x')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('invokes a function with the raw payload and returns the raw body', async () => {
        const calls = stubFetch(() => new Response('{"message":"hi"}', {status: 200, headers: {'content-type': 'application/json'}}))
        const result = await adapter().invoke(FN_ID, '{"name":"floci"}')
        expect(calls[0]?.url).toBe(`${API}/functions/${FN_ID}/actions/invoke`)
        expect(calls[0]?.init?.method).toBe('POST')
        expect(calls[0]?.init?.body).toBe('{"name":"floci"}')
        expect(result.statusCode).toBe(200)
        expect(result.payload).toBe('{"message":"hi"}')
        expect(typeof result.executionDuration).toBe('number')
    })

    test('invoke rejects an application and reports a missing function', async () => {
        const calls = stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'gone'}, {status: 404}))
        await expect(adapter().invoke(APP_ID, '{}')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
        await expect(adapter().invoke(FN_ID, '{}')).rejects.toBeInstanceOf(NotFoundError)
    })
})
