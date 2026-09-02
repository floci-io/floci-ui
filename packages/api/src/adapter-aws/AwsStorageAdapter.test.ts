import {describe, expect, test} from 'bun:test'
import {
    GetBucketTaggingCommand,
    ListBucketsCommand,
    type S3Client,
} from '@aws-sdk/client-s3'
import {AwsStorageAdapter} from './AwsStorageAdapter'

function fakeS3(overrides: Partial<{
    tagSet: Array<{Key: string; Value: string}>
    taggingError: Error
}> = {}): S3Client {
    return {
        send: async (command: unknown) => {
            if (command instanceof ListBucketsCommand) {
                return {Buckets: [{Name: 'my-tf-test-bucket', CreationDate: new Date('2026-01-01')}]}
            }
            if (command instanceof GetBucketTaggingCommand) {
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
    })

    test('list returns empty tags for untagged bucket instead of throwing', async () => {
        const error = new Error('The TagSet does not exist')
        error.name = 'NoSuchTagSet'
        const adapter = new AwsStorageAdapter(fakeS3({taggingError: error}))

        const result = await adapter.list()

        expect(result[0].metadata.tags).toEqual([])
    })
})
