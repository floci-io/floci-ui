import {describe, expect, test} from 'bun:test'
import {join} from 'node:path'
import {
    DeleteBucketCommand,
    DeleteObjectsCommand,
    type DeleteObjectsCommandInput,
    GetBucketTaggingCommand,
    GetBucketVersioningCommand,
    ListBucketsCommand,
    ListObjectVersionsCommand,
    type ListObjectVersionsCommandInput,
    S3Client,
    type S3ClientConfig,
} from '@aws-sdk/client-s3'
import {AccessDeniedError, CloudError, ConflictError, RuntimeError, RuntimeUnavailableError} from '../cloud-spi/errors'
import {withDeadline} from '../service/deadline'
import {AwsStorageAdapter} from './AwsStorageAdapter'

function fakeS3(overrides: Partial<{
    buckets: Array<{Name: string; CreationDate?: Date}>
    tagSet: Array<{Key: string; Value: string}>
    taggingError: Error
    onGetBucketTagging: (bucketName: string) => void
    versioning: {Status?: string} | Error
    onGetBucketVersioning: (bucketName: string) => void
    deleteBucketError: Error
}> = {}): S3Client {
    return {
        send: async (command: unknown) => {
            if (command instanceof GetBucketVersioningCommand) {
                overrides.onGetBucketVersioning?.(command.input.Bucket ?? '')
                if (overrides.versioning instanceof Error) throw overrides.versioning
                return overrides.versioning ?? {}
            }
            if (command instanceof DeleteBucketCommand) {
                if (overrides.deleteBucketError) throw overrides.deleteBucketError
                return {}
            }
            if (command instanceof ListBucketsCommand) {
                return {
                    Buckets: overrides.buckets ?? [
                        {Name: 'my-tf-test-bucket', CreationDate: new Date('2026-01-01')},
                    ],
                }
            }
            if (command instanceof GetBucketTaggingCommand) {
                overrides.onGetBucketTagging?.((command as {input: {Bucket: string}}).input.Bucket)
                if (overrides.taggingError) throw overrides.taggingError
                return {TagSet: overrides.tagSet ?? [{Key: 'Environment', Value: 'dev'}]}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        },
    } as unknown as S3Client
}

describe('AwsStorageAdapter', () => {
    test('list includes bucket tags in metadata', async () => {
        const adapter = new AwsStorageAdapter(fakeS3())
        const result = await adapter.list()

        expect(result).toHaveLength(1)
        expect(result[0].metadata.tags).toEqual([{key: 'Environment', value: 'dev'}])
        expect(result[0].metadata.tagsUnavailable).toBe(false)
    })

    test('list returns empty tags for untagged bucket instead of throwing', async () => {
        const error = new Error('The TagSet does not exist')
        error.name = 'NoSuchTagSet'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result[0].metadata.tags).toEqual([])
        expect(result[0].metadata.tagsUnavailable).toBe(false)
    })

    test('list does not fail entirely when tag fetch is denied for a bucket', async () => {
        const error = new Error('Access Denied')
        error.name = 'AccessDenied'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result).toHaveLength(1)
        expect(result[0].metadata.tags).toEqual([])
    })

    test('list marks tags unavailable (not empty) when tag fetch is denied', async () => {
        const error = new Error('Access Denied')
        error.name = 'AccessDenied'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result[0].metadata.tagsUnavailable).toBe(true)
    })

    test('list marks tags unavailable on transport/runtime failures too', async () => {
        const error = new Error('socket hang up')
        error.name = 'TimeoutError'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result[0].metadata.tags).toEqual([])
        expect(result[0].metadata.tagsUnavailable).toBe(true)
    })

    test('search filters buckets before fetching tags, not after', async () => {
        const requestedBuckets: string[] = []
        const adapter = new AwsStorageAdapter(fakeS3({
            buckets: [
                {Name: 'prod-logs'},
                {Name: 'dev-logs'},
                {Name: 'prod-assets'},
            ],
            onGetBucketTagging: (bucketName) => requestedBuckets.push(bucketName),
        }))

        const result = await adapter.list({search: 'prod'})

        expect(result.map((r) => r.name).sort()).toEqual(['prod-assets', 'prod-logs'])
        expect(requestedBuckets.sort()).toEqual(['prod-assets', 'prod-logs'])
    })
})

