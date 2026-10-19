import {
    CloudError,
    ConflictError,
    RuntimeError,
    RuntimeUnavailableError,
    ValidationError,
} from '../cloud-spi/errors'
import {
    type _Error as S3Error,
    type Bucket,
    CopyObjectCommand,
    CreateBucketCommand,
    DeleteBucketCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetBucketTaggingCommand,
    GetBucketVersioningCommand,
    GetObjectCommand,
    ListBucketsCommand,
    ListObjectsV2Command,
    ListObjectVersionsCommand,
    type ObjectIdentifier,
    PutObjectCommand,
    type S3Client,
} from '@aws-sdk/client-s3'
import {s3 as defaultS3} from '../aws'
import {awsStorageSchema} from '../cloud-spi/storageSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    EmptyBucketOptions,
    EmptyBucketResult,
    ResourceQuery,
    ServiceSchema,
    StorageObjectDownload,
    StorageObjectList,
} from '../cloud-spi/types'
import {mapAwsSdkError} from './awsErrors'

/** DeleteObjects accepts at most this many identifiers per request. */
const DELETE_BATCH_SIZE = 1000
/**
 * How long a sent delete batch may take. It is not cut off by the operation
 * deadline, so this bound keeps one started just before that deadline inside the
 * route's connection budget (120 s + 25 s < 150 s).
 */
export const DELETE_BATCH_TIMEOUT_MS = 25_000
/** Per-object failures quoted in an error, and the length each quoted field is cut to. */
const MAX_REPORTED_FAILURES = 10
const MAX_REPORTED_FIELD_LENGTH = 256

/** Whether any DeleteObjects request has been sent, so a failure can say if data may be gone. */
interface EmptyProgress {
    deleteDispatched: boolean
}


