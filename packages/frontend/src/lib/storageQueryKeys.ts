import type {CloudProvider} from '@/types/cloud'

/** The account, cloud and bucket a storage request was made for, captured when it was made. */
export interface StorageTarget {
    accountId: string
    cloud: CloudProvider
    bucketId: string
}

/**
 * Query key for a bucket's object listing. Bucket names repeat across accounts,
 * so the account is part of the key. Without a prefix it matches every listing
 * of the bucket, which is what an invalidation wants.
 */
export function storageObjectsKey(target: StorageTarget, prefix?: string): unknown[] {
    const key: unknown[] = ['storage-objects', target.accountId, target.cloud, target.bucketId]
    return prefix === undefined ? key : [...key, prefix]
}

/** One string per target, for comparing a captured target with the one on screen. */
export function storageTargetKey(target: StorageTarget): string {
    return JSON.stringify([target.accountId, target.cloud, target.bucketId])
}