function sdkError(name: string, httpStatusCode: number): Error {
    return Object.assign(new Error(`${name} from the runtime`), {name, $fault: 'client', $metadata: {httpStatusCode}})
}

describe('AwsStorageAdapter bucket detail', () => {
    for (const [answer, expected] of [
        [{Status: 'Enabled'}, 'Enabled'],
        [{Status: 'Suspended'}, 'Suspended'],
        [{}, 'Disabled'],
        [{Status: 'Paused'}, 'Unknown'],
        [sdkError('AccessDenied', 403), 'Unknown'],
    ] as const) {
        test(`get reports versioning ${expected} for ${answer instanceof Error ? 'a failed read' : JSON.stringify(answer)}`, async () => {
            const adapter = new AwsStorageAdapter(fakeS3({versioning: answer}))

            const bucket = await adapter.get('my-tf-test-bucket')

            expect(bucket?.metadata.versioning).toBe(expected)
            expect(bucket?.metadata).not.toHaveProperty('versioningEnabled')
        })
    }

    test('list does not read versioning, and get skips it for a missing bucket', async () => {
        const reads: string[] = []
        const adapter = new AwsStorageAdapter(fakeS3({onGetBucketVersioning: (name) => reads.push(name)}))

        const listed = await adapter.list()
        const missing = await adapter.get('no-such-bucket')

        expect(listed[0].metadata).not.toHaveProperty('versioning')
        expect(missing).toBeNull()
        expect(reads).toEqual([])
    })
})

describe('AwsStorageAdapter delete', () => {
    test('BucketNotEmpty becomes a conflict that points at Empty bucket', async () => {
        const adapter = new AwsStorageAdapter(fakeS3({deleteBucketError: Object.assign(new Error('The bucket you tried to delete is not empty'), {name: 'BucketNotEmpty'})}))

        const error = await adapter.delete('logs').catch((err: unknown) => err)

        expect(error).toBeInstanceOf(ConflictError)
        expect((error as Error).message).toContain('Empty bucket')
    })

    test('only the BucketNotEmpty name is mapped, not a bare 409 status', async () => {
        const original = sdkError('OperationAborted', 409)
        const adapter = new AwsStorageAdapter(fakeS3({deleteBucketError: original}))

        const error = await adapter.delete('logs').catch((err: unknown) => err)

        expect(error).toBe(original)
    })
})

interface StoredVersion {
    Key: string
    VersionId: string
    deleteMarker?: boolean
}

interface SentCommand {
    command: unknown
    abortSignal?: AbortSignal
}

/**
 * Stateful ListObjectVersions / DeleteObjects fake that pages the way the Floci
 * runtime does: a page resumes after the (KeyMarker, VersionIdMarker) entry, and
 * when that version no longer exists the rest of the key is skipped. Entries are
 * kept in key order, newest version first within a key.
 */
