/**
 * Vendor-neutral child collections.
 *
 * Two shapes, because the services that need this genuinely differ in depth: a
 * CloudWatch log group holds streams which hold events (two levels), while a
 * DynamoDB table simply is the collection (flat). Collapsing them into one
 * interface would put a "which depth am I" branch in every implementer.
 *
 * `ChildItem.body` is where the vendor payload lands — a log event, a Cosmos
 * document, a DynamoDB item — so no vendor concept reaches this contract.
 */

import {ValidationError} from './errors'
import type {CreateResourceInput} from './types'

export const DEFAULT_PAGE_LIMIT = 100
export const MAX_PAGE_LIMIT = 1000

export interface CollectionPage<T> {
    items: T[]
    /**
     * Opaque continuation token; null when the page is the last one. Never
     * round-trip a cursor to a different resource or collection.
     */
    nextCursor: string | null
}

export interface PageQuery {
    cursor?: string
    limit?: number
}

/** The middle level: a log stream, a Cosmos container, a BigQuery table. */
export interface ChildCollection {
    id: string
    name: string
    parentId: string
    createdAt: string | null
    metadata: Record<string, unknown>
}

/** The leaf: a log event, a Cosmos document, a DynamoDB item. */
export interface ChildItem {
    id: string
    /** null for flat stores, where the resource is the collection. */
    collectionId: string | null
    timestamp: string | null
    body: Record<string, unknown>
    metadata: Record<string, unknown>
}

export type CollectionActionName = 'list' | 'create' | 'delete'
export type ItemActionName = 'list' | 'get' | 'put' | 'delete' | 'query'

/** Two-level store: resource → collections → items. */
export interface DocumentStoreAdapter {
    listCollections(resourceId: string, page?: PageQuery): Promise<CollectionPage<ChildCollection>>
    createCollection?(resourceId: string, input: CreateResourceInput): Promise<ChildCollection>
    deleteCollection?(resourceId: string, collectionId: string): Promise<void>
    listItems(resourceId: string, collectionId: string, page?: PageQuery): Promise<CollectionPage<ChildItem>>
    getItem?(resourceId: string, collectionId: string, itemId: string): Promise<ChildItem | null>
    putItem?(resourceId: string, collectionId: string, body: Record<string, unknown>): Promise<ChildItem>
    deleteItem?(resourceId: string, collectionId: string, itemId: string, partitionKey?: string | null): Promise<void>
    queryItems?(resourceId: string, collectionId: string, query: string): Promise<CollectionPage<ChildItem>>
}

/** Flat store: the resource is the collection. */
export interface ItemStoreAdapter {
    listItems(resourceId: string, page?: PageQuery): Promise<CollectionPage<ChildItem>>
    getItem?(resourceId: string, itemId: string): Promise<ChildItem | null>
    putItem?(resourceId: string, body: Record<string, unknown>): Promise<ChildItem>
    deleteItem?(resourceId: string, itemId: string, partitionKey?: string | null): Promise<void>
    queryItems?(resourceId: string, query: string): Promise<CollectionPage<ChildItem>>
}

/**
 * Parse `?limit=`. Out-of-range values raise rather than clamp, so a caller
 * asking for 5000 rows learns the ceiling instead of receiving 1000 that look
 * like the whole set.
 */
export function clampLimit(raw: string | undefined): number {
    if (raw === undefined || raw === '') return DEFAULT_PAGE_LIMIT
    if (!/^\d+$/.test(raw)) {
        throw new ValidationError(`limit must be a whole number between 1 and ${MAX_PAGE_LIMIT}.`)
    }
    const value = Number(raw)
    if (value < 1 || value > MAX_PAGE_LIMIT) {
        throw new ValidationError(`limit must be between 1 and ${MAX_PAGE_LIMIT}.`)
    }
    return value
}
