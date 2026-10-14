import {describe, expect, test} from 'bun:test'
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
    type DistributionSummary,
} from '@aws-sdk/client-cloudfront'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {AwsCloudFrontAdapter} from './AwsCloudFrontAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

const MODIFIED = new Date('2026-10-01T00:00:00.000Z')

describe('AwsCloudFrontAdapter', () => {
    test('identifies CloudFront as the AWS cdn adapter', () => {
        const adapter = createAdapter()

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('cdn')
        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'cdn', displayName: 'CloudFront Distributions'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'delete', 'inspect'])
    })

    test('follows the marker through every page of distributions', async () => {
        const markers: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            if (!(command instanceof ListDistributionsCommand)) throw new Error('Unexpected command')
            markers.push(command.input.Marker)
            return command.input.Marker
                ? {DistributionList: {Items: [summary('E2')], IsTruncated: false}}
                : {DistributionList: {Items: [summary('E1')], IsTruncated: true, NextMarker: 'E1'}}
        })

        const resources = await adapter.list()

        expect(resources.map((resource) => resource.id)).toEqual(['E1', 'E2'])
        expect(markers).toEqual([undefined, 'E1'])
    })

    test('rejects a repeated ListDistributions marker', async () => {
        const adapter = createAdapter(async () => ({
            DistributionList: {Items: [summary('E1')], IsTruncated: true, NextMarker: 'again'},
        }))

        await expect(adapter.list()).rejects.toThrow('CloudFront ListDistributions repeated a marker')
    })

    test('maps a summary to the shared resource shape', async () => {
        const adapter = createAdapter(async () => ({
            DistributionList: {
                Items: [
                    {
                        ...summary('E1'),
                        Comment: 'site',
                        Aliases: {Quantity: 1, Items: ['www.example.com']},
                        Origins: {Quantity: 1, Items: [{Id: 'web', DomainName: 'app.example.com'}]},
                        PriceClass: 'PriceClass_100',
                    },
                ],
                IsTruncated: false,
            },
        }))

        await expect(adapter.list()).resolves.toEqual([
            {
                id: 'E1',
                name: 'E1',
                cloud: 'aws',
                service: 'cdn',
                type: 'cloudfront-distribution',
                region: null,
                createdAt: null,
                status: 'Deployed',
                metadata: {
                    provider: 'aws',
                    arn: 'arn:aws:cloudfront::000000000000:distribution/E1',
                    domainName: 'e1.cloudfront.net',
                    enabled: true,
                    comment: 'site',
                    aliases: ['www.example.com'],
                    origins: [{id: 'web', domainName: 'app.example.com'}],
                    priceClass: 'PriceClass_100',
                    lastModifiedTime: '2026-10-01T00:00:00.000Z',
                    inProgressInvalidationBatches: null,
                },
            },
        ])
    })

    test('filters by id, comment, domain name and alias', async () => {
        const adapter = createAdapter(async () => ({
            DistributionList: {
                Items: [
                    {...summary('EAAA'), Comment: 'storefront'},
                    {...summary('EBBB'), Aliases: {Quantity: 1, Items: ['cdn.example.org']}},
                    summary('ECCC'),
                ],
                IsTruncated: false,
            },
        }))

        const ids = async (search: string) => (await adapter.list({search})).map((resource) => resource.id)

        await expect(ids('store')).resolves.toEqual(['EAAA'])
        await expect(ids('EXAMPLE.ORG')).resolves.toEqual(['EBBB'])
        await expect(ids('eccc.cloudfront')).resolves.toEqual(['ECCC'])
    })

    test('inspects a distribution from its config', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof GetDistributionCommand) return {Distribution: distribution('E1')}
            throw new Error('Unexpected command')
        })

        await expect(adapter.get('E1')).resolves.toMatchObject({
            id: 'E1',
            status: 'Deployed',
            metadata: {enabled: false, comment: 'inspected', inProgressInvalidationBatches: 2},
        })
    })

    test('creates a disabled S3-origin distribution from a bucket host', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {Distribution: distribution('E1')}
        })

        await adapter.create({values: {originDomainName: ' my-bucket.s3.amazonaws.com ', comment: ' site '}})

        const config = (sent[0] as CreateDistributionCommand).input.DistributionConfig
        expect(config?.Enabled).toBe(false)
        expect(config?.Comment).toBe('site')
        expect(config?.CallerReference).toBeTruthy()
        expect(config?.Origins?.Items?.[0]).toEqual({
            Id: 'my-bucket.s3.amazonaws.com',
            DomainName: 'my-bucket.s3.amazonaws.com',
            S3OriginConfig: {OriginAccessIdentity: ''},
        })
        expect(config?.DefaultCacheBehavior?.TargetOriginId).toBe('my-bucket.s3.amazonaws.com')
    })

    test('creates a custom origin for any other host, enabled when asked', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {Distribution: distribution('E1')}
        })

        await adapter.create({values: {originDomainName: 'app.example.com', enabled: 'true'}})

        const config = (sent[0] as CreateDistributionCommand).input.DistributionConfig
        expect(config?.Enabled).toBe(true)
        expect(config?.Origins?.Items?.[0].CustomOriginConfig).toMatchObject({OriginProtocolPolicy: 'match-viewer'})
        expect(config?.Origins?.Items?.[0].S3OriginConfig).toBeUndefined()
    })

    test('creates an HTTP-only custom origin for both S3 website host forms', async () => {
        for (const host of ['site.s3-website-us-east-1.amazonaws.com', 'site.s3-website.us-east-1.amazonaws.com']) {
            const sent: unknown[] = []
            const adapter = createAdapter(async (command) => {
                sent.push(command)
                return {Distribution: distribution('E1')}
            })

            await adapter.create({values: {originDomainName: host}})

            const origin = (sent[0] as CreateDistributionCommand).input.DistributionConfig?.Origins?.Items?.[0]
            expect(origin?.S3OriginConfig).toBeUndefined()
            expect(origin?.CustomOriginConfig).toMatchObject({OriginProtocolPolicy: 'http-only'})
        }
    })

    test('rejects a missing or malformed origin before any request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        for (const originDomainName of [undefined, '', '   ', 'https://app.example.com', 'app.example.com/path', 'a b']) {
            await expect(adapter.create({values: {originDomainName}})).rejects.toBeInstanceOf(ValidationError)
        }
        await expect(
            adapter.create({values: {originDomainName: 'app.example.com', comment: 'x'.repeat(129)}}),
        ).rejects.toBeInstanceOf(ValidationError)
        expect(sent).toEqual([])
    })

    test('deletes with the ETag it just read as If-Match', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return command instanceof GetDistributionConfigCommand ? {ETag: 'ETAG-1'} : {}
        })

        await adapter.delete('E1')

        expect(sent[0]).toBeInstanceOf(GetDistributionConfigCommand)
        expect(sent[1]).toBeInstanceOf(DeleteDistributionCommand)
        expect((sent[1] as DeleteDistributionCommand).input).toEqual({Id: 'E1', IfMatch: 'ETAG-1'})
    })

    test('health checks only the list operation', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {DistributionList: {Items: []}}
        })

        await adapter.health()

        expect(sent).toHaveLength(1)
        expect((sent[0] as ListDistributionsCommand).input.MaxItems).toBe(1)
    })
})

