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
    type ImageFailure,
    type ImageTagMutability,
    type Repository,
} from '@aws-sdk/client-ecr'
import {
    DEFAULT_PAGE_LIMIT,
    type ChildItem,
    type CollectionPage,
    type ItemStoreAdapter,
    type PageQuery,
} from '../cloud-spi/childCollections'
import {
    type CloudError,
    ConflictError,
    NotFoundError,
    RuntimeError,
    ValidationError,
} from '../cloud-spi/errors'
import {
    ECR_REPOSITORY_NAME_MAX_LENGTH,
    ECR_REPOSITORY_NAME_MIN_LENGTH,
    ECR_REPOSITORY_NAME_PATTERN,
    ECR_TAG_MUTABILITY_VALUES,
    awsRegistrySchema,
} from '../cloud-spi/registrySchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const REPOSITORY_NAME = new RegExp(ECR_REPOSITORY_NAME_PATTERN)
/** DescribeRepositories and DescribeImages both answer at most 1000 per request. */
const DESCRIBE_MAX_RESULTS = 1000
/** Images embedded in inspect; `imagesTruncated` marks a repository holding more. */
const INSPECT_IMAGE_LIMIT = DEFAULT_PAGE_LIMIT
/** An OCI digest, `<algorithm>:<encoded>`, the one id BatchDeleteImage removes a whole image by. */
const IMAGE_DIGEST = /^[a-z0-9]+(?:[+._-][a-z0-9]+)*:[A-Za-z0-9=_-]+$/
const UNTAGGED = '<untagged>'

/**
 * Amazon ECR through the provider-neutral Container Registry category, written
 * against the Floci ECR handler (`EcrJsonHandler` and `EcrService`).
 *
 * Notes from the runtime source:
 *  - A missing repository is `RepositoryNotFoundException` with HTTP 400, so
 *    `awsErrors.ts` maps the name. A repository with no repository or lifecycle
 *    policy answers `RepositoryPolicyNotFoundException` or
 *    `LifecyclePolicyNotFoundException`, which inspect reports as no policy.
 *  - Repository metadata works without Docker, but image queries need Floci's
 *    registry container. Inspect therefore reads images as enrichment and flags
 *    `imagesUnavailable` when that read fails, instead of failing the inspect.
 *  - Floci answers DescribeImages with one detail per tag, so a manifest with two
 *    tags arrives twice. Details are merged by digest, the shape ECR returns.
 *  - Floci enumerates images through their tags, so it never lists an untagged
 *    image, and it records `imagePushedAt` the first time it describes an image.
 *  - Floci does not paginate DescribeRepositories or DescribeImages; the adapter
 *    still follows `nextToken` as ECR returns it.
 */
