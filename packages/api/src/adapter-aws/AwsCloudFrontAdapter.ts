import {randomUUID} from 'node:crypto'
import {
    CreateDistributionCommand,
    CreateInvalidationCommand,
    DeleteDistributionCommand,
    GetDistributionCommand,
    GetDistributionConfigCommand,
    ListDistributionsCommand,
    ListInvalidationsCommand,
    type CloudFrontClient,
    type Distribution,
    type DistributionConfig,
    type DistributionSummary,
    type Invalidation,
    type InvalidationSummary,
    type Origin,
} from '@aws-sdk/client-cloudfront'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {
    CLOUDFRONT_COMMENT_MAX_LENGTH,
    CLOUDFRONT_ORIGIN_DOMAIN_MAX_LENGTH,
    CLOUDFRONT_ORIGIN_DOMAIN_PATTERN,
    awsCdnSchema,
} from '../cloud-spi/cdnSchema'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const ORIGIN_DOMAIN = new RegExp(CLOUDFRONT_ORIGIN_DOMAIN_PATTERN)
const S3_WEBSITE_HOST = /\.s3-website([.-][a-z0-9-]+)?\.amazonaws\.com$/i
const S3_ORIGIN_HOST = /\.s3([.-][a-z0-9-]+)?\.amazonaws\.com$/i
const LIST_MAX_ITEMS = 100
/** The AWS managed `CachingOptimized` policy, the one Floci's own CloudFront examples create with. */
const MANAGED_CACHE_POLICY_ID = '658327ea-f89d-4fab-a63d-7e88639e58f6'

const INVALIDATIONS_COLLECTION = 'invalidations'

/**
 * Amazon CloudFront through the provider-neutral CDN category.
 *
 * Notes from the Floci CloudFront reference and the SDK types:
 *  - CloudFront is a global service: no region segment in ARNs, so `region` is null.
 *  - A distribution has a last-modified time but no creation time, so `createdAt`
 *    stays null.
 *  - `DeleteDistribution` needs the current ETag as `If-Match` and is refused with
 *    `DistributionNotDisabled` (409) while `Enabled` is true. The adapter does not
 *    disable on the caller's behalf; the route reports the conflict.
 */
export class AwsCloudFrontAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'cdn' as const

    readonly documents: DocumentStoreAdapter

    constructor(private readonly cloudfront: CloudFrontClient) {
        this.documents = new CloudFrontInvalidationStore(cloudfront)
    }

    schema(): ServiceSchema {
        return awsCdnSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const search = query.search?.trim().toLowerCase()
        const resources = (await this.listSummaries()).map(summaryToResource)
        if (!search) return resources
        return resources.filter((resource) => matchesSearch(resource, search))
    }

    async get(id: string): Promise<CloudResource | null> {
        const res = await this.cloudfront.send(new GetDistributionCommand({Id: id}))
        return res.Distribution ? distributionToResource(res.Distribution) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const config = distributionConfig(input.values)
        const res = await this.cloudfront.send(new CreateDistributionCommand({DistributionConfig: config}))
        if (!res.Distribution) throw new RuntimeError('CloudFront did not return the distribution it created')
        return distributionToResource(res.Distribution)
    }

    async delete(id: string): Promise<void> {
        const current = await this.cloudfront.send(new GetDistributionConfigCommand({Id: id}))
        await this.cloudfront.send(new DeleteDistributionCommand({Id: id, IfMatch: current.ETag}))
    }

    /** One page is enough to prove liveness without paging the whole account. */
    async health(): Promise<void> {
        await this.cloudfront.send(new ListDistributionsCommand({MaxItems: 1}))
    }

    private async listSummaries(): Promise<DistributionSummary[]> {
        const summaries: DistributionSummary[] = []
        const seenMarkers = new Set<string>()
        let marker: string | undefined

        do {
            const res = await this.cloudfront.send(new ListDistributionsCommand({Marker: marker, MaxItems: LIST_MAX_ITEMS}))
            summaries.push(...(res.DistributionList?.Items ?? []))
            marker = res.DistributionList?.IsTruncated ? res.DistributionList.NextMarker : undefined
            if (marker) {
                if (seenMarkers.has(marker)) throw new RuntimeError('CloudFront ListDistributions repeated a marker')
                seenMarkers.add(marker)
            }
        } while (marker)

        return summaries
    }
}

