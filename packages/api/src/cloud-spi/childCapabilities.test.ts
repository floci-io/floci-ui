import {describe, expect, test} from 'bun:test'
import {checkChildCapabilities} from './childCapabilities'
import type {ChildCollection, ChildItem, CollectionPage, DocumentStoreAdapter} from './childCollections'
import type {CloudServiceAdapter, ServiceSchema} from './types'

const emptyCollections: CollectionPage<ChildCollection> = {items: [], nextCursor: null}
const emptyItems: CollectionPage<ChildItem> = {items: [], nextCursor: null}

function schemaWith(capabilities: ServiceSchema['capabilities']): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'storage',
        displayName: 'test',
        fields: [],
        actions: ['list'],
        capabilities,
        filters: [],
        columns: [],
    }
}

function adapterWith(
    capabilities: ServiceSchema['capabilities'],
    documents?: DocumentStoreAdapter,
    items?: CloudServiceAdapter['items'],
): CloudServiceAdapter {
    return {
        cloud: 'aws',
        service: 'storage',
        schema: () => schemaWith(capabilities),
        list: async () => [],
        get: async () => null,
        create: async () => {
            throw new Error('unused')
        },
        delete: async () => {},
        documents,
        items,
    }
}

const listOnlyDocuments: DocumentStoreAdapter = {
    listCollections: async () => emptyCollections,
    listItems: async () => emptyItems,
}

describe('checkChildCapabilities', () => {
    test('an adapter with no child store and no child capabilities is consistent', () => {
        expect(checkChildCapabilities(adapterWith(undefined))).toEqual([])
    })

    // CloudWatch Logs: streams are creatable, events are strictly read-only.
    test('a read-only leaf is a legitimate declared state', () => {
        const adapter = adapterWith(
            {
                collectionActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}],
                itemActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}],
            },
            listOnlyDocuments,
        )
        expect(checkChildCapabilities(adapter)).toEqual([])
    })

    test('claiming an unimplemented capability is a violation', () => {
        const adapter = adapterWith(
            {
                collectionActions: [{name: 'create', label: 'Create', enabled: true, status: 'available'}],
                itemActions: [],
            },
            listOnlyDocuments,
        )
        expect(checkChildCapabilities(adapter)).toEqual([
            'collectionActions.create is available but documents.createCollection is missing',
            'documents.listCollections is implemented but collectionActions.list is not advertised',
            'documents.listItems is implemented but itemActions.list is not advertised',
        ])
    })

    test('an implemented write that is never advertised is a violation', () => {
        const adapter = adapterWith(
            {
                collectionActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}],
                itemActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}],
            },
            {...listOnlyDocuments, deleteCollection: async () => {}},
        )
        expect(checkChildCapabilities(adapter)).toEqual([
            'documents.deleteCollection is implemented but collectionActions.delete is not advertised',
        ])
    })

    test('declaring capabilities with no child store at all is a violation', () => {
        const adapter = adapterWith({
            itemActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}],
        })
        expect(checkChildCapabilities(adapter)).toEqual([
            'itemActions are declared but neither documents nor items is implemented',
        ])
    })

    // The routes cannot decide which shape `/resources/:id/items` addresses.
    test('declaring both stores is a violation', () => {
        const adapter = adapterWith(
            {
                collectionActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}],
                itemActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}],
            },
            listOnlyDocuments,
            {listItems: async () => emptyItems},
        )
        expect(checkChildCapabilities(adapter)).toContain(
            'declares both documents and items; a store is either nested or flat',
        )
    })
})