export class AwsStorageAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'storage' as const

    constructor(
        private readonly s3: S3Client = defaultS3,
        private readonly deleteBatchTimeoutMs = DELETE_BATCH_TIMEOUT_MS,
    ) {}

    schema(): ServiceSchema {
        return awsStorageSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const res = await this.s3.send(new ListBucketsCommand({}))
        const buckets = filterBucketsBySearch(res.Buckets ?? [], query.search)

        return Promise.all(buckets.map(async (bucket): Promise<CloudResource> => {
            const {tags, tagsUnavailable} = await this.bucketTags(bucket.Name ?? '')
            return {
                id: bucket.Name ?? '',
                name: bucket.Name ?? '',
                cloud: 'aws',
                service: 'storage',
                type: 'bucket',
                region: null,
                createdAt: bucket.CreationDate?.toISOString() ?? null,
                metadata: {
                    provider: 'aws',
                    storageService: 's3',
                    tags,
                    tagsUnavailable,
                },
            }
        }))
    }

    private async bucketTags(bucketName: string): Promise<{tags: Array<{key: string; value: string}>; tagsUnavailable: boolean}> {
        if (!bucketName) return {tags: [], tagsUnavailable: false}
        try {
            const res = await this.s3.send(new GetBucketTaggingCommand({Bucket: bucketName}))
            return {
                tags: (res.TagSet ?? []).map((tag) => ({key: tag.Key ?? '', value: tag.Value ?? ''})),
                tagsUnavailable: false,
            }
        } catch (err) {
            // NoSuchTagSet is a real, valid answer: the bucket has no tags. Anything else
            // (AccessDenied, throttling, transport failures) means we don't actually know
            // whether the bucket has tags, so callers must not treat it as "no tags".
            if (err instanceof Error && err.name === 'NoSuchTagSet') {
                return {tags: [], tagsUnavailable: false}
            }
            return {tags: [], tagsUnavailable: true}
        }
    }

    async get(id: string): Promise<CloudResource | null> {
        const resources = await this.list()
        const resource = resources.find((candidate) => candidate.id === id)
        if (!resource) return null
        return {...resource, metadata: {...resource.metadata, versioning: await this.bucketVersioning(id)}}
    }

    /**
     * A response without Status is S3's answer for a bucket that never had
     * versioning enabled. A failed read is not that answer, so it stays Unknown.
     */
    private async bucketVersioning(bucketName: string): Promise<'Enabled' | 'Suspended' | 'Disabled' | 'Unknown'> {
        try {
            const res = await this.s3.send(new GetBucketVersioningCommand({Bucket: bucketName}))
            if (res.Status === undefined) return 'Disabled'
            if (res.Status === 'Enabled' || res.Status === 'Suspended') return res.Status
            return 'Unknown'
        } catch {
            return 'Unknown'
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const bucketName = stringValue(input.values.bucketName)
        if (!bucketName) throw new ValidationError('bucketName is required')
        if (!isValidS3BucketName(bucketName)) {
            throw new ValidationError('Use a valid S3 bucket name: 3-63 lowercase characters, numbers, dots, or hyphens.')
        }

        await this.s3.send(new CreateBucketCommand({Bucket: bucketName}))
        return {
            id: bucketName,
            name: bucketName,
            cloud: 'aws',
            service: 'storage',
            type: 'bucket',
            region: stringValue(input.values.region) || null,
            createdAt: null,
            metadata: {
                provider: 'aws',
                storageService: 's3',
            },
        }
    }

    async delete(id: string): Promise<void> {
        try {
            await this.s3.send(new DeleteBucketCommand({Bucket: id}))
        } catch (err) {
            if (err instanceof Error && err.name === 'BucketNotEmpty') {
                throw new ConflictError(
                    `Bucket "${id}" is not empty. It may hold object versions or delete markers that the object list does not show. Use Empty bucket to remove them, then delete the bucket.`,
                    {cause: err},
                )
            }
            throw err
        }
    }

    /**
     * Permanently delete every object version and delete marker, keeping the bucket.
     *
     * The whole version inventory is listed before anything is deleted. Paging
     * resumes from the last (key, version) returned, and a runtime that cannot find
     * that version again skips the rest of the key, so deleting between pages can
     * leave versions behind. Identifiers only are held, never object bodies.
     */
    async emptyBucket(id: string, options: EmptyBucketOptions = {}): Promise<EmptyBucketResult> {
        const {signal} = options
        const progress: EmptyProgress = {deleteDispatched: false}
        try {
            const entries = await this.listAllVersions(id, signal, progress)
            for (let start = 0; start < entries.length; start += DELETE_BATCH_SIZE) {
                throwIfAborted(signal)
                const batch = entries.slice(start, start + DELETE_BATCH_SIZE)
                progress.deleteDispatched = true
                // Not tied to the operation signal: S3 applies a batch it has received
                // whether or not the caller is still waiting, so the batch is left to
                // finish and its per-object result is read. The deadline only stops the
                // next one, and the batch has a bound of its own.
                const res = await this.sendDeleteBatch(id, batch)
                if (res.Errors?.length) throw new RuntimeError(partialFailureMessage(id, res.Errors, batch.length))
            }

            throwIfAborted(signal)
            const remaining = await this.s3.send(new ListObjectVersionsCommand({Bucket: id, MaxKeys: 1}), {abortSignal: signal})
            if ((remaining.Versions?.length ?? 0) + (remaining.DeleteMarkers?.length ?? 0) > 0) {
                throw new ConflictError(
                    `Bucket "${id}" still holds object versions after emptying, most likely because something wrote to it meanwhile. Stop writes to the bucket and run Empty bucket again.`,
                )
            }
            return {deleted: entries.length}
        } catch (err) {
            throw emptyFailure(id, err, signal, progress)
        }
    }

    /**
     * The SDK can wait through retry backoff after abort, so the bound also races
     * the send. A regular timer keeps that race live when the send never settles.
     */
    private async sendDeleteBatch(bucket: string, batch: ObjectIdentifier[]) {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        const timedOut = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const reason = new DOMException('Delete batch timed out', 'TimeoutError')
                controller.abort(reason)
                reject(reason)
            }, this.deleteBatchTimeoutMs)
        })
        try {
            const sent = this.s3.send(
                new DeleteObjectsCommand({Bucket: bucket, Delete: {Objects: batch, Quiet: true}}),
                {abortSignal: controller.signal},
            )
            // Once the race is lost, the send's own outcome no longer matters.
            sent.catch(() => {})
            return await Promise.race([sent, timedOut])
        } catch (err) {
            if (!controller.signal.aborted) throw err
            throw new RuntimeUnavailableError(
                `a delete batch got no response within ${this.deleteBatchTimeoutMs / 1000} seconds`,
                {cause: err},
            )
        } finally {
            clearTimeout(timer)
        }
    }

    private async listAllVersions(bucket: string, signal: AbortSignal | undefined, progress: EmptyProgress): Promise<ObjectIdentifier[]> {
        const entries: ObjectIdentifier[] = []
        let keyMarker: string | undefined
        let versionIdMarker: string | undefined
        for (;;) {
            throwIfAborted(signal)
            const page = await this.s3.send(
                new ListObjectVersionsCommand({Bucket: bucket, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker}),
                {abortSignal: signal},
            )
            for (const entry of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
                // A literal "null" version id is real (objects written while versioning
                // was off) and must be sent as-is: omitting it would add a delete marker.
                if (!entry.Key || !entry.VersionId) {
                    throw new RuntimeError('ListObjectVersions returned an entry without a key or version ID.')
                }
                entries.push({Key: entry.Key, VersionId: entry.VersionId})
            }
            if (!page.IsTruncated) return entries
            if (!page.NextKeyMarker || !page.NextVersionIdMarker) {
                throw new RuntimeError('ListObjectVersions returned a truncated page without both continuation markers.')
            }
            if (page.NextKeyMarker === keyMarker && page.NextVersionIdMarker === versionIdMarker) {
                throw new RuntimeError('ListObjectVersions returned the same continuation markers twice.')
            }
            keyMarker = page.NextKeyMarker
            versionIdMarker = page.NextVersionIdMarker
        }
    }

    async listObjects(resourceId: string, prefix = ''): Promise<StorageObjectList> {
        const res = await this.s3.send(new ListObjectsV2Command({
            Bucket: resourceId,
            Prefix: prefix || undefined,
            Delimiter: '/',
        }))

        return {
            prefix,
            objects: [
                ...(res.CommonPrefixes ?? []).map((item) => {
                    const key = item.Prefix ?? ''
                    return {
                        key,
                        name: objectName(key, prefix),
                        type: 'folder' as const,
                        size: null,
                        lastModified: null,
                        metadata: {
                            provider: 'aws',
                            storageService: 's3',
                            prefix: key,
                        },
                    }
                }),
                ...(res.Contents ?? [])
                    .filter((item) => item.Key && item.Key !== prefix)
                    .map((item) => ({
                        key: item.Key ?? '',
                        name: objectName(item.Key ?? '', prefix),
                        type: 'object' as const,
                        size: item.Size ?? null,
                        lastModified: item.LastModified?.toISOString() ?? null,
                        metadata: {
                            provider: 'aws',
                            storageService: 's3',
                            etag: item.ETag?.replace(/"/g, ''),
                            storageClass: item.StorageClass,
                        },
                    })),
            ],
        }
    }

    async putObject(resourceId: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
        await this.s3.send(new PutObjectCommand({Bucket: resourceId, Key: key, Body: body, ContentType: contentType}))
    }

    async getObject(resourceId: string, key: string): Promise<StorageObjectDownload> {
        const res = await this.s3.send(new GetObjectCommand({Bucket: resourceId, Key: key}))
        return {
            body: res.Body as BodyInit,
            contentType: res.ContentType ?? 'application/octet-stream',
            contentLength: res.ContentLength ?? null,
        }
    }

    async deleteObject(resourceId: string, key: string): Promise<void> {
        await this.s3.send(new DeleteObjectCommand({Bucket: resourceId, Key: key}))
    }

    async copyObject(srcResourceId: string, srcKey: string, destKey: string, destResourceId?: string): Promise<void> {
        const destBucket = destResourceId ?? srcResourceId
        await this.s3.send(new CopyObjectCommand({
            Bucket: destBucket,
            Key: destKey,
            CopySource: `${srcResourceId}/${srcKey}`,
        }))
    }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

/**
 * Say whether anything may already be gone. Before the first DeleteObjects
 * request nothing was deleted; from then on, including while that first request
 * is in flight, some versions may be.
 */
function emptyFailure(bucket: string, err: unknown, signal: AbortSignal | undefined, progress: EmptyProgress): CloudError {
    // Decided from the error, not the signal: a batch in flight when the deadline
    // fired still reports its own outcome, such as a per-object refusal.
    const aborted = signal?.aborted === true && (err === signal.reason || isAbortError(err))
    const cause = aborted
        ? new RuntimeUnavailableError((signal.reason as {name?: unknown} | undefined)?.name === 'TimeoutError'
            ? 'the operation ran past its time limit'
            : 'the request was cancelled', {cause: err})
        : err instanceof CloudError ? err : mapAwsSdkError(err) ?? new RuntimeError(err instanceof Error ? err.message : String(err), {cause: err})

    const phase = progress.deleteDispatched
        ? 'stopped after deletion started, so some versions and delete markers may already be permanently deleted. Run Empty bucket again to remove the rest'
        : 'stopped before deleting anything'
    const ErrorClass = cause.constructor as new (message: string, options?: {cause?: unknown}) => CloudError
    return new ErrorClass(`Emptying bucket "${bucket}" ${phase}: ${cause.message}`, {cause: err})
}

function isAbortError(err: unknown): boolean {
    return !(err instanceof CloudError) && err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

function partialFailureMessage(bucket: string, errors: S3Error[], batchSize: number): string {
    const shown = errors.slice(0, MAX_REPORTED_FAILURES).map((failure) => [
        `key=${clip(failure.Key)}`,
        `versionId=${clip(failure.VersionId)}`,
        `code=${clip(failure.Code)}`,
        `message=${clip(failure.Message)}`,
    ].join(', '))
    const omitted = errors.length - shown.length
    return [
        `S3 refused to delete ${errors.length} of ${batchSize} entries in a batch of bucket "${bucket}".`,
        ...shown,
        ...(omitted > 0 ? [`${omitted} more not shown.`] : []),
    ].join('\n')
}

function clip(value: string | undefined): string {
    if (value === undefined) return '(none)'
    return value.length > MAX_REPORTED_FIELD_LENGTH ? `${value.slice(0, MAX_REPORTED_FIELD_LENGTH)}...` : value
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBucketsBySearch(buckets: Bucket[], search?: string): Bucket[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return buckets
    return buckets.filter((bucket) => (bucket.Name ?? '').toLowerCase().includes(normalized))
}

function objectName(key: string, prefix: string): string {
    const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key
    return relative.replace(/\/$/, '') || key
}

function isValidS3BucketName(value: string): boolean {
    return /^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)(?!.*--x-s3$)(?!.*-s3alias$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value)
}
