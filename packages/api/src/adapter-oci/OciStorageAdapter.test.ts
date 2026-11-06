import {afterEach, describe, expect, test} from 'bun:test'
import {OciStorageAdapter} from './OciStorageAdapter'
import {OciRestRuntimeClient} from '../oci'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const BUCKETS = `${ENDPOINT}/n/floci-local/b`

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciStorageAdapter {
    return new OciStorageAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
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

describe('OciStorageAdapter', () => {
    test('identifies itself as the OCI storage adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('storage')
        expect(instance.schema().displayName).toBe('OCI Object Storage')
    })

    test('lists buckets in the tenancy root compartment', async () => {
        const calls = stubFetch(() => json([
            {namespace: 'floci-local', name: 'app', compartmentId: TENANCY, timeCreated: '2026-09-29T00:00:00Z', etag: 'e1'},
        ]))
        const [resource] = await adapter().list()

        expect(calls[0]?.url).toBe(`${BUCKETS}?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(resource).toMatchObject({
            id: 'app',
            name: 'app',
            cloud: 'oci',
            service: 'storage',
            type: 'bucket',
            region: 'us-ashburn-1',
            createdAt: '2026-09-29T00:00:00Z',
        })
        expect(resource?.metadata.compartmentId).toBe(TENANCY)
    })

    test('filters the list by search term', async () => {
        stubFetch(() => json([{name: 'app-data'}, {name: 'logs'}]))
        const resources = await adapter().list({search: 'APP'})
        expect(resources.map((r) => r.name)).toEqual(['app-data'])
    })

    test('get returns null for a missing bucket', async () => {
        stubFetch(() => json({code: 'BucketNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().get('missing')).resolves.toBeNull()
    })

    test('creates a bucket in the root compartment', async () => {
        const calls = stubFetch(() => json({name: 'fresh', id: 'ocid1.bucket.oc1.iad.x', storageTier: 'Standard'}))
        const resource = await adapter().create({values: {bucketName: 'fresh'}})

        expect(calls[0]?.url).toBe(BUCKETS)
        expect(calls[0]?.init?.method).toBe('POST')
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({name: 'fresh', compartmentId: TENANCY})
        expect(resource.metadata).toMatchObject({ocid: 'ocid1.bucket.oc1.iad.x', storageTier: 'Standard'})
    })

    test('rejects an invalid bucket name before calling the runtime', async () => {
        const calls = stubFetch(() => json({}))
        await expect(adapter().create({values: {bucketName: 'has spaces'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toEqual([])
    })

    test('deletes a bucket', async () => {
        const calls = stubFetch(() => new Response(null, {status: 204}))
        await adapter().delete('app')

        expect(calls[0]?.url).toBe(`${BUCKETS}/app`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })

    test('lists folders and objects under a prefix, asking for the summary fields', async () => {
        const calls = stubFetch(() => json({
            prefixes: ['dir/sub/'],
            objects: [{name: 'dir/a.txt', size: 5, timeModified: '2026-09-29T01:00:00Z', etag: 'e2'}],
        }))
        const listing = await adapter().listObjects('app', 'dir/')

        const url = new URL(calls[0]!.url)
        expect(url.pathname).toBe('/n/floci-local/b/app/o')
        expect(url.searchParams.get('prefix')).toBe('dir/')
        expect(url.searchParams.get('delimiter')).toBe('/')
        expect(url.searchParams.get('fields')).toContain('size')
        expect(listing.objects).toEqual([
            expect.objectContaining({key: 'dir/sub/', name: 'sub', type: 'folder'}),
            expect.objectContaining({key: 'dir/a.txt', name: 'a.txt', type: 'object', size: 5, lastModified: '2026-09-29T01:00:00Z'}),
        ])
    })

    test('follows nextStartWith across object pages', async () => {
        const calls = stubFetch((url) => url.includes('start=b')
            ? json({objects: [{name: 'b'}]})
            : json({objects: [{name: 'a'}], nextStartWith: 'b'}))
        const listing = await adapter().listObjects('app')

        expect(calls).toHaveLength(2)
        expect(listing.objects.map((o) => o.key)).toEqual(['a', 'b'])
    })

    test('lists past 100 object pages', async () => {
        const calls = stubFetch((url) => {
            const page = Number(new URL(url).searchParams.get('start') ?? '0')
            return json(page < 150
                ? {objects: [{name: `o${page}`}], nextStartWith: String(page + 1)}
                : {objects: [{name: `o${page}`}]})
        })
        const listing = await adapter().listObjects('app')

        expect(calls).toHaveLength(151)
        expect(listing.objects).toHaveLength(151)
    })

    test('stops when the runtime repeats a nextStartWith', async () => {
        const calls = stubFetch(() => json({objects: [{name: 'a'}], nextStartWith: 'a'}))
        await adapter().listObjects('app')

        expect(calls).toHaveLength(2)
    })

    test('reports a folder once when a page boundary splits its group', async () => {
        stubFetch((url) => url.includes('start=')
            ? json({prefixes: ['m/'], objects: [{name: 'z'}]})
            : json({prefixes: ['m/'], objects: [{name: 'a'}], nextStartWith: 'm/x'}))
        const listing = await adapter().listObjects('app')

        expect(listing.objects.filter((o) => o.type === 'folder').map((o) => o.key)).toEqual(['m/'])
    })

    test('uploads with PUT, encoding the whole object name as one segment', async () => {
        const calls = stubFetch(() => new Response(null, {status: 200}))
        await adapter().putObject('app', 'dir/a b.txt', new TextEncoder().encode('hi'), 'text/plain')

        expect(calls[0]?.url).toBe(`${BUCKETS}/app/o/dir%2Fa%20b.txt`)
        expect(calls[0]?.init?.method).toBe('PUT')
    })

    test('keeps the trailing slash of a folder marker', async () => {
        const calls = stubFetch(() => new Response(null, {status: 200}))
        await adapter().putObject('app', 'newfolder/', new Uint8Array(), 'application/octet-stream')

        expect(calls[0]?.url).toBe(`${BUCKETS}/app/o/newfolder%2F`)
    })

    test('downloads an object', async () => {
        stubFetch(() => new Response('hello', {status: 200, headers: {'content-type': 'text/plain', 'content-length': '5'}}))
        const download = await adapter().getObject('app', 'a.txt')

        expect(await new Response(download.body).text()).toBe('hello')
        expect(download.contentType).toBe('text/plain')
        expect(download.contentLength).toBe(5)
    })

    test('reports a missing object as not found', async () => {
        stubFetch(() => json({code: 'ObjectNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().getObject('app', 'missing')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('copies an object through the CopyObject action', async () => {
        const calls = stubFetch(() => new Response(null, {status: 202, headers: {'opc-work-request-id': 'wr'}}))
        await adapter().copyObject('app', 'a.txt', 'b.txt', 'other')

        expect(calls[0]?.url).toBe(`${BUCKETS}/app/actions/copyObject`)
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            sourceObjectName: 'a.txt',
            destinationRegion: 'us-ashburn-1',
            destinationNamespace: 'floci-local',
            destinationBucket: 'other',
            destinationObjectName: 'b.txt',
        })
    })
})

describe('OciStorageAdapter pre-authenticated requests', () => {
    const PARS = `${BUCKETS}/app/p`
    const future = '2030-01-01T00:00:00Z'

    test('declares the item actions it implements', () => {
        const instance = adapter()
        const names = instance.schema().capabilities?.itemActions?.map((action) => action.name)
        expect(names).toEqual(['list', 'put', 'delete'])
        expect(typeof instance.items?.listItems).toBe('function')
        expect(typeof instance.items?.putItem).toBe('function')
        expect(typeof instance.items?.deleteItem).toBe('function')
    })

    test('lists an empty bucket as an empty page', async () => {
        const calls = stubFetch(() => json([]))
        const page = await adapter().items!.listItems('app')
        expect(calls[0]?.url).toBe(PARS)
        expect(page).toEqual({items: [], nextCursor: null})
    })

    test('lists requests without the access path', async () => {
        stubFetch(() => json([{
            id: 'abc:p1', name: 'p1', accessType: 'AnyObjectRead', timeCreated: '2026-11-06T00:00:00Z',
            timeExpires: future, fullPath: '/p/secret/n/floci-local/b/app/o/',
        }]))
        const {items} = await adapter().items!.listItems('app')
        expect(items[0]).toMatchObject({id: 'abc:p1', timestamp: '2026-11-06T00:00:00Z'})
        expect(items[0]?.body).toMatchObject({name: 'p1', accessType: 'AnyObjectRead', timeExpires: future})
        expect(JSON.stringify(items[0])).not.toContain('secret')
        expect(items[0]?.body).not.toHaveProperty('fullPath')
    })

    test('creates a request and returns the access path once', async () => {
        const calls = stubFetch(() => json({
            id: 'abc:p2', name: 'p2', accessType: 'ObjectRead', objectName: 'a.txt', timeExpires: future,
            accessUri: '/p/tok/n/floci-local/b/app/o/a.txt', fullPath: '/p/tok/n/floci-local/b/app/o/a.txt',
        }))
        const item = await adapter().items!.putItem!('app', {
            name: ' p2 ', accessType: 'ObjectRead', objectName: 'a.txt', timeExpires: future,
        })
        expect(calls[0]?.url).toBe(PARS)
        expect(calls[0]?.init?.method).toBe('POST')
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            name: 'p2', accessType: 'ObjectRead', objectName: 'a.txt', timeExpires: '2030-01-01T00:00:00.000Z',
        })
        expect(item.body.accessUri).toBe('/p/tok/n/floci-local/b/app/o/a.txt')
    })

    test('keeps the object name exactly as given', async () => {
        const calls = stubFetch(() => json({id: 'abc:p3', name: 'p3', accessType: 'ObjectRead', timeExpires: future}))
        await adapter().items!.putItem!('app', {
            name: 'p3', accessType: 'ObjectRead', objectName: ' report.txt ', timeExpires: future,
        })
        expect(JSON.parse(String(calls[0]?.init?.body)).objectName).toBe(' report.txt ')
    })

    test('rejects an expiry in the past without calling the runtime', async () => {
        const calls = stubFetch(() => json({}))
        await expect(adapter().items!.putItem!('app', {
            name: 'p', accessType: 'AnyObjectRead', timeExpires: '2020-01-01T00:00:00Z',
        })).rejects.toThrow(new ValidationError('timeExpires must be in the future'))
        expect(calls).toHaveLength(0)
    })

    test('rejects invalid input', async () => {
        stubFetch(() => json({}))
        const put = (body: Record<string, unknown>) => adapter().items!.putItem!('app', body)
        await expect(put({accessType: 'AnyObjectRead', timeExpires: future})).rejects.toThrow('name is required')
        await expect(put({name: 'p', accessType: 'Nope', timeExpires: future})).rejects.toThrow('accessType must be one of')
        await expect(put({name: 'p', accessType: 'AnyObjectRead'})).rejects.toThrow('timeExpires is required')
        await expect(put({name: 'p', accessType: 'AnyObjectRead', timeExpires: 'soon'})).rejects.toThrow('valid date')
        await expect(put({name: 'p', accessType: 'ObjectRead', timeExpires: future})).rejects.toThrow('objectName is required')
        await expect(put({name: 'p', accessType: 'AnyObjectRead', objectName: 'a', timeExpires: future}))
            .rejects.toThrow('objectName is only valid')
    })

    test('deletes a request by its encoded id', async () => {
        const calls = stubFetch(() => new Response(null, {status: 204}))
        await adapter().items!.deleteItem!('app', 'abc:p1')
        expect(calls[0]?.url).toBe(`${PARS}/abc%3Ap1`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })

    test('a missing bucket surfaces as not found', async () => {
        stubFetch(() => json({code: 'BucketNotFound', message: 'no'}, {status: 404}))
        await expect(adapter().items!.listItems('nope')).rejects.toBeInstanceOf(NotFoundError)
    })
})