export class AwsRegistryAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'registry' as const

    readonly items: ItemStoreAdapter

    constructor(private readonly ecr: ECRClient) {
        this.items = new EcrImageStore(ecr)
    }

    schema(): ServiceSchema {
        return awsRegistrySchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const repositories: Repository[] = []
        const seenTokens = new Set<string>()
        let nextToken: string | undefined

        do {
            const res = await this.ecr.send(new DescribeRepositoriesCommand({nextToken, maxResults: DESCRIBE_MAX_RESULTS}))
            repositories.push(...(res.repositories ?? []))
            nextToken = followToken(res.nextToken, seenTokens, 'DescribeRepositories')
        } while (nextToken)

        return filterBySearch(repositories.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const repository = await this.describeRepository(id)
        if (!repository) return null

        const [repositoryPolicyText, lifecyclePolicyText, images] = await Promise.all([
            this.repositoryPolicy(id),
            this.lifecyclePolicy(id),
            this.firstImages(id),
        ])
        const resource = toResource(repository)
        return {
            ...resource,
            metadata: {
                ...resource.metadata,
                repositoryPolicyText,
                lifecyclePolicyText,
                images: images?.images ?? [],
                ...(images ? {} : {imagesUnavailable: true}),
                ...(images?.more ? {imagesTruncated: true} : {}),
            },
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const values = input.values
        const res = await this.ecr.send(new CreateRepositoryCommand({
            repositoryName: repositoryName(values.repositoryName),
            imageTagMutability: tagMutability(values.imageTagMutability),
            imageScanningConfiguration: {scanOnPush: values.scanOnPush === true || values.scanOnPush === 'true'},
        }))
        if (!res.repository) throw new RuntimeError('ECR did not return the repository it created')
        return toResource(res.repository)
    }

    /** `force` deletes the images with the repository; without it ECR refuses a repository that holds any. */
    async delete(id: string): Promise<void> {
        await this.ecr.send(new DeleteRepositoryCommand({repositoryName: id, force: true}))
    }

    /** One repository is enough to prove liveness without describing them all. */
    async health(): Promise<void> {
        await this.ecr.send(new DescribeRepositoriesCommand({maxResults: 1}))
    }

    private async describeRepository(name: string): Promise<Repository | null> {
        try {
            const res = await this.ecr.send(new DescribeRepositoriesCommand({repositoryNames: [name]}))
            return res.repositories?.[0] ?? null
        } catch (err) {
            if (isErrorNamed(err, 'RepositoryNotFoundException')) return null
            throw err
        }
    }

    private async repositoryPolicy(name: string): Promise<string | null> {
        try {
            const res = await this.ecr.send(new GetRepositoryPolicyCommand({repositoryName: name}))
            return res.policyText ?? null
        } catch (err) {
            if (isErrorNamed(err, 'RepositoryPolicyNotFoundException')) return null
            throw err
        }
    }

    private async lifecyclePolicy(name: string): Promise<string | null> {
        try {
            const res = await this.ecr.send(new GetLifecyclePolicyCommand({repositoryName: name}))
            return res.lifecyclePolicyText ?? null
        } catch (err) {
            if (isErrorNamed(err, 'LifecyclePolicyNotFoundException')) return null
            throw err
        }
    }

    /**
     * The first page of images, so opening a large repository stays cheap; the
     * images API pages through the rest. Null means the read failed, which keeps
     * "no images" and "could not list images" distinguishable.
     */
    private async firstImages(name: string): Promise<{images: Array<Record<string, unknown>>, more: boolean} | null> {
        try {
            const page = await this.items.listItems(name, {limit: INSPECT_IMAGE_LIMIT})
            return {images: page.items.map((item) => item.body), more: page.nextCursor !== null}
        } catch {
            return null
        }
    }
}

/**
 * A repository is itself the collection of its images, so the store is flat.
 * Images are addressed by digest only: deleting by tag untags on ECR but removes
 * the whole manifest on Floci, so a tag would mean different things per runtime.
 */
class EcrImageStore implements ItemStoreAdapter {
    constructor(private readonly ecr: ECRClient) {}

    async listItems(repositoryName: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const res = await this.ecr.send(new DescribeImagesCommand({
            repositoryName,
            nextToken: page.cursor,
            maxResults: pageSize(page),
        }))
        return {
            items: mergeByDigest(res.imageDetails ?? []).map(toImageItem),
            nextCursor: res.nextToken ?? null,
        }
    }

    async deleteItem(repositoryName: string, imageDigest: string): Promise<void> {
        if (!IMAGE_DIGEST.test(imageDigest)) {
            throw new ValidationError('Delete an image by its digest, e.g. sha256:<hex>.')
        }
        const res = await this.ecr.send(new BatchDeleteImageCommand({repositoryName, imageIds: [{imageDigest}]}))
        const [failure] = res.failures ?? []
        if (failure) throw imageFailureError(failure)
        // BatchDeleteImage answers 200 with per-image results, so silence is not success.
        if (!res.imageIds?.length) throw new RuntimeError(`ECR did not confirm that image ${imageDigest} was deleted`)
    }
}

function toResource(repository: Repository): CloudResource {
    const name = repository.repositoryName ?? ''
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'registry',
        type: 'ecr-repository',
        region: repository.repositoryArn?.split(':')[3] || null,
        createdAt: repository.createdAt?.toISOString() ?? null,
        metadata: {
            provider: 'aws',
            arn: repository.repositoryArn,
            registryId: repository.registryId,
            repositoryUri: repository.repositoryUri,
            imageTagMutability: repository.imageTagMutability,
            scanOnPush: repository.imageScanningConfiguration?.scanOnPush ?? null,
            encryptionType: repository.encryptionConfiguration?.encryptionType ?? null,
            kmsKey: repository.encryptionConfiguration?.kmsKey,
        },
    }
}

