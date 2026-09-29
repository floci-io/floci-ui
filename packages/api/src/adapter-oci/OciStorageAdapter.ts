import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {ociStorageSchema} from '../cloud-spi/storageSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
    StorageObject,
    StorageObjectDownload,
    StorageObjectList,
} from '../cloud-spi/types'

/** `BucketSummary` from ListBuckets, or the fuller `Bucket` from GetBucket. */
interface OciBucket {
    id?: string
    name?: string
    namespace?: string
    compartmentId?: string
    timeCreated?: string
    etag?: string
    storageTier?: string
    publicAccessType?: string
    versioning?: string
}

interface OciObjectSummary {
    name?: string
    size?: number
    timeCreated?: string
    timeModified?: string
    etag?: string
    storageTier?: string
}

interface OciListObjects {
    objects?: OciObjectSummary[]
    prefixes?: string[]
    nextStartWith?: string
}

/** ListObjects returns only `name` unless the other fields are asked for. */
const OBJECT_FIELDS = 'name,size,timeCreated,timeModified,etag,storageTier'

/** Guards against a runtime that keeps returning the same `nextStartWith`. */
const MAX_OBJECT_PAGES = 100

export class OciStorageAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'storage' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociStorageSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const buckets = await this.client.listAll<OciBucket>(`${await this.bucketsPath()}?${qs}`)
        return filterBySearch(buckets.map((bucket) => this.toResource(bucket)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const bucket = await this.client.json<OciBucket>(
            await this.bucketPath(id),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return bucket ? this.toResource(bucket) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const bucketName = stringValue(input.values.bucketName)
        if (!bucketName) throw new ValidationError('bucketName is required')
        if (!isValidBucketName(bucketName)) {
            throw new ValidationError('Use a valid OCI bucket name: 1-256 letters, numbers, dashes, underscores, or periods.')
        }
        const body = await this.client.json<OciBucket>(await this.bucketsPath(), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: bucketName, compartmentId: this.client.tenancyId}),
        })
        return this.toResource(body ?? {name: bucketName})
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(await this.bucketPath(id), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    async listObjects(resourceId: string, prefix = ''): Promise<StorageObjectList> {
        const basePath = `${await this.bucketPath(resourceId)}/o`
        const objects: OciObjectSummary[] = []
        // A page can end inside a folder group, so the next page repeats that prefix.
        const prefixes = new Set<string>()
        let start: string | undefined
        for (let page = 0; page < MAX_OBJECT_PAGES; page += 1) {
            const qs = new URLSearchParams({delimiter: '/', fields: OBJECT_FIELDS})
            if (prefix) qs.set('prefix', prefix)
            if (start) qs.set('start', start)
            const body = await this.client.json<OciListObjects>(`${basePath}?${qs}`)
            objects.push(...(body?.objects ?? []))
            for (const folder of body?.prefixes ?? []) prefixes.add(folder)
            start = body?.nextStartWith
            if (!start) break
        }

        return {
            prefix,
            objects: [
                ...[...prefixes].map((key): StorageObject => ({
                    key,
                    name: objectName(key, prefix),
                    type: 'folder',
                    size: null,
                    lastModified: null,
                    metadata: {
                        provider: 'oci',
                        storageService: 'object-storage',
                        prefix: key,
                    },
                })),
                ...objects
                    .filter((item) => item.name && item.name !== prefix)
                    .map((item): StorageObject => ({
                        key: item.name ?? '',
                        name: objectName(item.name ?? '', prefix),
                        type: 'object',
                        size: typeof item.size === 'number' ? item.size : null,
                        lastModified: item.timeModified ?? item.timeCreated ?? null,
                        metadata: {
                            provider: 'oci',
                            storageService: 'object-storage',
                            storageTier: item.storageTier,
                            etag: item.etag,
                        },
                    })),
            ],
        }
    }

    async putObject(resourceId: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
        await this.client.fetch(await this.objectPath(resourceId, key), {
            method: 'PUT',
            headers: {'content-type': contentType},
            body: copyBytes(body),
        })
    }

    async getObject(resourceId: string, key: string): Promise<StorageObjectDownload> {
        const res = await this.client.fetch(await this.objectPath(resourceId, key), {method: 'GET'}, {emptyOnNotFound: true})
        if (!res) throw new NotFoundError(`Object ${key} not found in bucket ${resourceId}`)
        return {
            body: await res.arrayBuffer(),
            contentType: res.headers.get('content-type') ?? 'application/octet-stream',
            contentLength: numberValue(res.headers.get('content-length')),
        }
    }

    async deleteObject(resourceId: string, key: string): Promise<void> {
        await this.client.fetch(await this.objectPath(resourceId, key), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    /**
     * CopyObject is asynchronous on OCI: it answers 202 with a work request id.
     * Floci-OCI completes the copy before replying, so the listing that follows
     * already shows the new object.
     */
    async copyObject(srcResourceId: string, srcKey: string, destKey: string, destResourceId?: string): Promise<void> {
        await this.client.fetch(`${await this.bucketPath(srcResourceId)}/actions/copyObject`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                sourceObjectName: srcKey,
                destinationRegion: this.client.region,
                destinationNamespace: await this.client.namespace(),
                destinationBucket: destResourceId ?? srcResourceId,
                destinationObjectName: destKey,
            }),
        })
    }

    private async bucketsPath(): Promise<string> {
        return `/n/${encodeURIComponent(await this.client.namespace())}/b`
    }

    private async bucketPath(bucket: string): Promise<string> {
        return `${await this.bucketsPath()}/${encodeURIComponent(bucket)}`
    }

    /**
     * The whole object name is one encoded path segment, as the OCI SDKs send it.
     * A literal `/` would lose a folder marker's trailing slash and collapse `//`.
     */
    private async objectPath(bucket: string, key: string): Promise<string> {
        return `${await this.bucketPath(bucket)}/o/${encodeURIComponent(key)}`
    }

    private toResource(bucket: OciBucket): CloudResource {
        const name = bucket.name ?? ''
        return {
            id: name,
            name,
            cloud: 'oci',
            service: 'storage',
            type: 'bucket',
            region: this.client.region,
            createdAt: bucket.timeCreated ?? null,
            metadata: {
                provider: 'oci',
                storageService: 'object-storage',
                ocid: bucket.id,
                namespace: bucket.namespace,
                compartmentId: bucket.compartmentId,
                storageTier: bucket.storageTier,
                publicAccessType: bucket.publicAccessType,
                versioning: bucket.versioning,
                etag: bucket.etag,
            },
        }
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function objectName(key: string, prefix: string): string {
    const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key
    return relative.replace(/\/$/, '') || key
}

function numberValue(value: string | null | undefined): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

function isValidBucketName(value: string): boolean {
    return /^[A-Za-z0-9._-]{1,256}$/.test(value)
}
