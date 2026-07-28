import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {azureStorageSchema} from '../cloud-spi/storageSchema'
import {azure, type AzureRuntimeClient} from '../azure'
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

const FOLDER_MARKER = '.floci-folder'

export class AzureStorageAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'storage' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureStorageSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const res = await this.client.fetch(`${accountPath(this.client)}?comp=list`, {method: 'GET'}, {emptyOnNotFound: true})
        if (!res) return []

        const xml = await res.text()
        return filterBySearch(parseContainers(xml), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const resources = await this.list()
        return resources.find((resource) => resource.id === id) ?? null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const containerName = stringValue(input.values.containerName)
        if (!containerName) throw new ValidationError('containerName is required')
        if (!isValidContainerName(containerName)) {
            throw new ValidationError('Use a valid Azure container name: 3-63 lowercase letters, numbers, or single hyphens.')
        }

        await this.client.fetch(`${containerPath(this.client, containerName)}?restype=container`, {method: 'PUT'})
        return normalizeContainer(containerName, null)
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(`${containerPath(this.client, id)}?restype=container`, {method: 'DELETE'})
    }

    async listObjects(resourceId: string, prefix = ''): Promise<StorageObjectList> {
        const qs = new URLSearchParams({restype: 'container', comp: 'list', delimiter: '/'})
        if (prefix) qs.set('prefix', prefix)
        const res = await this.client.fetch(`${containerPath(this.client, resourceId)}?${qs}`, {method: 'GET'}, {emptyOnNotFound: true})
        if (!res) return {prefix, objects: []}

        const xml = await res.text()
        return {prefix, objects: parseBlobs(xml, prefix)}
    }

    async putObject(resourceId: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
        const blobKey = azureBlobKey(key, contentType)
        await this.client.fetch(`${containerPath(this.client, resourceId)}/${encodePath(blobKey)}`, {
            method: 'PUT',
            body: copyBytes(body),
            headers: {
                'content-type': contentType,
                'x-ms-blob-type': 'BlockBlob',
            },
        })
    }

    async getObject(resourceId: string, key: string): Promise<StorageObjectDownload> {
        const res = await this.client.fetch(`${containerPath(this.client, resourceId)}/${encodePath(key)}`, {method: 'GET'})
        if (!res) throw new NotFoundError('Azure blob not found')
        return {
            body: await res.arrayBuffer(),
            contentType: res.headers.get('content-type') ?? 'application/octet-stream',
            contentLength: numberHeader(res.headers.get('content-length')),
        }
    }

    async deleteObject(resourceId: string, key: string): Promise<void> {
        await this.client.fetch(`${containerPath(this.client, resourceId)}/${encodePath(key)}`, {method: 'DELETE'})
    }

    async copyObject(srcResourceId: string, srcKey: string, destKey: string, destResourceId?: string): Promise<void> {
        const destContainer = destResourceId ?? srcResourceId
        const srcUrl = `${this.client.endpoint}${containerPath(this.client, srcResourceId)}/${encodePath(srcKey)}`
        await this.client.fetch(`${containerPath(this.client, destContainer)}/${encodePath(destKey)}`, {
            method: 'PUT',
            headers: {'x-ms-copy-source': srcUrl},
        })
    }
}

function accountPath(client: AzureRuntimeClient): string {
    return `/${encodeURIComponent(client.accountName)}`
}

function containerPath(client: AzureRuntimeClient, containerName: string): string {
    return `${accountPath(client)}/${encodeURIComponent(containerName)}`
}

function parseContainers(xml: string): CloudResource[] {
    const matches = xml.matchAll(/<Container>\s*<Name>([^<]+)<\/Name>[\s\S]*?(?:<Last-Modified>([^<]+)<\/Last-Modified>)?[\s\S]*?<\/Container>/g)
    return [...matches].map((match) => normalizeContainer(decodeXml(match[1]), match[2] ? decodeXml(match[2]) : null))
}

function parseBlobs(xml: string, prefix: string) {
    const folderKeys = new Set<string>()
    const prefixes: StorageObject[] = [...xml.matchAll(/<BlobPrefix>\s*<Name>([^<]+)<\/Name>\s*<\/BlobPrefix>/g)].map((match) => {
        const key = decodeXml(match[1])
        folderKeys.add(key)
        return {
            key,
            name: objectName(key, prefix),
            type: 'folder' as const,
            size: null,
            lastModified: null,
            metadata: {
                provider: 'azure',
                storageService: 'blob',
                prefix: key,
            },
        }
    })

    const blobs: StorageObject[] = []
    for (const match of xml.matchAll(/<Blob>\s*<Name>([^<]+)<\/Name>[\s\S]*?<\/Blob>/g)) {
        const key = decodeXml(match[1])
        const blobXml = match[0]
        const lastModified = xmlValue(blobXml, 'Last-Modified') ?? null
        const contentLength = numberHeader(xmlValue(blobXml, 'Content-Length') ?? null)
        const markerFolderKey = markerFolderPrefix(key)
        if (markerFolderKey) {
            if (!folderKeys.has(markerFolderKey)) {
                folderKeys.add(markerFolderKey)
                prefixes.push({
                    key: markerFolderKey,
                    name: objectName(markerFolderKey, prefix),
                    type: 'folder' as const,
                    size: null,
                    lastModified,
                    metadata: {
                        provider: 'azure',
                        storageService: 'blob',
                        prefix: markerFolderKey,
                        marker: FOLDER_MARKER,
                    },
                })
            }
            continue
        }

        blobs.push({
            key,
            name: objectName(key, prefix),
            type: 'object' as const,
            size: contentLength,
            lastModified,
            metadata: {
                provider: 'azure',
                storageService: 'blob',
                etag: xmlValue(blobXml, 'Etag') ?? xmlValue(blobXml, 'ETag'),
                contentType: xmlValue(blobXml, 'Content-Type'),
                blobType: xmlValue(blobXml, 'BlobType'),
                accessTier: xmlValue(blobXml, 'AccessTier'),
            },
        })
    }

    return [...prefixes, ...blobs]
}

function normalizeContainer(name: string, createdAt: string | null): CloudResource {
    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'storage',
        type: 'container',
        region: null,
        createdAt,
        metadata: {
            provider: 'azure',
            storageService: 'blob',
        },
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

function decodeXml(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
}

function xmlValue(xml: string, tagName: string): string | undefined {
    const match = xml.match(new RegExp(`<${escapeRegExp(tagName)}>([^<]+)<\\/${escapeRegExp(tagName)}>`, 'i'))
    return match?.[1] ? decodeXml(match[1]) : undefined
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function objectName(key: string, prefix: string): string {
    const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key
    return relative.replace(/\/$/, '') || key
}

function encodePath(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/')
}

function numberHeader(value: string | null): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

function azureBlobKey(key: string, contentType: string): string {
    if (key.endsWith('/') && contentType === 'application/x-directory') return `${key}${FOLDER_MARKER}`
    return key
}

function markerFolderPrefix(key: string): string | null {
    if (!key.endsWith(`/${FOLDER_MARKER}`)) return null
    return key.slice(0, -FOLDER_MARKER.length)
}

function isValidContainerName(value: string): boolean {
    return /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$/.test(value)
}
