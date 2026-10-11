import {afterEach, describe, expect, test} from 'bun:test'
import {GcpStorageAdapter} from './GcpStorageAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpStorageAdapter {
    return new GcpStorageAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

/** Records every request so path, method, headers and body can be asserted. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function bucket(name: string, overrides: Record<string, unknown> = {}) {
    return {
        id: name,
        name,
        location: 'US',
        storageClass: 'STANDARD',
        timeCreated: '2026-07-28T09:21:30.065Z',
        updated: '2026-07-29T10:00:00.000Z',
        ...overrides,
    }
}

describe('GcpStorageAdapter', () => {
    test('identifies itself as the GCP storage adapter', () => {
        const a = adapter()

        expect(a.cloud).toBe('gcp')
        expect(a.service).toBe('storage')
        expect(a.schema().displayName).toBe('Google Cloud Storage')
    })

    describe('buckets', () => {
        test('lists buckets for the configured project and maps the resource shape', async () => {
            const calls = stubFetch(() => json({items: [bucket('assets')]}))
            const [resource] = await adapter().list()

            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b?project=floci-local`)
            expect(resource).toEqual({
                id: 'assets',
                name: 'assets',
                cloud: 'gcp',
                service: 'storage',
                type: 'bucket',
                region: 'US',
                createdAt: '2026-07-28T09:21:30.065Z',
                metadata: {
                    provider: 'gcp',
                    storageService: 'cloud-storage',
                    storageClass: 'STANDARD',
                    updated: '2026-07-29T10:00:00.000Z',
                },
            })
        })

        test('reports an empty list when the runtime returns no items key', async () => {
            // GCS answers `{"kind": "storage#buckets"}` with no `items` when empty.
            stubFetch(() => json({kind: 'storage#buckets'}))

            await expect(adapter().list()).resolves.toEqual([])
        })

        test('filters by search on the bucket name, case-insensitively', async () => {
            stubFetch(() => json({items: [bucket('Logs-Archive'), bucket('assets')]}))

            const matches = await adapter().list({search: ' LOGS '})

            expect(matches.map((r) => r.id)).toEqual(['Logs-Archive'])
        })

        test('get returns the bucket', async () => {
            const calls = stubFetch(() => json(bucket('assets')))
            const resource = await adapter().get('assets')

            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b/assets`)
            expect(resource?.id).toBe('assets')
        })

        test('get returns null on 404 instead of throwing', async () => {
            stubFetch(() => json({error: {code: 404, message: 'bucket not found'}}, 404))

            await expect(adapter().get('missing')).resolves.toBeNull()
        })

        test('get encodes the bucket id into the path', async () => {
            const calls = stubFetch(() => json(bucket('a b')))
            await adapter().get('a b')

            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b/a%20b`)
        })

        test('create posts the bucket name to the project', async () => {
            const calls = stubFetch(() => json(bucket('new-bucket')))
            const resource = await adapter().create({values: {bucketName: '  new-bucket  '}})

            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b?project=floci-local`)
            expect(calls[0]?.init?.method).toBe('POST')
            expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({name: 'new-bucket'})
            expect(resource.id).toBe('new-bucket')
        })

        test('create falls back to the requested name when the runtime returns an empty body', async () => {
            stubFetch(() => new Response('null', {status: 200}))
            const resource = await adapter().create({values: {bucketName: 'new-bucket'}})

            expect(resource.name).toBe('new-bucket')
            expect(resource.cloud).toBe('gcp')
        })

        test('create requires a bucket name', async () => {
            const calls = stubFetch(() => json(bucket('x')))

            await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().create({values: {bucketName: '   '}})).rejects.toThrow('bucketName is required')
            expect(calls).toHaveLength(0)
        })

        test.each(['ab', 'Upper-Case', '-leading', 'trailing-', 'has space', 'a'.repeat(64)])(
            'create rejects the invalid bucket name %p before calling the runtime',
            async (bucketName) => {
                const calls = stubFetch(() => json(bucket('x')))

                await expect(adapter().create({values: {bucketName}})).rejects.toBeInstanceOf(ValidationError)
                expect(calls).toHaveLength(0)
            },
        )

        test.each(['abc', 'my.bucket_name-1', 'a'.repeat(63)])('create accepts the valid bucket name %p', async (bucketName) => {
            stubFetch(() => json(bucket(bucketName)))

            await expect(adapter().create({values: {bucketName}})).resolves.toMatchObject({id: bucketName})
        })

        test('create surfaces a conflict from the runtime', async () => {
            stubFetch(() => json({error: {code: 409, message: 'You already own this bucket'}}, 409))

            const result = adapter().create({values: {bucketName: 'taken'}})

            await expect(result).rejects.toThrow('You already own this bucket')
        })

        test('delete issues a DELETE and tolerates a bucket that is already gone', async () => {
            const calls = stubFetch(() => new Response(null, {status: 404}))

            await expect(adapter().delete('assets')).resolves.toBeUndefined()
            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b/assets`)
            expect(calls[0]?.init?.method).toBe('DELETE')
        })

        test('delete still surfaces a real failure', async () => {
            stubFetch(() => json({error: {code: 409, message: 'The bucket you tried to delete is not empty'}}, 409))

            await expect(adapter().delete('assets')).rejects.toThrow('not empty')
        })
    })

    describe('objects', () => {
        test('lists a bucket root as folders and objects', async () => {
            const calls = stubFetch(() =>
                json({
                    prefixes: ['logs/'],
                    items: [
                        {
                            name: 'readme.txt',
                            size: '120',
                            updated: '2026-07-29T10:00:00.000Z',
                            timeCreated: '2026-07-28T09:00:00.000Z',
                            contentType: 'text/plain',
                            storageClass: 'STANDARD',
                            etag: 'abc',
                        },
                    ],
                }),
            )
            const result = await adapter().listObjects('assets')
            const url = new URL(calls[0]!.url)

            expect(url.pathname).toBe('/storage/v1/b/assets/o')
            expect(url.searchParams.get('delimiter')).toBe('/')
            expect(url.searchParams.has('prefix')).toBe(false)
            expect(result.prefix).toBe('')
            expect(result.objects).toEqual([
                {
                    key: 'logs/',
                    name: 'logs',
                    type: 'folder',
                    size: null,
                    lastModified: null,
                    metadata: {provider: 'gcp', storageService: 'cloud-storage', prefix: 'logs/'},
                },
                {
                    key: 'readme.txt',
                    name: 'readme.txt',
                    type: 'object',
                    size: 120,
                    lastModified: '2026-07-29T10:00:00.000Z',
                    metadata: {
                        provider: 'gcp',
                        storageService: 'cloud-storage',
                        contentType: 'text/plain',
                        storageClass: 'STANDARD',
                        etag: 'abc',
                    },
                },
            ])
        })

        test('lists inside a prefix, names entries relative to it and drops the folder placeholder', async () => {
            const calls = stubFetch(() =>
                json({
                    prefixes: ['logs/2026/'],
                    items: [{name: 'logs/'}, {name: 'logs/app.log', size: '7'}],
                }),
            )
            const result = await adapter().listObjects('assets', 'logs/')
            const url = new URL(calls[0]!.url)

            expect(url.searchParams.get('prefix')).toBe('logs/')
            expect(result.prefix).toBe('logs/')
            expect(result.objects.map((o) => [o.type, o.key, o.name])).toEqual([
                ['folder', 'logs/2026/', '2026'],
                ['object', 'logs/app.log', 'app.log'],
            ])
        })

        test('returns no objects for an empty bucket', async () => {
            stubFetch(() => json({kind: 'storage#objects'}))

            await expect(adapter().listObjects('assets')).resolves.toEqual({prefix: '', objects: []})
        })

        test('reports a null size when the runtime omits or garbles it', async () => {
            stubFetch(() => json({items: [{name: 'a'}, {name: 'b', size: 'not-a-number'}]}))
            const result = await adapter().listObjects('assets')

            expect(result.objects.map((o) => o.size)).toEqual([null, null])
        })

        test('putObject uploads with the media upload type and the given content type', async () => {
            const calls = stubFetch(() => json({name: 'dir/a b.txt'}))
            await adapter().putObject('assets', 'dir/a b.txt', new TextEncoder().encode('hello'), 'text/plain')

            const url = new URL(calls[0]!.url)
            expect(url.pathname).toBe('/upload/storage/v1/b/assets/o')
            expect(url.searchParams.get('uploadType')).toBe('media')
            expect(url.searchParams.get('name')).toBe('dir/a b.txt')
            expect(calls[0]?.init?.method).toBe('POST')
            expect((calls[0]?.init?.headers as Record<string, string>)['content-type']).toBe('text/plain')
            expect(new TextDecoder().decode(calls[0]?.init?.body as ArrayBuffer)).toBe('hello')
        })

        test('getObject returns the bytes with the runtime content type and length', async () => {
            const calls = stubFetch(
                () => new Response('hello', {status: 200, headers: {'content-type': 'text/plain', 'content-length': '5'}}),
            )
            const download = await adapter().getObject('assets', 'dir/a.txt')

            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b/assets/o/dir%2Fa.txt?alt=media`)
            expect(await new Response(download.body).text()).toBe('hello')
            expect(download.contentType).toBe('text/plain')
            expect(download.contentLength).toBe(5)
        })

        test('getObject falls back to octet-stream when the runtime sends no content type', async () => {
            stubFetch(() => {
                const res = new Response(new Uint8Array([1, 2, 3]), {status: 200})
                res.headers.delete('content-type')
                return res
            })
            const download = await adapter().getObject('assets', 'blob')

            expect(download.contentType).toBe('application/octet-stream')
        })

        test('getObject maps a missing object to NotFoundError', async () => {
            stubFetch(() => json({error: {code: 404, message: 'No such object: assets/nope'}}, 404))

            const result = adapter().getObject('assets', 'nope')

            await expect(result).rejects.toBeInstanceOf(NotFoundError)
            await expect(result).rejects.toThrow('No such object')
        })

        test('deleteObject issues a DELETE and tolerates a missing object', async () => {
            const calls = stubFetch(() => new Response(null, {status: 404}))

            await expect(adapter().deleteObject('assets', 'dir/a.txt')).resolves.toBeUndefined()
            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b/assets/o/dir%2Fa.txt`)
            expect(calls[0]?.init?.method).toBe('DELETE')
        })

        test('copyObject copies within the same bucket by default', async () => {
            const calls = stubFetch(() => json({}))
            await adapter().copyObject('assets', 'a.txt', 'b.txt')

            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b/assets/o/a.txt/copyTo/b/assets/o/b.txt`)
            expect(calls[0]?.init?.method).toBe('POST')
        })

        test('copyObject targets another bucket when one is given', async () => {
            const calls = stubFetch(() => json({}))
            await adapter().copyObject('assets', 'dir/a.txt', 'dir/b.txt', 'backup')

            expect(calls[0]?.url).toBe(`${ENDPOINT}/storage/v1/b/assets/o/dir%2Fa.txt/copyTo/b/backup/o/dir%2Fb.txt`)
        })
    })

    describe('runtime errors', () => {
        test('reports an unreachable runtime as RuntimeUnavailableError', async () => {
            globalThis.fetch = (async () => {
                throw new Error('connect ECONNREFUSED')
            }) as unknown as typeof fetch

            const result = adapter().list()

            await expect(result).rejects.toBeInstanceOf(RuntimeUnavailableError)
            await expect(result).rejects.toThrow('Cannot reach Floci-GCP')
        })

        test("carries Google's structured error message through", async () => {
            stubFetch(() => json({error: {code: 400, message: 'Invalid argument', status: 'INVALID_ARGUMENT'}}, 400))

            const result = adapter().list()

            await expect(result).rejects.toBeInstanceOf(ValidationError)
            await expect(result).rejects.toThrow('Invalid argument')
        })
    })
})