function versionedBucket(initial: StoredVersion[], options: {
    pageSize?: number
    deleteError?: (id: {Key?: string; VersionId?: string}) => {Code: string; Message: string} | undefined
    beforeSend?: (command: unknown, sent: SentCommand[]) => void | Promise<void>
} = {}) {
    let store = [...initial].sort((a, b) => compareKeys(a.Key, b.Key))
    const sent: SentCommand[] = []

    function listPage(input: ListObjectVersionsCommandInput) {
        const maxKeys = input.MaxKeys ?? options.pageSize ?? 1000
        const {KeyMarker: keyMarker, VersionIdMarker: versionIdMarker} = input
        let afterMarker = false
        const remaining = !keyMarker ? store : store.filter((entry) => {
            const order = compareKeys(entry.Key, keyMarker)
            if (order < 0) return false
            if (order > 0 || afterMarker) return true
            if (versionIdMarker && entry.VersionId === versionIdMarker) afterMarker = true
            return false
        })
        const page = remaining.slice(0, maxKeys)
        const truncated = remaining.length > page.length
        const last = page.at(-1)
        return {
            Versions: page.filter((entry) => !entry.deleteMarker).map(({Key, VersionId}) => ({Key, VersionId})),
            DeleteMarkers: page.filter((entry) => entry.deleteMarker).map(({Key, VersionId}) => ({Key, VersionId})),
            IsTruncated: truncated,
            NextKeyMarker: truncated ? last?.Key : undefined,
            NextVersionIdMarker: truncated ? last?.VersionId : undefined,
        }
    }

    function deleteBatch(input: DeleteObjectsCommandInput) {
        const errors = []
        for (const id of input.Delete?.Objects ?? []) {
            const failure = options.deleteError?.(id)
            if (failure) {
                errors.push({Key: id.Key, VersionId: id.VersionId, ...failure})
                continue
            }
            store = store.filter((entry) => !(entry.Key === id.Key && entry.VersionId === id.VersionId))
        }
        return errors.length ? {Errors: errors} : {}
    }

    const client = {
        send: async (command: unknown, sendOptions?: {abortSignal?: AbortSignal}) => {
            sent.push({command, abortSignal: sendOptions?.abortSignal})
            await options.beforeSend?.(command, sent)
            // Like the SDK, a send whose signal fired while it was in flight rejects.
            if (sendOptions?.abortSignal?.aborted) throw sendOptions.abortSignal.reason
            if (command instanceof ListObjectVersionsCommand) return listPage(command.input)
            if (command instanceof DeleteObjectsCommand) return deleteBatch(command.input)
            throw new Error(`Unexpected command: ${(command as object)?.constructor?.name}`)
        },
    } as unknown as S3Client

    return {
        client,
        sent,
        remaining: () => store,
        add: (entry: StoredVersion) => {
            store = [...store, entry].sort((a, b) => compareKeys(a.Key, b.Key))
        },
    }
}

