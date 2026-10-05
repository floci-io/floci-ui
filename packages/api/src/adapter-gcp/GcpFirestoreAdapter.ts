import type {CollectionReference, Firestore} from '@google-cloud/firestore'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {gcpNoSqlSchema} from '../cloud-spi/noSqlSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import {createFirestoreClient, toFirestoreCloudError} from '../gcpFirestore'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Firestore collections of the `(default)` database as `nosql` resources.
 *
 * Floci-GCP serves Firestore over gRPC only, so this adapter uses the official
 * SDK instead of `GcpRuntimeClient`. Verified against `floci/floci-gcp` 0.9.0.
 *
 * Two runtime behaviours shape it. `ListCollectionIds` keeps returning a
 * collection after its last document is deleted, where Firestore proper drops
 * it, so a collection with no documents is treated as absent. And the SDK's
 * `recursiveDelete` reports success without deleting anything there, so delete
 * walks the documents itself.
 *
 * gRPC retries `UNAVAILABLE` for about a minute, far past the server's request
 * timeout, so every operation first checks liveness over the REST health probe
 * to fail fast with the usual 503.
 */

const DATABASE_ID = '(default)'
const WRITE_BATCH_SIZE = 500

export class GcpFirestoreAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'nosql' as const

    constructor(
        private client?: Firestore,
        private readonly runtime: GcpRuntimeClient = gcp,
    ) {}

    schema(): ServiceSchema {
        return gcpNoSqlSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const collections = await this.run(() => this.firestore().listCollections())
        const resources = await Promise.all(collections.map((collection) => this.toResource(collection)))
        return filterBySearch(
            resources.filter((resource): resource is CloudResource => resource !== null),
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        assertValidId(id, 'Collection ID')
        return this.toResource(this.firestore().collection(id))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const collectionId = stringValue(input.values.collectionId ?? input.values.name)
        if (!collectionId) throw new ValidationError('collectionId is required')
        assertValidId(collectionId, 'Collection ID')

        const documentId = stringValue(input.values.documentId)
        if (documentId) assertValidId(documentId, 'Document ID')
        const document = parseDocument(input.values.document)

        const collection = this.firestore().collection(collectionId)
        await this.run(async () => {
            await (documentId ? collection.doc(documentId).create(document) : collection.add(document))
        })

        const created = await this.toResource(collection)
        if (!created) throw new NotFoundError(`Collection ${collectionId} was not found after creation`)
        return created
    }

    async delete(id: string): Promise<void> {
        assertValidId(id, 'Collection ID')
        const collection = this.firestore().collection(id)
        if (!(await this.toResource(collection))) throw new NotFoundError(`Collection ${id} was not found`)
        await this.run(() => this.deleteCollection(collection))
    }

    async health(): Promise<void> {
        await this.run(() => this.firestore().listCollections())
    }

    private firestore(): Firestore {
        this.client ??= createFirestoreClient()
        return this.client
    }

    /** Null when the collection holds no documents, i.e. it does not exist. */
    private async toResource(collection: CollectionReference): Promise<CloudResource | null> {
        const snapshot = await this.run(() => collection.count().get())
        const documentCount = snapshot.data().count
        if (documentCount === 0) return null

        return {
            id: collection.id,
            name: collection.id,
            cloud: 'gcp',
            service: 'nosql',
            type: 'firestore-collection',
            region: null,
            createdAt: null,
            metadata: {
                provider: 'gcp',
                nosqlService: 'firestore',
                database: DATABASE_ID,
                resourcePath: collection.path,
                documentCount,
            },
        }
    }

    /** Subcollections first: deleting a document leaves its subcollections behind. */
    private async deleteCollection(collection: CollectionReference): Promise<void> {
        const documents = await collection.listDocuments()
        for (const document of documents) {
            for (const child of await document.listCollections()) await this.deleteCollection(child)
        }
        for (let start = 0; start < documents.length; start += WRITE_BATCH_SIZE) {
            const batch = this.firestore().batch()
            for (const document of documents.slice(start, start + WRITE_BATCH_SIZE)) batch.delete(document)
            await batch.commit()
        }
    }

    private async run<T>(operation: () => Promise<T>): Promise<T> {
        await this.runtime.health()
        try {
            return await operation()
        } catch (error) {
            throw toFirestoreCloudError(error)
        }
    }
}

/** Firestore ID rules: non-empty, no "/", not "." or "..", not `__name__`. */
function assertValidId(id: string, label: string): void {
    const valid = id.length > 0 && Buffer.byteLength(id) <= 1500 && !id.includes('/')
        && id !== '.' && id !== '..' && !/^__.*__$/.test(id)
    if (!valid) {
        throw new ValidationError(`${label} must not be empty, contain "/", be "." or "..", or look like __name__.`)
    }
}

function parseDocument(raw: unknown): Record<string, unknown> {
    if (raw === undefined || raw === null) return {}
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
    if (typeof raw !== 'string') throw new ValidationError('document must be a JSON object')
    if (!raw.trim()) return {}

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new ValidationError('document must be valid JSON')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ValidationError('document must be a JSON object')
    }
    return parsed as Record<string, unknown>
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
