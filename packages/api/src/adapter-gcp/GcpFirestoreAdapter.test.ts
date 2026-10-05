import {describe, expect, test} from 'bun:test'
import type {Firestore} from '@google-cloud/firestore'
import {GcpFirestoreAdapter} from './GcpFirestoreAdapter'
import {toFirestoreCloudError} from '../gcpFirestore'
import {
    ConflictError,
    NotFoundError,
    NotImplementedByRuntimeError,
    RuntimeUnavailableError,
    ValidationError,
} from '../cloud-spi/errors'
import type {GcpRuntimeClient} from '../gcp'

/** In-memory stand-in for the slice of the Firestore SDK the adapter uses. */
class FakeFirestore {
    readonly docs = new Map<string, Record<string, unknown>>()
    readonly calls: string[] = []
    nextAutoId = 1

    collection(path: string) {
        const store = this
        return {
            id: path.split('/').pop() as string,
            path,
            count: () => ({
                get: async () => ({data: () => ({count: store.childDocs(path).length})}),
            }),
            add: async (data: Record<string, unknown>) => {
                const id = `auto${store.nextAutoId++}`
                store.calls.push(`add ${path}/${id}`)
                store.docs.set(`${path}/${id}`, data)
                return {id}
            },
            doc: (id: string) => store.doc(`${path}/${id}`),
            listDocuments: async () => store.childDocs(path).map((docPath) => store.doc(docPath)),
        }
    }

    doc(path: string) {
        const store = this
        return {
            path,
            create: async (data: Record<string, unknown>) => {
                store.calls.push(`create ${path}`)
                if (store.docs.has(path)) throw Object.assign(new Error('6 ALREADY_EXISTS: exists'), {code: 6})
                store.docs.set(path, data)
            },
            listCollections: async () => {
                const prefix = `${path}/`
                const ids = new Set(
                    [...store.docs.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length).split('/')[0]),
                )
                return [...ids].map((id) => store.collection(`${path}/${id}`))
            },
        }
    }

    childDocs(collectionPath: string): string[] {
        const prefix = `${collectionPath}/`
        return [...this.docs.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
    }

    async listCollections() {
        const ids = new Set([...this.docs.keys()].map((key) => key.split('/')[0]))
        // The real runtime keeps listing a collection after its last document is gone.
        return [...ids, 'stale'].map((id) => this.collection(id))
    }

    batch() {
        const pending: string[] = []
        return {
            delete: (ref: {path: string}) => void pending.push(ref.path),
            commit: async () => {
                this.calls.push(`batch ${pending.length}`)
                for (const path of pending) this.docs.delete(path)
            },
        }
    }
}

const upRuntime = {health: async () => {}} as unknown as GcpRuntimeClient

function setup() {
    const firestore = new FakeFirestore()
    const adapter = new GcpFirestoreAdapter(firestore as unknown as Firestore, upRuntime)
    return {firestore, adapter}
}

