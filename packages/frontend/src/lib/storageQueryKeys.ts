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

/**
 * Mutation key every object write runs under. Empty bucket waits for these: a
 * write still in flight when it starts could land after its final check.
 */
export const storageObjectWriteKey = ['storage-object-write']

/**
 * Whether an object write's variables put it in this bucket: the bucket it was
 * started in (its upload, delete, or a move's source delete), or the
 * destination of a copy or move, which stays in the same account.
 */
export function writeLandsIn(variables: unknown, bucket: StorageTarget): boolean {
    const write = variables as {target?: StorageTarget; destResourceId?: string} | undefined
    if (!write?.target) return false
    const key = storageTargetKey(bucket)
    if (storageTargetKey(write.target) === key) return true
    return write.destResourceId !== undefined && storageTargetKey({...write.target, bucketId: write.destResourceId}) === key
}
