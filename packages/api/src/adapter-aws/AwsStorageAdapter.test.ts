import {describe, expect, test} from 'bun:test'
import {
    GetBucketTaggingCommand,
    ListBucketsCommand,
    type S3Client,
} from '@aws-sdk/client-s3'
import {AwsStorageAdapter} from './AwsStorageAdapter'

function fakeS3(overrides: Partial<{
    buckets: Array<{Name: string; CreationDate?: Date}>
    tagSet: Array<{Key: string; Value: string}>
    taggingError: Error
    onGetBucketTagging: (bucketName: string) => void
}> = {}): S3Client {
    return {
        send: async (command: unknown) => {
            if (command instanceof ListBucketsCommand) {
                return {
                    Buckets: overrides.buckets ?? [
                        {Name: 'my-tf-test-bucket', CreationDate: new Date('2026-01-01')},
                    ],
                }
            }
            if (command instanceof GetBucketTaggingCommand) {
                overrides.onGetBucketTagging?.((command as {input: {Bucket: string}}).input.Bucket)
                if (overrides.taggingError) throw overrides.taggingError
                return {TagSet: overrides.tagSet ?? [{Key: 'Environment', Value: 'dev'}]}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        },
    } as unknown as S3Client
}

describe('AwsStorageAdapter', () => {
    test('list includes bucket tags in metadata', async () => {
        const adapter = new AwsStorageAdapter(fakeS3())
        const result = await adapter.list()

        expect(result).toHaveLength(1)
        expect(result[0].metadata.tags).toEqual([{key: 'Environment', value: 'dev'}])
        expect(result[0].metadata.tagsUnavailable).toBe(false)
    })

    test('list returns empty tags for untagged bucket instead of throwing', async () => {
        const error = new Error('The TagSet does not exist')
        error.name = 'NoSuchTagSet'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result[0].metadata.tags).toEqual([])
        expect(result[0].metadata.tagsUnavailable).toBe(false)
    })

    test('list does not fail entirely when tag fetch is denied for a bucket', async () => {
        const error = new Error('Access Denied')
        error.name = 'AccessDenied'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result).toHaveLength(1)
        expect(result[0].metadata.tags).toEqual([])
    })

    test('list marks tags unavailable (not empty) when tag fetch is denied', async () => {
        const error = new Error('Access Denied')
        error.name = 'AccessDenied'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result[0].metadata.tagsUnavailable).toBe(true)
    })

    test('list marks tags unavailable on transport/runtime failures too', async () => {
        const error = new Error('socket hang up')
        error.name = 'TimeoutError'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result[0].metadata.tags).toEqual([])
        expect(result[0].metadata.tagsUnavailable).toBe(true)
    })

    test('search filters buckets before fetching tags, not after', async () => {
        const requestedBuckets: string[] = []
        const adapter = new AwsStorageAdapter(fakeS3({
            buckets: [
                {Name: 'prod-logs'},
                {Name: 'dev-logs'},
                {Name: 'prod-assets'},
            ],
            onGetBucketTagging: (bucketName) => requestedBuckets.push(bucketName),
        }))

        const result = await adapter.list({search: 'prod'})

        expect(result.map((r) => r.name).sort()).toEqual(['prod-assets', 'prod-logs'])
        expect(requestedBuckets.sort()).toEqual(['prod-assets', 'prod-logs'])
    })
})