/**
 * A distribution holds one fixed collection, its invalidations. Listing is a
 * plain read; creating one is a `put` whose body is the paths to clear, because
 * an invalidation is a request, not a stored document: it can be neither updated
 * nor deleted.
 */
class CloudFrontInvalidationStore implements DocumentStoreAdapter {
    constructor(private readonly cloudfront: CloudFrontClient) {}

    async listCollections(distributionId: string): Promise<CollectionPage<ChildCollection>> {
        const res = await this.cloudfront.send(new GetDistributionCommand({Id: distributionId}))
        if (!res.Distribution) throw new NotFoundError(`Distribution not found: ${distributionId}`)

        return {
            items: [
                {
                    id: INVALIDATIONS_COLLECTION,
                    name: 'Invalidations',
                    parentId: distributionId,
                    createdAt: null,
                    metadata: {inProgressInvalidationBatches: res.Distribution.InProgressInvalidationBatches ?? null},
                },
            ],
            nextCursor: null,
        }
    }

    async listItems(distributionId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        assertInvalidations(collectionId)
        const res = await this.cloudfront.send(new ListInvalidationsCommand({
            DistributionId: distributionId,
            Marker: page.cursor,
            MaxItems: Math.min(page.limit ?? LIST_MAX_ITEMS, LIST_MAX_ITEMS),
        }))
        const list = res.InvalidationList

        return {
            items: (list?.Items ?? []).map(summaryToItem),
            nextCursor: list?.IsTruncated ? (list.NextMarker ?? null) : null,
        }
    }

    async putItem(distributionId: string, collectionId: string, body: Record<string, unknown>): Promise<ChildItem> {
        assertInvalidations(collectionId)
        const paths = invalidationPaths(body.paths)
        const res = await this.cloudfront.send(new CreateInvalidationCommand({
            DistributionId: distributionId,
            InvalidationBatch: {CallerReference: randomUUID(), Paths: {Quantity: paths.length, Items: paths}},
        }))
        if (!res.Invalidation) throw new RuntimeError('CloudFront did not return the invalidation it created')
        return invalidationToItem(res.Invalidation)
    }
}

function assertInvalidations(collectionId: string): void {
    if (collectionId !== INVALIDATIONS_COLLECTION) {
        throw new NotFoundError(`Unknown CloudFront collection ${collectionId}; use ${INVALIDATIONS_COLLECTION}`)
    }
}

function distributionConfig(values: Record<string, unknown>): DistributionConfig {
    const domainName = originDomainName(values.originDomainName)
    const comment = typeof values.comment === 'string' ? values.comment.trim() : ''
    if (comment.length > CLOUDFRONT_COMMENT_MAX_LENGTH) {
        throw new ValidationError(`comment must be at most ${CLOUDFRONT_COMMENT_MAX_LENGTH} characters.`)
    }
    const enabled = values.enabled === true || values.enabled === 'true'
    const originId = domainName

    return {
        CallerReference: randomUUID(),
        Comment: comment,
        Enabled: enabled,
        Origins: {
            Quantity: 1,
            Items: [
                {
                    Id: originId,
                    DomainName: domainName,
                    ...originConfig(domainName),
                },
            ],
        },
        DefaultCacheBehavior: {
            TargetOriginId: originId,
            ViewerProtocolPolicy: 'redirect-to-https',
            CachePolicyId: MANAGED_CACHE_POLICY_ID,
            AllowedMethods: {Quantity: 2, Items: ['GET', 'HEAD']},
            Compress: true,
        },
    }
}

/**
 * An S3 static website endpoint is a custom origin that speaks HTTP only, even
 * though it lives in a bucket; only the plain bucket hosts use `S3OriginConfig`.
 */
function originConfig(domainName: string): Pick<Origin, 'S3OriginConfig' | 'CustomOriginConfig'> {
    if (!S3_WEBSITE_HOST.test(domainName) && S3_ORIGIN_HOST.test(domainName)) {
        return {S3OriginConfig: {OriginAccessIdentity: ''}}
    }
    return {
        CustomOriginConfig: {
            HTTPPort: 80,
            HTTPSPort: 443,
            OriginProtocolPolicy: S3_WEBSITE_HOST.test(domainName) ? 'http-only' : 'match-viewer',
        },
    }
}