describe('AwsCloudFrontAdapter invalidations', () => {
    test('exposes one fixed invalidations collection with the in-flight count', async () => {
        const adapter = createAdapter(async () => ({Distribution: distribution('E1')}))

        const page = await adapter.documents.listCollections('E1')

        expect(page.nextCursor).toBeNull()
        expect(page.items).toEqual([
            {
                id: 'invalidations',
                name: 'Invalidations',
                parentId: 'E1',
                createdAt: null,
                metadata: {inProgressInvalidationBatches: 2},
            },
        ])
    })

    test('a missing distribution is not found rather than an empty collection list', async () => {
        const adapter = createAdapter(async () => ({}))

        await expect(adapter.documents.listCollections('ghost')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('an unknown collection id is not found', async () => {
        const adapter = createAdapter()

        await expect(adapter.documents.listItems('E1', 'policies')).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter.documents.putItem?.('E1', 'policies', {paths: '/a'})).rejects.toBeInstanceOf(NotFoundError)
    })

    test('lists invalidations, passing the marker through and returning the next one', async () => {
        let input: ListInvalidationsCommand['input'] | undefined
        const adapter = createAdapter(async (command) => {
            if (!(command instanceof ListInvalidationsCommand)) throw new Error('Unexpected command')
            input = command.input
            return {
                InvalidationList: {
                    Items: [{Id: 'I1', Status: 'Completed', CreateTime: MODIFIED}],
                    IsTruncated: true,
                    NextMarker: 'I1',
                },
            }
        })

        const page = await adapter.documents.listItems('E1', 'invalidations', {cursor: 'prev', limit: 500})

        expect(input).toEqual({DistributionId: 'E1', Marker: 'prev', MaxItems: 100})
        expect(page.nextCursor).toBe('I1')
        expect(page.items).toEqual([
            {
                id: 'I1',
                collectionId: 'invalidations',
                timestamp: '2026-10-01T00:00:00.000Z',
                body: {status: 'Completed', createTime: '2026-10-01T00:00:00.000Z'},
                metadata: {},
            },
        ])
    })

    test('the last page has no cursor', async () => {
        const adapter = createAdapter(async () => ({InvalidationList: {Items: [], IsTruncated: false}}))

        await expect(adapter.documents.listItems('E1', 'invalidations')).resolves.toEqual({items: [], nextCursor: null})
    })

    test('creates an invalidation from comma separated paths', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {Invalidation: {Id: 'I9', Status: 'InProgress', CreateTime: MODIFIED, InvalidationBatch: {}}}
        })

        const item = await adapter.documents.putItem?.('E1', 'invalidations', {paths: '/index.html, /img/*'})

        const input = (sent[0] as CreateInvalidationCommand).input
        expect(input.DistributionId).toBe('E1')
        expect(input.InvalidationBatch?.Paths).toEqual({Quantity: 2, Items: ['/index.html', '/img/*']})
        expect(input.InvalidationBatch?.CallerReference).toBeTruthy()
        expect(item).toMatchObject({id: 'I9', collectionId: 'invalidations', body: {status: 'InProgress'}})
    })

    test('rejects empty paths and paths without a leading slash before any request', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            sent.push(command)
            return {}
        })

        for (const paths of [undefined, '', ' , ', [], 'index.html', ['/ok', 'bad'], ['/index.html', 123]]) {
            await expect(adapter.documents.putItem?.('E1', 'invalidations', {paths})).rejects.toBeInstanceOf(
                ValidationError,
            )
        }
        expect(sent).toEqual([])
    })
})

function summary(id: string): DistributionSummary {
    return {
        Id: id,
        ARN: `arn:aws:cloudfront::000000000000:distribution/${id}`,
        Status: 'Deployed',
        LastModifiedTime: MODIFIED,
        DomainName: `${id.toLowerCase()}.cloudfront.net`,
        Enabled: true,
        Comment: '',
    } as DistributionSummary
}

function distribution(id: string): Distribution {
    return {
        Id: id,
        ARN: `arn:aws:cloudfront::000000000000:distribution/${id}`,
        Status: 'Deployed',
        LastModifiedTime: MODIFIED,
        InProgressInvalidationBatches: 2,
        DomainName: `${id.toLowerCase()}.cloudfront.net`,
        DistributionConfig: {
            CallerReference: 'ref',
            Comment: 'inspected',
            Enabled: false,
            Origins: {Quantity: 1, Items: [{Id: 'web', DomainName: 'app.example.com'}]},
            DefaultCacheBehavior: {TargetOriginId: 'web', ViewerProtocolPolicy: 'allow-all'},
        },
    }
}

function createAdapter(handler: SendHandler = async () => ({})): AwsCloudFrontAdapter {
    return new AwsCloudFrontAdapter({send: handler} as unknown as CloudFrontClient)
}