function toImageItem(detail: ImageDetail): ChildItem {
    const imageTags = detail.imageTags ?? []
    const pushedAt = detail.imagePushedAt?.toISOString() ?? null
    return {
        id: detail.imageDigest ?? '',
        collectionId: null,
        timestamp: pushedAt,
        body: {
            tags: imageTags.length > 0 ? imageTags.join(', ') : UNTAGGED,
            imageTags,
            imageDigest: detail.imageDigest,
            imageSizeInBytes: detail.imageSizeInBytes,
            imagePushedAt: pushedAt,
            imageManifestMediaType: detail.imageManifestMediaType,
            artifactMediaType: detail.artifactMediaType,
        },
        metadata: {registryId: detail.registryId},
    }
}

/** Folds details that share a digest into one, keeping the first and the union of their tags. */
function mergeByDigest(details: ImageDetail[]): ImageDetail[] {
    const merged: ImageDetail[] = []
    const byDigest = new Map<string, ImageDetail>()

    for (const detail of details) {
        const existing = detail.imageDigest ? byDigest.get(detail.imageDigest) : undefined
        if (!existing) {
            const copy = {...detail, imageTags: [...(detail.imageTags ?? [])]}
            merged.push(copy)
            if (detail.imageDigest) byDigest.set(detail.imageDigest, copy)
            continue
        }
        for (const tag of detail.imageTags ?? []) {
            if (!existing.imageTags?.includes(tag)) existing.imageTags?.push(tag)
        }
    }
    return merged
}

function imageFailureError(failure: ImageFailure): CloudError {
    const code = failure.failureCode ?? 'UnknownFailure'
    const message = `BatchDeleteImage failed with ${code}: ${failure.failureReason ?? 'no reason given'}`
    if (code === 'ImageNotFound') return new NotFoundError(message)
    if (code === 'ImageReferencedByManifestList') return new ConflictError(message)
    if (code === 'InvalidImageDigest') return new ValidationError(message)
    return new RuntimeError(message)
}

function repositoryName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new ValidationError('repositoryName is required')
    if (
        name.length < ECR_REPOSITORY_NAME_MIN_LENGTH
        || name.length > ECR_REPOSITORY_NAME_MAX_LENGTH
        || !REPOSITORY_NAME.test(name)
    ) {
        throw new ValidationError(
            `Use a valid ECR repository name: ${ECR_REPOSITORY_NAME_MIN_LENGTH} to ${ECR_REPOSITORY_NAME_MAX_LENGTH} lowercase letters and digits, separated by single dots, underscores, hyphens or slashes.`,
        )
    }
    return name
}

/** Left unset when not chosen, so ECR applies its own default (MUTABLE). */
function tagMutability(value: unknown): ImageTagMutability | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'string' && (ECR_TAG_MUTABILITY_VALUES as readonly string[]).includes(value)) {
        return value as ImageTagMutability
    }
    throw new ValidationError(`imageTagMutability must be one of ${ECR_TAG_MUTABILITY_VALUES.join(', ')}.`)
}

/** ECR describes at most 1000 per call; a larger requested page is capped and the cursor continues it. */
function pageSize(page: PageQuery): number {
    return Math.min(page.limit ?? DEFAULT_PAGE_LIMIT, DESCRIBE_MAX_RESULTS)
}

/** Returns the token to request next, refusing one already seen so a looping runtime cannot spin forever. */
function followToken(token: string | undefined, seen: Set<string>, operation: string): string | undefined {
    if (!token) return undefined
    if (seen.has(token)) throw new RuntimeError(`ECR ${operation} repeated a continuation token`)
    seen.add(token)
    return token
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isErrorNamed(err: unknown, name: string): boolean {
    return err instanceof Error && err.name === name
}
