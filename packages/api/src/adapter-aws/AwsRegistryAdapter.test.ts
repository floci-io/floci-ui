import {describe, expect, test} from 'bun:test'
import {
    BatchDeleteImageCommand,
    CreateRepositoryCommand,
    DeleteRepositoryCommand,
    DescribeImagesCommand,
    DescribeRepositoriesCommand,
    GetLifecyclePolicyCommand,
    GetRepositoryPolicyCommand,
    type ECRClient,
    type ImageDetail,
    type Repository,
} from '@aws-sdk/client-ecr'
import {ConflictError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {AwsRegistryAdapter} from './AwsRegistryAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

const ACCOUNT = '000000000000'
const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`
const PUSHED_AT = new Date('2026-10-01T12:00:00.000Z')
const REPOSITORY_POLICY = '{"Version":"2012-10-17","Statement":[]}'
const LIFECYCLE_POLICY = '{"rules":[]}'

describe('AwsRegistryAdapter', () => {
    test('identifies ECR as the AWS registry adapter', () => {
        const adapter = createAdapter()

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('registry')
        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'registry', displayName: 'ECR Repositories'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(adapter.items).toBeDefined()
    })

    test('follows nextToken across DescribeRepositories pages', async () => {
        const tokens: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeRepositoriesCommand) {
                tokens.push(command.input.nextToken)
                expect(command.input.maxResults).toBe(1000)
                return command.input.nextToken
                    ? {repositories: [repository('worker')]}
                    : {repositories: [repository('web')], nextToken: 'page-2'}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resources = await adapter.list()

        expect(resources.map((resource) => resource.id)).toEqual(['web', 'worker'])
        expect(tokens).toEqual([undefined, 'page-2'])
    })

    test('rejects a repeated DescribeRepositories continuation token', async () => {
        const adapter = createAdapter(async () => ({repositories: [repository('web')], nextToken: 'again'}))

        await expect(adapter.list()).rejects.toThrow('ECR DescribeRepositories repeated a continuation token')
    })

    test('maps a repository to the shared resource shape', async () => {
        const adapter = createAdapter(async () => ({
            repositories: [{
                ...repository('team/app'),
                imageTagMutability: 'IMMUTABLE',
                imageScanningConfiguration: {scanOnPush: true},
                encryptionConfiguration: {encryptionType: 'KMS', kmsKey: 'arn:aws:kms:us-east-1:000000000000:key/k1'},
            }],
        }))

        const [resource] = await adapter.list()

        expect(resource).toEqual({
            id: 'team/app',
            name: 'team/app',
            cloud: 'aws',
            service: 'registry',
            type: 'ecr-repository',
            region: 'us-east-1',
            createdAt: '2026-09-30T08:00:00.000Z',
            metadata: {
                provider: 'aws',
                arn: `arn:aws:ecr:us-east-1:${ACCOUNT}:repository/team/app`,
                registryId: ACCOUNT,
                repositoryUri: `${ACCOUNT}.dkr.ecr.us-east-1.localhost:4566/team/app`,
                imageTagMutability: 'IMMUTABLE',
                scanOnPush: true,
                encryptionType: 'KMS',
                kmsKey: 'arn:aws:kms:us-east-1:000000000000:key/k1',
            },
        })
    })

    test('filters repositories by name', async () => {
        const adapter = createAdapter(async () => ({
            repositories: [repository('web'), repository('team/worker'), repository('batch')],
        }))

        const resources = await adapter.list({search: 'WORK'})

        expect(resources.map((resource) => resource.id)).toEqual(['team/worker'])
    })

    test('creates a repository from the validated values and returns what ECR answered', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {repository: {...repository('team/app'), imageTagMutability: 'IMMUTABLE'}}
        })

        const created = await adapter.create({
            values: {repositoryName: ' team/app ', imageTagMutability: 'IMMUTABLE', scanOnPush: 'true'},
        })

        expect(created).toMatchObject({id: 'team/app', metadata: {imageTagMutability: 'IMMUTABLE'}})
        expect(sent).toHaveLength(1)
        expect(sent[0]).toBeInstanceOf(CreateRepositoryCommand)
        expect((sent[0] as CreateRepositoryCommand).input).toEqual({
            repositoryName: 'team/app',
            imageTagMutability: 'IMMUTABLE',
            imageScanningConfiguration: {scanOnPush: true},
        })
    })

    test('leaves tag mutability to the ECR default and scan on push off when not chosen', async () => {
        let input: CreateRepositoryCommand['input'] | undefined
        const adapter = createAdapter(async (command) => {
            input = (command as CreateRepositoryCommand).input
            return {repository: repository('app')}
        })

        await adapter.create({values: {repositoryName: 'app', imageTagMutability: ''}})

        expect(input).toEqual({
            repositoryName: 'app',
            imageTagMutability: undefined,
            imageScanningConfiguration: {scanOnPush: false},
        })
    })

    test('rejects missing and malformed values before any request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        for (const repositoryName of [undefined, '', '   ', 'a', 'Upper', 'has space', 'double--dash', '/lead', 'trail/', 'a'.repeat(257)]) {
            await expect(adapter.create({values: {repositoryName}})).rejects.toBeInstanceOf(ValidationError)
        }
        await expect(
            adapter.create({values: {repositoryName: 'app', imageTagMutability: 'SOMETIMES'}}),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent).toEqual([])
    })

    test('a create that returns no repository is a runtime error', async () => {
        const adapter = createAdapter(async () => ({}))

        await expect(adapter.create({values: {repositoryName: 'app'}})).rejects.toBeInstanceOf(RuntimeError)
    })

    test('deletes with force so a repository holding images can go', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {repository: repository('web')}
        })

        await adapter.delete('web')

        expect(sent).toHaveLength(1)
        expect(sent[0]).toBeInstanceOf(DeleteRepositoryCommand)
        expect((sent[0] as DeleteRepositoryCommand).input).toEqual({repositoryName: 'web', force: true})
    })

    test('health checks one repository only', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {repositories: []}
        })

        await adapter.health()

        expect(sent).toHaveLength(1)
        expect((sent[0] as DescribeRepositoriesCommand).input).toEqual({maxResults: 1})
    })
})

describe('AwsRegistryAdapter inspect', () => {
    test('returns the repository with its policies and images', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeRepositoriesCommand) {
                expect(command.input.repositoryNames).toEqual(['web'])
                return {repositories: [repository('web')]}
            }
            if (command instanceof GetRepositoryPolicyCommand) return {repositoryName: 'web', policyText: REPOSITORY_POLICY}
            if (command instanceof GetLifecyclePolicyCommand) return {repositoryName: 'web', lifecyclePolicyText: LIFECYCLE_POLICY}
            if (command instanceof DescribeImagesCommand) return {imageDetails: [image(DIGEST_A, ['v1'])]}
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resource = await adapter.get('web')

        expect(resource?.id).toBe('web')
        expect(resource?.metadata).toMatchObject({
            repositoryUri: `${ACCOUNT}.dkr.ecr.us-east-1.localhost:4566/web`,
            repositoryPolicyText: REPOSITORY_POLICY,
            lifecyclePolicyText: LIFECYCLE_POLICY,
            images: [{tags: 'v1', imageTags: ['v1'], imageDigest: DIGEST_A, imageSizeInBytes: 1024}],
        })
        expect(resource?.metadata).not.toHaveProperty('imagesUnavailable')
    })

    test('a repository without policies reports them as null, not as an error', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeRepositoriesCommand) return {repositories: [repository('web')]}
            if (command instanceof GetRepositoryPolicyCommand) throw sdkError('RepositoryPolicyNotFoundException')
            if (command instanceof GetLifecyclePolicyCommand) throw sdkError('LifecyclePolicyNotFoundException')
            if (command instanceof DescribeImagesCommand) return {imageDetails: []}
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resource = await adapter.get('web')

        expect(resource?.metadata).toMatchObject({repositoryPolicyText: null, lifecyclePolicyText: null, images: []})
    })

    test('any other policy failure fails the inspect', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeRepositoriesCommand) return {repositories: [repository('web')]}
            if (command instanceof GetRepositoryPolicyCommand) throw sdkError('ServerException')
            if (command instanceof GetLifecyclePolicyCommand) throw sdkError('LifecyclePolicyNotFoundException')
            return {imageDetails: []}
        })

        await expect(adapter.get('web')).rejects.toThrow('ServerException from the runtime')
    })

    test('a failed image read is flagged instead of failing the inspect', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeRepositoriesCommand) return {repositories: [repository('web')]}
            if (command instanceof GetRepositoryPolicyCommand) throw sdkError('RepositoryPolicyNotFoundException')
            if (command instanceof GetLifecyclePolicyCommand) throw sdkError('LifecyclePolicyNotFoundException')
            // Floci without a reachable Docker daemon cannot query images.
            if (command instanceof DescribeImagesCommand) throw sdkError('ServerException')
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resource = await adapter.get('web')

        expect(resource?.metadata).toMatchObject({images: [], imagesUnavailable: true})
    })

    test('inspect embeds only the first image page and flags a truncated list', async () => {
        const tokens: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeRepositoriesCommand) return {repositories: [repository('web')]}
            if (command instanceof GetRepositoryPolicyCommand) throw sdkError('RepositoryPolicyNotFoundException')
            if (command instanceof GetLifecyclePolicyCommand) throw sdkError('LifecyclePolicyNotFoundException')
            if (command instanceof DescribeImagesCommand) {
                tokens.push(command.input.nextToken)
                expect(command.input.maxResults).toBe(100)
                return {imageDetails: [image(DIGEST_A, ['v1'])], nextToken: 'images-2'}
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resource = await adapter.get('web')

        expect(tokens).toEqual([undefined])
        expect((resource?.metadata.images as Array<{imageDigest: string}>).map((entry) => entry.imageDigest)).toEqual([
            DIGEST_A,
        ])
        expect(resource?.metadata.imagesTruncated).toBe(true)
    })

    test('inspect omits imagesTruncated when the first page is the last', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof DescribeRepositoriesCommand) return {repositories: [repository('web')]}
            if (command instanceof GetRepositoryPolicyCommand) throw sdkError('RepositoryPolicyNotFoundException')
            if (command instanceof GetLifecyclePolicyCommand) throw sdkError('LifecyclePolicyNotFoundException')
            if (command instanceof DescribeImagesCommand) return {imageDetails: [image(DIGEST_A, ['v1'])]}
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resource = await adapter.get('web')

        expect(resource?.metadata).not.toHaveProperty('imagesTruncated')
    })

    test('a missing repository is null and skips the policy and image reads', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            throw sdkError('RepositoryNotFoundException')
        })

        await expect(adapter.get('ghost')).resolves.toBeNull()
        expect(sent).toHaveLength(1)
    })

    test('a failed describe that is not a missing repository propagates', async () => {
        const adapter = createAdapter(async () => {
            throw sdkError('ServerException')
        })

        await expect(adapter.get('web')).rejects.toThrow('ServerException from the runtime')
    })
})

describe('AwsRegistryAdapter images', () => {
    test('lists one page, passing the cursor through and capping the page at 1000', async () => {
        let input: DescribeImagesCommand['input'] | undefined
        const adapter = createAdapter(async (command) => {
            input = (command as DescribeImagesCommand).input
            return {imageDetails: [image(DIGEST_A, ['v1', 'latest'])], nextToken: 'next'}
        })

        const page = await adapter.items.listItems('web', {cursor: 'token', limit: 5000})

        expect(input).toEqual({repositoryName: 'web', nextToken: 'token', maxResults: 1000})
        expect(page.nextCursor).toBe('next')
        expect(page.items).toEqual([{
            id: DIGEST_A,
            collectionId: null,
            timestamp: PUSHED_AT.toISOString(),
            body: {
                tags: 'v1, latest',
                imageTags: ['v1', 'latest'],
                imageDigest: DIGEST_A,
                imageSizeInBytes: 1024,
                imagePushedAt: PUSHED_AT.toISOString(),
                imageManifestMediaType: 'application/vnd.oci.image.manifest.v1+json',
                artifactMediaType: undefined,
            },
            metadata: {registryId: ACCOUNT},
        }])
    })

    test('defaults to the shared page size and reports the last page with a null cursor', async () => {
        let input: DescribeImagesCommand['input'] | undefined
        const adapter = createAdapter(async (command) => {
            input = (command as DescribeImagesCommand).input
            return {imageDetails: []}
        })

        const page = await adapter.items.listItems('web')

        expect(input).toEqual({repositoryName: 'web', nextToken: undefined, maxResults: 100})
        expect(page).toEqual({items: [], nextCursor: null})
    })

    test('labels an untagged image instead of leaving its tags blank', async () => {
        const adapter = createAdapter(async () => ({imageDetails: [image(DIGEST_B, undefined)]}))

        const {items: [item]} = await adapter.items.listItems('web')

        expect(item?.body).toMatchObject({tags: '<untagged>', imageTags: [], imageDigest: DIGEST_B})
    })

    test('folds details that share a digest into one image, as ECR reports it', async () => {
        // Floci answers one detail per tag, so a manifest tagged twice arrives twice.
        const adapter = createAdapter(async () => ({
            imageDetails: [image(DIGEST_A, ['v1']), image(DIGEST_B, ['other']), image(DIGEST_A, ['latest'])],
        }))

        const page = await adapter.items.listItems('web')

        expect(page.items.map((item) => [item.id, item.body.imageTags])).toEqual([
            [DIGEST_A, ['v1', 'latest']],
            [DIGEST_B, ['other']],
        ])
    })

    test('deletes an image by digest', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {imageIds: [{imageDigest: DIGEST_A}], failures: []}
        })

        await adapter.items.deleteItem!('web', DIGEST_A)

        expect(sent[0]).toBeInstanceOf(BatchDeleteImageCommand)
        expect((sent[0] as BatchDeleteImageCommand).input).toEqual({
            repositoryName: 'web',
            imageIds: [{imageDigest: DIGEST_A}],
        })
    })

    test('rejects a tag or other non-digest id before any request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        for (const id of ['latest', '', 'sha256:', ':abc']) {
            await expect(adapter.items.deleteItem!('web', id)).rejects.toBeInstanceOf(ValidationError)
        }
        expect(sent).toEqual([])
    })

    test('maps BatchDeleteImage failures, which arrive inside a 200 response', async () => {
        const cases: Array<[string, unknown]> = [
            ['ImageNotFound', NotFoundError],
            ['ImageReferencedByManifestList', ConflictError],
            ['InvalidImageDigest', ValidationError],
            ['KmsError', RuntimeError],
        ]

        for (const [failureCode, errorType] of cases) {
            const adapter = createAdapter(async () => ({
                imageIds: [],
                failures: [{imageId: {imageDigest: DIGEST_A}, failureCode, failureReason: 'Image not found'}],
            }))

            await expect(adapter.items.deleteItem!('web', DIGEST_A)).rejects.toBeInstanceOf(errorType as typeof Error)
        }
    })

    test('a delete that ECR neither confirms nor refuses is not reported as success', async () => {
        const adapter = createAdapter(async () => ({imageIds: [], failures: []}))

        await expect(adapter.items.deleteItem!('web', DIGEST_A)).rejects.toBeInstanceOf(RuntimeError)
    })
})

function repository(name: string): Repository {
    return {
        repositoryName: name,
        repositoryArn: `arn:aws:ecr:us-east-1:${ACCOUNT}:repository/${name}`,
        registryId: ACCOUNT,
        repositoryUri: `${ACCOUNT}.dkr.ecr.us-east-1.localhost:4566/${name}`,
        createdAt: new Date('2026-09-30T08:00:00.000Z'),
        imageTagMutability: 'MUTABLE',
        imageScanningConfiguration: {scanOnPush: false},
        encryptionConfiguration: {encryptionType: 'AES256'},
    }
}

function image(digest: string, tags: string[] | undefined): ImageDetail {
    return {
        registryId: ACCOUNT,
        repositoryName: 'web',
        imageDigest: digest,
        imageTags: tags,
        imageSizeInBytes: 1024,
        imagePushedAt: PUSHED_AT,
        imageManifestMediaType: 'application/vnd.oci.image.manifest.v1+json',
    }
}

/** An error shaped like an AWS SDK v3 failure, as the ECR client throws it. */
function sdkError(name: string): Error {
    const err = new Error(`${name} from the runtime`)
    err.name = name
    return Object.assign(err, {$fault: 'client', $metadata: {httpStatusCode: 400}})
}

function createAdapter(handler: SendHandler = async () => ({})): AwsRegistryAdapter {
    return new AwsRegistryAdapter({send: handler} as unknown as ECRClient)
}