function originDomainName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new ValidationError('originDomainName is required')
    if (name.length > CLOUDFRONT_ORIGIN_DOMAIN_MAX_LENGTH || !ORIGIN_DOMAIN.test(name)) {
        throw new ValidationError('Use a host name for the origin, without scheme, port or path.')
    }
    return name
}

/** Accepts the comma separated form the generic form sends, or an array. */
function invalidationPaths(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
    if (raw.some((path) => typeof path !== 'string')) throw new ValidationError('Each path must be a string.')
    const paths = (raw as string[]).map((path) => path.trim()).filter(Boolean)
    if (paths.length === 0) throw new ValidationError('paths is required: one or more paths to invalidate.')
    const invalid = paths.find((path) => !path.startsWith('/'))
    if (invalid) throw new ValidationError(`Each path must start with "/": ${invalid}`)
    return paths
}

function matchesSearch(resource: CloudResource, search: string): boolean {
    const {comment, domainName, aliases} = resource.metadata as {
        comment?: string
        domainName?: string
        aliases?: string[]
    }
    return [resource.name, comment, domainName, ...(aliases ?? [])].some((value) =>
        value?.toLowerCase().includes(search),
    )
}

function summaryToResource(summary: DistributionSummary): CloudResource {
    return toResource({
        id: summary.Id,
        arn: summary.ARN,
        status: summary.Status,
        domainName: summary.DomainName,
        lastModifiedTime: summary.LastModifiedTime,
        enabled: summary.Enabled,
        comment: summary.Comment,
        aliases: summary.Aliases?.Items,
        origins: summary.Origins?.Items,
        priceClass: summary.PriceClass,
        inProgressInvalidationBatches: undefined,
    })
}

function distributionToResource(distribution: Distribution): CloudResource {
    const config = distribution.DistributionConfig
    return toResource({
        id: distribution.Id,
        arn: distribution.ARN,
        status: distribution.Status,
        domainName: distribution.DomainName,
        lastModifiedTime: distribution.LastModifiedTime,
        enabled: config?.Enabled,
        comment: config?.Comment,
        aliases: config?.Aliases?.Items,
        origins: config?.Origins?.Items,
        priceClass: config?.PriceClass,
        inProgressInvalidationBatches: distribution.InProgressInvalidationBatches,
    })
}

interface DistributionFields {
    id?: string
    arn?: string
    status?: string
    domainName?: string
    lastModifiedTime?: Date
    enabled?: boolean
    comment?: string
    aliases?: string[]
    origins?: Array<{Id?: string; DomainName?: string}>
    priceClass?: string
    inProgressInvalidationBatches?: number
}

function toResource(fields: DistributionFields): CloudResource {
    const id = fields.id ?? ''
    return {
        id,
        name: id,
        cloud: 'aws',
        service: 'cdn',
        type: 'cloudfront-distribution',
        // CloudFront is global: its ARNs carry no region segment.
        region: null,
        createdAt: null,
        status: fields.status ?? null,
        metadata: {
            provider: 'aws',
            arn: fields.arn,
            domainName: fields.domainName,
            enabled: fields.enabled ?? null,
            comment: fields.comment ?? '',
            aliases: fields.aliases ?? [],
            origins: (fields.origins ?? []).map((origin) => ({id: origin.Id, domainName: origin.DomainName})),
            priceClass: fields.priceClass ?? null,
            lastModifiedTime: fields.lastModifiedTime?.toISOString() ?? null,
            inProgressInvalidationBatches: fields.inProgressInvalidationBatches ?? null,
        },
    }
}

function summaryToItem(summary: InvalidationSummary): ChildItem {
    const createdAt = summary.CreateTime?.toISOString() ?? null
    return {
        id: summary.Id ?? '',
        collectionId: INVALIDATIONS_COLLECTION,
        timestamp: createdAt,
        body: {status: summary.Status, createTime: createdAt},
        metadata: {},
    }
}

function invalidationToItem(invalidation: Invalidation): ChildItem {
    const createdAt = invalidation.CreateTime?.toISOString() ?? null
    const batch = invalidation.InvalidationBatch
    return {
        id: invalidation.Id ?? '',
        collectionId: INVALIDATIONS_COLLECTION,
        timestamp: createdAt,
        body: {
            status: invalidation.Status,
            createTime: createdAt,
            paths: batch?.Paths?.Items ?? [],
            callerReference: batch?.CallerReference,
        },
        metadata: {},
    }
}
