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

export const KEY_CONDITION_OPERATORS = ['eq', 'lt', 'lte', 'gt', 'gte', 'beginsWith', 'between'] as const
export type KeyConditionOperator = typeof KEY_CONDITION_OPERATORS[number]

/**
 * A lookup by key rather than by a query language: the partition key value,
 * optionally narrowed by a condition on the sort key. Values are strings; the
 * adapter resolves each key's attribute name and type from the resource or the
 * named index, so callers never restate the key schema.
 */
export interface KeyQuery {
    /** A secondary index to read; omitted reads the resource itself. */
    index?: string
    partitionKey: string
    sortKey?: {
        operator: KeyConditionOperator
        value: string
        /** Upper bound, only for `between`. */
        to?: string
    }
    descending?: boolean
}

export type CollectionActionName = 'list' | 'create' | 'delete'
export type ItemActionName = 'list' | 'get' | 'put' | 'delete' | 'query' | 'keyQuery'

/** Two-level store: resource → collections → items. */
export interface DocumentStoreAdapter {
    listCollections(resourceId: string, page?: PageQuery): Promise<CollectionPage<ChildCollection>>
    createCollection?(resourceId: string, input: CreateResourceInput): Promise<ChildCollection>
    deleteCollection?(resourceId: string, collectionId: string): Promise<void>
    listItems(resourceId: string, collectionId: string, page?: PageQuery): Promise<CollectionPage<ChildItem>>
    getItem?(resourceId: string, collectionId: string, itemId: string): Promise<ChildItem | null>
    putItem?(resourceId: string, collectionId: string, body: Record<string, unknown>): Promise<ChildItem>
    deleteItem?(resourceId: string, collectionId: string, itemId: string, partitionKey?: string | null): Promise<void>
    queryItems?(resourceId: string, collectionId: string, query: string, page?: PageQuery): Promise<CollectionPage<ChildItem>>
}

/** Flat store: the resource is the collection. */
export interface ItemStoreAdapter {
    listItems(resourceId: string, page?: PageQuery): Promise<CollectionPage<ChildItem>>
    getItem?(resourceId: string, itemId: string): Promise<ChildItem | null>
    putItem?(resourceId: string, body: Record<string, unknown>): Promise<ChildItem>
    deleteItem?(resourceId: string, itemId: string, partitionKey?: string | null): Promise<void>
    /**
     * `page` continues a query whose previous page returned a `nextCursor`; the
     * cursor is only valid for the same `query` against the same resource.
     */
    queryItems?(resourceId: string, query: string, page?: PageQuery): Promise<CollectionPage<ChildItem>>
    /** `page.cursor` is only valid for the same `query` against the same resource. */
    queryItemsByKey?(resourceId: string, query: KeyQuery, page?: PageQuery): Promise<CollectionPage<ChildItem>>
}

/** Validate a request body into a KeyQuery. Shape only; the adapter checks it against the key schema. */
export function parseKeyQuery(body: unknown): KeyQuery {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('A key query must be a JSON object.')
    }
    const {index, partitionKey, sortKey, descending} = body as Record<string, unknown>

    if (index !== undefined && index !== null && (typeof index !== 'string' || !index)) {
        throw new ValidationError('index must be a non-empty string.')
    }
    if (typeof partitionKey !== 'string' || !partitionKey) {
        throw new ValidationError('partitionKey is required.')
    }
    if (descending !== undefined && descending !== null && typeof descending !== 'boolean') {
        throw new ValidationError('descending must be a boolean.')
    }

    const query: KeyQuery = {partitionKey}
    if (index) query.index = index
    if (descending) query.descending = true
    if (sortKey !== undefined && sortKey !== null) query.sortKey = parseSortKeyCondition(sortKey)
    return query
}

function parseSortKeyCondition(value: unknown): NonNullable<KeyQuery['sortKey']> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ValidationError('sortKey must be an object.')
    }
    const {operator, value: operand, to} = value as Record<string, unknown>
    if (!KEY_CONDITION_OPERATORS.includes(operator as KeyConditionOperator)) {
        throw new ValidationError(`sortKey.operator must be one of ${KEY_CONDITION_OPERATORS.join(', ')}.`)
    }
    if (typeof operand !== 'string' || !operand) {
        throw new ValidationError('sortKey.value is required.')
    }
    if (operator !== 'between') {
        if (to !== undefined && to !== null) throw new ValidationError('sortKey.to is only valid with between.')
        return {operator: operator as KeyConditionOperator, value: operand}
    }
    if (typeof to !== 'string' || !to) {
        throw new ValidationError('sortKey.to is required with between.')
    }
    return {operator: 'between', value: operand, to}
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
