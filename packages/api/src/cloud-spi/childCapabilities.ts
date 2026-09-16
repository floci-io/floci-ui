/**
 * Keeps a child store and its advertised capabilities honest in both
 * directions: nothing claimed that is not implemented, nothing implemented that
 * is not claimed.
 *
 * Lives apart from cloudProxy.test.ts so the logic is unit-testable against
 * fakes rather than only against whatever adapters happen to be registered.
 */

import type {CollectionActionName, ItemActionName} from './childCollections'
import type {CloudServiceAdapter} from './types'

const COLLECTION_METHODS: Record<CollectionActionName, string> = {
    list: 'listCollections',
    create: 'createCollection',
    delete: 'deleteCollection',
}

const ITEM_METHODS: Record<ItemActionName, string> = {
    list: 'listItems',
    get: 'getItem',
    put: 'putItem',
    delete: 'deleteItem',
    query: 'queryItems',
}

export function checkChildCapabilities(adapter: CloudServiceAdapter): string[] {
    const violations: string[] = []
    const capabilities = adapter.schema().capabilities
    const collectionActions = capabilities?.collectionActions
    const itemActions = capabilities?.itemActions
    const store = adapter.documents ?? adapter.items
    const storeName = adapter.documents ? 'documents' : 'items'

    if (adapter.documents && adapter.items) {
        violations.push('declares both documents and items; a store is either nested or flat')
    }

    if (!store) {
        if (collectionActions) {
            violations.push('collectionActions are declared but neither documents nor items is implemented')
        }
        if (itemActions) {
            violations.push('itemActions are declared but neither documents nor items is implemented')
        }
        return violations
    }

    // Collection-level verbs only exist on the nested shape.
    if (adapter.documents) {
        violations.push(
            ...compare('collectionActions', 'documents', COLLECTION_METHODS, collectionActions ?? [], adapter.documents),
        )
    } else if (collectionActions?.length) {
        violations.push('collectionActions are declared but the store is flat')
    }

    violations.push(...compare('itemActions', storeName, ITEM_METHODS, itemActions ?? [], store))

    return violations
}

function compare(
    capabilityField: string,
    storeName: string,
    methods: Record<string, string>,
    declared: Array<{name: string; status: string}>,
    store: object,
): string[] {
    const violations: string[] = []
    const implemented = (method: string) => typeof (store as Record<string, unknown>)[method] === 'function'

    for (const capability of declared) {
        if (capability.status !== 'available') continue
        const method = methods[capability.name]
        if (!implemented(method)) {
            violations.push(`${capabilityField}.${capability.name} is available but ${storeName}.${method} is missing`)
        }
    }

    const advertised = new Set(declared.map((capability) => capability.name))
    for (const [action, method] of Object.entries(methods)) {
        if (implemented(method) && !advertised.has(action)) {
            violations.push(`${storeName}.${method} is implemented but ${capabilityField}.${action} is not advertised`)
        }
    }

    return violations
}