describe('GcpFirestoreAdapter', () => {
    test('identifies itself as the GCP nosql adapter and serves the Firestore schema', () => {
        const {adapter} = setup()
        expect(adapter.cloud).toBe('gcp')
        expect(adapter.service).toBe('nosql')
        expect(adapter.schema().displayName).toBe('Firestore')
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('lists collections with their document count and hides ones holding no documents', async () => {
        const {adapter, firestore} = setup()
        firestore.docs.set('orders/o1', {a: 1})
        firestore.docs.set('orders/o2', {a: 2})
        firestore.docs.set('users/u1', {})

        const resources = await adapter.list()

        expect(resources.map((resource) => resource.id)).toEqual(['orders', 'users'])
        expect(resources[0]).toMatchObject({
            cloud: 'gcp',
            service: 'nosql',
            type: 'firestore-collection',
            metadata: {database: '(default)', resourcePath: 'orders', documentCount: 2},
        })
    })

    test('filters the list by search', async () => {
        const {adapter, firestore} = setup()
        firestore.docs.set('orders/o1', {})
        firestore.docs.set('users/u1', {})

        expect((await adapter.list({search: 'ORD'})).map((resource) => resource.id)).toEqual(['orders'])
    })

    test('get returns null for a collection with no documents and rejects invalid ids', async () => {
        const {adapter, firestore} = setup()
        firestore.docs.set('orders/o1', {})

        expect((await adapter.get('orders'))?.metadata.documentCount).toBe(1)
        expect(await adapter.get('ghost')).toBeNull()
        await expect(adapter.get('a/b')).rejects.toBeInstanceOf(ValidationError)
    })

    test('create writes the first document under the given id and returns the collection', async () => {
        const {adapter, firestore} = setup()

        const resource = await adapter.create({
            values: {collectionId: 'orders', documentId: 'o1', document: '{"total":42,"items":["a"]}'},
        })

        expect(firestore.docs.get('orders/o1')).toEqual({total: 42, items: ['a']})
        expect(firestore.calls).toContain('create orders/o1')
        expect(resource).toMatchObject({id: 'orders', metadata: {documentCount: 1}})
    })

    test('create without a document id lets Firestore generate one, with an empty document', async () => {
        const {adapter, firestore} = setup()

        await adapter.create({values: {collectionId: 'orders'}})

        expect(firestore.docs.get('orders/auto1')).toEqual({})
    })

    test('create rejects bad input before touching Firestore', async () => {
        const {adapter, firestore} = setup()

        await expect(adapter.create({values: {}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {collectionId: '..'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {collectionId: 'a', documentId: '__x__'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {collectionId: 'a', document: '{nope'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {collectionId: 'a', document: '[1]'}})).rejects.toBeInstanceOf(ValidationError)
        expect(firestore.calls).toEqual([])
    })

    test('create maps ALREADY_EXISTS to a conflict', async () => {
        const {adapter} = setup()
        await adapter.create({values: {collectionId: 'orders', documentId: 'o1'}})

        await expect(adapter.create({values: {collectionId: 'orders', documentId: 'o1'}})).rejects.toBeInstanceOf(ConflictError)
    })

    test('delete removes the documents and their subcollections', async () => {
        const {adapter, firestore} = setup()
        firestore.docs.set('orders/o1', {})
        firestore.docs.set('orders/o1/lines/l1', {})
        firestore.docs.set('users/u1', {})

        await adapter.delete('orders')

        expect([...firestore.docs.keys()]).toEqual(['users/u1'])
    })

    test('delete of a collection with no documents is a not found', async () => {
        const {adapter} = setup()

        await expect(adapter.delete('ghost')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('fails fast without calling Firestore when the runtime is down', async () => {
        const firestore = new FakeFirestore()
        const down = {health: async () => { throw new RuntimeUnavailableError('down') }} as unknown as GcpRuntimeClient
        const adapter = new GcpFirestoreAdapter(firestore as unknown as Firestore, down)

        await expect(adapter.list()).rejects.toBeInstanceOf(RuntimeUnavailableError)
        await expect(adapter.health()).rejects.toBeInstanceOf(RuntimeUnavailableError)
        expect(firestore.calls).toEqual([])
    })
})

describe('toFirestoreCloudError', () => {
    test('maps gRPC status codes onto the typed errors', () => {
        expect(toFirestoreCloudError(Object.assign(new Error('x'), {code: 14}))).toBeInstanceOf(RuntimeUnavailableError)
        expect(toFirestoreCloudError(Object.assign(new Error('x'), {code: 12}))).toBeInstanceOf(NotImplementedByRuntimeError)
        expect(toFirestoreCloudError(Object.assign(new Error('x'), {code: 5}))).toBeInstanceOf(NotFoundError)
    })

    test('decodes the runtime message and survives a stray percent sign', () => {
        const decoded = toFirestoreCloudError(Object.assign(new Error('Document already exists%3A a%2Fb'), {code: 6})) as Error
        expect(decoded.message).toContain('Document already exists: a/b')
        const stray = toFirestoreCloudError(Object.assign(new Error('100% bad'), {code: 3})) as Error
        expect(stray.message).toContain('100% bad')
    })

    test('leaves unrelated errors untouched', () => {
        const plain = new Error('boom')
        expect(toFirestoreCloudError(plain)).toBe(plain)
    })
})
