import {ValidationError} from '../cloud-spi/errors'
import {
    type Bucket,
    CopyObjectCommand,
    CreateBucketCommand,
    DeleteBucketCommand,
    DeleteObjectCommand,
    GetBucketTaggingCommand,
    GetObjectCommand,
    ListBucketsCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    type S3Client,
} from '@aws-sdk/client-s3'
import {s3 as defaultS3} from '../aws'
import {awsStorageSchema} from '../cloud-spi/storageSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
    StorageObjectDownload,
    StorageObjectList,
} from '../cloud-spi/types'

export class AwsStorageAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'storage' as const

    constructor(private readonly s3: S3Client = defaultS3) {}

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
        return resources.find((resource) => resource.id === id) ?? null
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
        await this.s3.send(new DeleteBucketCommand({Bucket: id}))
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