function compareKeys(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

function versionsOf(key: string, count: number): StoredVersion[] {
    return Array.from({length: count}, (_, index) => ({Key: key, VersionId: `${key}-v${count - index}`}))
}

const deleteCalls = (sent: SentCommand[]) =>
    sent.map((entry) => entry.command).filter((command): command is DeleteObjectsCommand => command instanceof DeleteObjectsCommand)
const listCalls = (sent: SentCommand[]) =>
    sent.map((entry) => entry.command).filter((command): command is ListObjectVersionsCommand => command instanceof ListObjectVersionsCommand)

/** The shape this change replaces: delete each page as soon as it is listed. */
async function deletePerPage(client: S3Client, bucket: string): Promise<void> {
    let keyMarker: string | undefined
    let versionIdMarker: string | undefined
    for (;;) {
        const page = await client.send(new ListObjectVersionsCommand({Bucket: bucket, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker}))
        const ids = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(({Key, VersionId}) => ({Key, VersionId}))
        if (ids.length) await client.send(new DeleteObjectsCommand({Bucket: bucket, Delete: {Objects: ids}}))
        if (!page.IsTruncated) return
        keyMarker = page.NextKeyMarker
        versionIdMarker = page.NextVersionIdMarker
    }
}

describe('AwsStorageAdapter emptyBucket', () => {
    test('deletes versions, delete markers and literal null versions, keeping the bucket', async () => {
        const bucket = versionedBucket([
            {Key: 'a.txt', VersionId: 'a-2'},
            {Key: 'a.txt', VersionId: 'a-1'},
            {Key: 'b.txt', VersionId: 'b-marker', deleteMarker: true},
            {Key: 'b.txt', VersionId: 'null'},
            {Key: 'c.txt', VersionId: 'null'},
        ])

        const result = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned')

        expect(result).toEqual({deleted: 5})
        expect(bucket.remaining()).toEqual([])
        const sentIds = deleteCalls(bucket.sent).flatMap((command) => command.input.Delete?.Objects ?? [])
        expect(sentIds).toContainEqual({Key: 'b.txt', VersionId: 'null'})
        expect(sentIds).toContainEqual({Key: 'b.txt', VersionId: 'b-marker'})
        expect(sentIds.every((id) => typeof id.VersionId === 'string')).toBe(true)
    })

    test('lists the whole inventory, forwarding both markers, before the first delete', async () => {
        const bucket = versionedBucket([...versionsOf('a.txt', 3), ...versionsOf('b.txt', 2)], {pageSize: 2})

        await new AwsStorageAdapter(bucket.client).emptyBucket('versioned')

        const kinds = bucket.sent.map((entry) => entry.command instanceof DeleteObjectsCommand ? 'delete' : 'list')
        expect(kinds).toEqual(['list', 'list', 'list', 'delete', 'list'])
        const lists = listCalls(bucket.sent)
        expect(lists.slice(0, 3).map((command) => [command.input.KeyMarker, command.input.VersionIdMarker])).toEqual([
            [undefined, undefined],
            ['a.txt', 'a.txt-v2'],
            ['b.txt', 'b.txt-v2'],
        ])
        for (const command of lists) {
            expect(command.input.Prefix).toBeUndefined()
            expect(command.input.Delimiter).toBeUndefined()
        }
    })

    test('empties more than 1,000 versions of one key in batches of at most 1,000', async () => {
        const bucket = versionedBucket(versionsOf('hot.txt', 2_500))

        const result = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned')

        expect(result).toEqual({deleted: 2_500})
        expect(bucket.remaining()).toEqual([])
        expect(deleteCalls(bucket.sent).map((command) => command.input.Delete?.Objects?.length)).toEqual([1_000, 1_000, 500])
    })

    test('negative control: deleting page by page leaves versions of that key behind', async () => {
        const bucket = versionedBucket(versionsOf('hot.txt', 2_500))

        await deletePerPage(bucket.client, 'versioned')

        expect(bucket.remaining().length).toBe(1_500)
    })

    test('an already empty bucket sends no delete', async () => {
        const bucket = versionedBucket([])

        const result = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned')

        expect(result).toEqual({deleted: 0})
        expect(deleteCalls(bucket.sent)).toEqual([])
    })

    test('a version that appears only at the final check fails instead of reporting success', async () => {
        const bucket = versionedBucket(versionsOf('a.txt', 2), {
            beforeSend: (command) => {
                if (command instanceof DeleteObjectsCommand) bucket.add({Key: 'late.txt', VersionId: 'late-1'})
            },
        })

        const error = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned').catch((err: unknown) => err)

        expect(error).toBeInstanceOf(ConflictError)
        expect((error as Error).message).toContain('Stop writes to the bucket')
    })

    test('per-object errors inside an HTTP 200 fail with bounded detail and partial-deletion wording', async () => {
        const longKey = `k${'x'.repeat(400)}`
        const bucket = versionedBucket([...versionsOf('a.txt', 5), {Key: longKey, VersionId: 'null'}, ...versionsOf('z.txt', 12)], {
            deleteError: (id) => id.Key === 'a.txt' ? undefined : {Code: 'AccessDenied', Message: 'Access Denied'},
        })

        const error = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned').catch((err: unknown) => err)

        expect(error).toBeInstanceOf(RuntimeError)
        const message = (error as Error).message
        expect(message).toContain('stopped after deletion started')
        expect(message).toContain('refused to delete 13 of 18 entries')
        expect(message).toContain(`key=${longKey.slice(0, 256)}..., versionId=null, code=AccessDenied, message=Access Denied`)
        expect(message).not.toContain(longKey)
        expect(message.split('\n').filter((line) => line.startsWith('key=')).length).toBe(10)
        expect(message).toContain('3 more not shown.')
    })

    test('a listing failure says nothing was deleted and keeps its error class', async () => {
        const bucket = versionedBucket(versionsOf('a.txt', 3), {
            pageSize: 2,
            beforeSend: (command, sent) => {
                if (command instanceof ListObjectVersionsCommand && sent.length === 2) throw sdkError('AccessDenied', 403)
            },
        })

        const error = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned').catch((err: unknown) => err)

        expect(error).toBeInstanceOf(AccessDeniedError)
        expect((error as Error).message).toContain('stopped before deleting anything')
        expect(deleteCalls(bucket.sent)).toEqual([])
    })

    for (const [label, failingBatch] of [['the first in-flight', 1], ['a later', 2]] as const) {
        test(`an SDK exception from ${label} delete batch warns of partial deletion`, async () => {
            let batches = 0
            const bucket = versionedBucket(versionsOf('a.txt', 1_500), {
                beforeSend: (command) => {
                    if (command instanceof DeleteObjectsCommand && ++batches === failingBatch) throw new Error('socket hang up')
                },
            })

            const error = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned').catch((err: unknown) => err)

            expect(error).toBeInstanceOf(RuntimeError)
            expect((error as Error).message).toContain('stopped after deletion started')
            expect((error as Error).message).toContain('socket hang up')
        })
    }

    for (const [label, page] of [
        ['a truncated page without markers', {IsTruncated: true, Versions: [{Key: 'a', VersionId: '1'}]}],
        ['an entry without a version ID', {IsTruncated: false, Versions: [{Key: 'a'}]}],
        ['an entry without a key', {IsTruncated: false, DeleteMarkers: [{VersionId: '1'}]}],
    ] as const) {
        test(`rejects ${label} before deleting`, async () => {
            const sent: unknown[] = []
            const client = {send: async (command: unknown) => (sent.push(command), page)} as unknown as S3Client

            const error = await new AwsStorageAdapter(client).emptyBucket('versioned').catch((err: unknown) => err)

            expect(error).toBeInstanceOf(RuntimeError)
            expect((error as Error).message).toContain('stopped before deleting anything')
            expect(sent.some((command) => command instanceof DeleteObjectsCommand)).toBe(false)
        })
    }

    test('rejects continuation markers that do not advance', async () => {
        const page = {IsTruncated: true, Versions: [{Key: 'a', VersionId: '1'}], NextKeyMarker: 'a', NextVersionIdMarker: '1'}
        let lists = 0
        const client = {
            send: async () => {
                if (++lists > 3) throw new Error('kept paging on a cursor that never moved')
                return page
            },
        } as unknown as S3Client

        const error = await new AwsStorageAdapter(client).emptyBucket('versioned').catch((err: unknown) => err)

        expect(error).toBeInstanceOf(RuntimeError)
        expect((error as Error).message).toContain('same continuation markers twice')
        expect(lists).toBe(2)
    })

    test('passes the signal to every listing request but lets a sent delete batch finish', async () => {
        const controller = new AbortController()
        const bucket = versionedBucket(versionsOf('a.txt', 3), {pageSize: 2})

        await new AwsStorageAdapter(bucket.client).emptyBucket('versioned', {signal: controller.signal})

        expect(bucket.sent.length).toBe(4)
        const lists = bucket.sent.filter((entry) => entry.command instanceof ListObjectVersionsCommand)
        expect(lists.length).toBe(3)
        expect(lists.every((entry) => entry.abortSignal === controller.signal)).toBe(true)
        const deletes = bucket.sent.filter((entry) => entry.command instanceof DeleteObjectsCommand)
        expect(deletes.length).toBe(1)
        expect(deletes[0].abortSignal).toBeInstanceOf(AbortSignal)
        expect(deletes[0].abortSignal).not.toBe(controller.signal)
    })

    test('an aborted request sends nothing and says nothing was deleted', async () => {
        const controller = new AbortController()
        controller.abort()
        const bucket = versionedBucket(versionsOf('a.txt', 3))

        const error = await new AwsStorageAdapter(bucket.client).emptyBucket('versioned', {signal: controller.signal}).catch((err: unknown) => err)

        expect(error).toBeInstanceOf(RuntimeUnavailableError)
        expect((error as Error).message).toContain('stopped before deleting anything: the request was cancelled')
        expect(bucket.sent).toEqual([])
    })

    test('a deadline during the first delete batch starts no further request', async () => {
        const bucket = versionedBucket(versionsOf('a.txt', 2_500), {
            beforeSend: async (command) => {
                if (command instanceof DeleteObjectsCommand) await Bun.sleep(60)
            },
        })

        const error = await withDeadline(20, undefined, (signal) => new AwsStorageAdapter(bucket.client).emptyBucket('versioned', {signal}))
            .catch((err: unknown) => err)

        expect(error).toBeInstanceOf(RuntimeUnavailableError)
        expect((error as CloudError).status).toBe(503)
        expect((error as Error).message).toContain('stopped after deletion started')
        expect((error as Error).message).toContain('ran past its time limit')
        expect(deleteCalls(bucket.sent).length).toBe(1)
        expect(bucket.sent.at(-1)?.command).toBeInstanceOf(DeleteObjectsCommand)
        // The batch in flight at the deadline was not cut off: all of it was applied.
        expect(bucket.remaining().length).toBe(1_500)
    })
})

describe('AwsStorageAdapter emptyBucket at the deadline', () => {
    test('a batch in flight when the deadline fires reports its own per-object refusal', async () => {
        const bucket = versionedBucket(versionsOf('a.txt', 2), {
            beforeSend: async (command) => {
                if (command instanceof DeleteObjectsCommand) await Bun.sleep(60)
            },
            deleteError: (id) => id.VersionId === 'a.txt-v1' ? {Code: 'AccessDenied', Message: 'Access Denied'} : undefined,
        })

        const error = await withDeadline(20, undefined, (signal) => new AwsStorageAdapter(bucket.client).emptyBucket('versioned', {signal}))
            .catch((err: unknown) => err)

        expect(error).toBeInstanceOf(RuntimeError)
        expect((error as Error).message).toContain('stopped after deletion started')
        expect((error as Error).message).toContain('refused to delete 1 of 2 entries')
        expect((error as Error).message).toContain('code=AccessDenied')
    })
})

describe('AwsStorageAdapter emptyBucket delete batch bound', () => {
    test('a sent batch that never answers fails on its own bound with partial-deletion wording', async () => {
        const bucket = versionedBucket(versionsOf('a.txt', 3), {
            beforeSend: (command, sent) => {
                const signal = sent.at(-1)?.abortSignal
                if (!(command instanceof DeleteObjectsCommand) || !signal) return
                return new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
            },
        })

        const error = await new AwsStorageAdapter(bucket.client, 30).emptyBucket('versioned').catch((err: unknown) => err)

        expect(error).toBeInstanceOf(RuntimeUnavailableError)
        expect((error as Error).message).toContain('stopped after deletion started')
        expect((error as Error).message).toContain('a delete batch got no response within 0.03 seconds')
    })

    test('an idle send that ignores abort still fails within the batch bound', async () => {
        // Run in a separate process: a parent test timer would keep Bun's
        // AbortSignal.timeout alive and mask the idle-loop failure.
        const script = `
            import {ListObjectVersionsCommand} from '@aws-sdk/client-s3'
            import {AwsStorageAdapter} from './src/adapter-aws/AwsStorageAdapter.ts'
            import {RuntimeUnavailableError} from './src/cloud-spi/errors.ts'

            const client = {
                send: (command) => command instanceof ListObjectVersionsCommand
                    ? Promise.resolve({Versions: [{Key: 'a.txt', VersionId: 'v1'}], IsTruncated: false})
                    : new Promise(() => {}),
            }
            const error = await new AwsStorageAdapter(client, 50).emptyBucket('versioned').catch((err) => err)
            if (!(error instanceof RuntimeUnavailableError)) throw new Error('The batch did not time out')
            console.log('batch bounded')
        `
        const child = Bun.spawn({cmd: [process.execPath, '-e', script], cwd: join(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe'})
        let watchdog: ReturnType<typeof setTimeout> | undefined
        try {
            const result = await Promise.race([
                child.exited,
                new Promise<null>((resolve) => { watchdog = setTimeout(() => resolve(null), 5_000) }),
            ])
            expect(result).toBe(0)
            expect(await new Response(child.stdout).text()).toContain('batch bounded')
        } finally {
            clearTimeout(watchdog)
            if (child.exitCode === null) {
                child.kill()
                await child.exited
            }
        }
    })
})

describe('AwsStorageAdapter emptyBucket delete batch bound against the SDK', () => {
    test('the bound holds while the SDK waits out retry backoff', async () => {
        let deleteAttempts = 0
        const throttled = () => Object.assign(new Error('Please reduce your request rate.'), {
            name: 'SlowDown',
            $fault: 'server',
            $metadata: {httpStatusCode: 503},
        })
        // A real client, so its retry strategy and backoff run; only the transport is faked.
        const s3 = new S3Client({
            region: 'us-east-1',
            endpoint: 'http://127.0.0.1:1',
            forcePathStyle: true,
            credentials: {accessKeyId: '000000000000', secretAccessKey: 'test'},
            // Fixed 2-second backoff, so the test does not depend on retry jitter:
            // without the bound the batch takes at least that long.
            retryStrategy: {
                mode: 'standard',
                acquireInitialRetryToken: async () => ({getRetryCount: () => 0, getRetryDelay: () => 0}),
                refreshRetryTokenForRetry: async (token: {getRetryCount(): number}) => {
                    if (token.getRetryCount() >= 4) throw new Error('out of retries')
                    return {getRetryCount: () => token.getRetryCount() + 1, getRetryDelay: () => 2_000}
                },
                recordSuccess: () => {},
            },
            requestHandler: {
                handle: async (request: {method: string; query?: Record<string, unknown>}) => {
                    if (request.method === 'GET') {
                        const body = '<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>a.txt</Key><VersionId>v1</VersionId></Version></ListVersionsResult>'
                        return {response: {statusCode: 200, headers: {'content-type': 'application/xml'}, body: new Response(body).body}}
                    }
                    deleteAttempts += 1
                    throw throttled()
                },
            },
        } as unknown as S3ClientConfig)
        const started = performance.now()

        const error = await new AwsStorageAdapter(s3, 100).emptyBucket('versioned').catch((err: unknown) => err)

        expect(performance.now() - started).toBeLessThan(1_000)
        expect(error).toBeInstanceOf(RuntimeUnavailableError)
        expect((error as Error).message).toContain('stopped after deletion started')
        expect((error as Error).message).toContain('no response within 0.1 seconds')
        expect(deleteAttempts).toBeGreaterThanOrEqual(1)
    })
})

describe('AwsStorageAdapter emptyBucket delete batch bound (inside it)', () => {
    test('a slow batch that answers inside its bound completes', async () => {
        const bucket = versionedBucket(versionsOf('a.txt', 3), {
            beforeSend: async (command) => {
                if (command instanceof DeleteObjectsCommand) await Bun.sleep(30)
            },
        })

        const result = await new AwsStorageAdapter(bucket.client, 300).emptyBucket('versioned')

        expect(result).toEqual({deleted: 3})
    })
})

describe('withDeadline', () => {
    test('aborts the signal with a TimeoutError once the deadline passes', async () => {
        const reason = await withDeadline(10, undefined, (signal) =>
            new Promise((resolve) => signal.addEventListener('abort', () => resolve(signal.reason))))

        expect((reason as Error).name).toBe('TimeoutError')
    })

    test('follows the parent signal and clears its timer once settled', async () => {
        const parent = new AbortController()
        let seen: AbortSignal | undefined
        await withDeadline(20, parent.signal, async (signal) => {
            seen = signal
        })
        await Bun.sleep(40)
        expect(seen?.aborted).toBe(false)

        parent.abort()
        expect(seen?.aborted).toBe(true)
    })
})
