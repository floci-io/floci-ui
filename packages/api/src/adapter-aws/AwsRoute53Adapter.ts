import {randomUUID} from 'node:crypto'
import {
    ChangeResourceRecordSetsCommand,
    CreateHostedZoneCommand,
    DeleteHostedZoneCommand,
    GetHostedZoneCommand,
    ListHostedZonesCommand,
    ListResourceRecordSetsCommand,
    type HostedZone,
    type ResourceRecordSet,
    type Route53Client,
    type RRType,
    type VPC,
} from '@aws-sdk/client-route-53'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {
    ROUTE53_COMMENT_MAX_LENGTH,
    ROUTE53_VPC_ID_PATTERN,
    ROUTE53_VPC_REGION_PATTERN,
    ROUTE53_ZONE_NAME_MAX_LENGTH,
    ROUTE53_ZONE_NAME_PATTERN,
    awsDnsSchema,
} from '../cloud-spi/dnsSchema'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const ZONE_NAME = new RegExp(ROUTE53_ZONE_NAME_PATTERN)
const VPC_ID = new RegExp(ROUTE53_VPC_ID_PATTERN)
const VPC_REGION = new RegExp(ROUTE53_VPC_REGION_PATTERN)
const ZONE_ID_PREFIX = '/hostedzone/'
const LIST_ZONES_MAX_ITEMS = 100
/** ListResourceRecordSets answers at most 300 per request. */
const LIST_RECORDS_MAX_ITEMS = 300
/** Records fetched to locate one by id: enough for a routed group when a runtime ignores StartRecordIdentifier. */
const LOCATE_RECORD_MAX_ITEMS = 100
const MAX_TTL = 2_147_483_647
const RECORD_NAME_MAX_LENGTH = 1024
const DEFAULT_TTL = 300

const RECORDS_COLLECTION = 'records'

/** Types a plain (non alias, non routed) record set can carry. */
/** Body keys that would make a record routed or an alias: listed by this adapter, never written. */
const ROUTING_FIELDS = [
    'setIdentifier',
    'weight',
    'region',
    'failover',
    'geoLocation',
    'healthCheckId',
    'multiValueAnswer',
    'aliasTarget',
] as const
const SIMPLE_RECORD_TYPES = ['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'PTR', 'SRV', 'TXT'] as const

/**
 * Amazon Route 53 through the provider-neutral DNS category.
 *
 * Notes from the Floci Route 53 reference and the SDK types:
 *  - Route 53 is global: no region segment in an ARN, so `region` is null.
 *  - Zone ids come back as `/hostedzone/Z...`; the prefix is dropped so the id is
 *    a single URL segment. The SDK accepts the id with or without it.
 *  - Management plane only for public zones. Private zones (a VPC on create) are
 *    the one case Floci answers, through its embedded resolver for containers.
 *  - A zone has no creation time or status, so `createdAt` and `status` stay null.
 */
export class AwsRoute53Adapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'dns' as const

    readonly documents: DocumentStoreAdapter

    constructor(private readonly route53: Route53Client) {
        this.documents = new Route53RecordStore(route53)
    }

    schema(): ServiceSchema {
        return awsDnsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const search = query.search?.trim().toLowerCase()
        const resources = (await this.listZones()).map((zone) => zoneToResource(zone))
        if (!search) return resources
        return resources.filter((resource) => matchesSearch(resource, search))
    }

    async get(id: string): Promise<CloudResource | null> {
        const res = await this.route53.send(new GetHostedZoneCommand({Id: id}))
        return res.HostedZone
            ? zoneToResource(res.HostedZone, {vpcs: res.VPCs, nameServers: res.DelegationSet?.NameServers})
            : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const values = input.values
        const name = zoneName(values.name)
        const comment = typeof values.comment === 'string' ? values.comment.trim() : ''
        if (comment.length > ROUTE53_COMMENT_MAX_LENGTH) {
            throw new ValidationError(`comment must be at most ${ROUTE53_COMMENT_MAX_LENGTH} characters.`)
        }
        const vpc = vpcFrom(values.vpcId, values.vpcRegion)

        const res = await this.route53.send(new CreateHostedZoneCommand({
            Name: name,
            CallerReference: randomUUID(),
            ...(comment || vpc
                ? {HostedZoneConfig: {...(comment ? {Comment: comment} : {}), ...(vpc ? {PrivateZone: true} : {})}}
                : {}),
            ...(vpc ? {VPC: vpc} : {}),
        }))
        if (!res.HostedZone) throw new RuntimeError('Route 53 did not return the hosted zone it created')
        return zoneToResource(res.HostedZone, {
            vpcs: res.VPC ? [res.VPC] : undefined,
            nameServers: res.DelegationSet?.NameServers,
        })
    }

    /** Route 53 refuses a zone that still holds records beyond the apex SOA and NS. */
    async delete(id: string): Promise<void> {
        await this.route53.send(new DeleteHostedZoneCommand({Id: id}))
    }

    /** One page is enough to prove liveness without paging the whole account. */
    async health(): Promise<void> {
        await this.route53.send(new ListHostedZonesCommand({MaxItems: 1}))
    }

    private async listZones(): Promise<HostedZone[]> {
        const zones: HostedZone[] = []
        const seenMarkers = new Set<string>()
        let marker: string | undefined

        do {
            const res = await this.route53.send(new ListHostedZonesCommand({Marker: marker, MaxItems: LIST_ZONES_MAX_ITEMS}))
            zones.push(...(res.HostedZones ?? []))
            marker = res.IsTruncated ? res.NextMarker : undefined
            if (marker) {
                if (seenMarkers.has(marker)) throw new RuntimeError('Route 53 ListHostedZones repeated a marker')
                seenMarkers.add(marker)
            }
        } while (marker)

        return zones
    }
}

/**
 * A hosted zone holds one fixed collection, its record sets. A record set is
 * identified by type, name and, for routed sets, a set identifier, so the item id
 * packs those three. Writing is an UPSERT and deleting needs the record's current
 * values, which Route 53 insists on, so the store reads them back first.
 */
class Route53RecordStore implements DocumentStoreAdapter {
    constructor(private readonly route53: Route53Client) {}

    async listCollections(zoneId: string): Promise<CollectionPage<ChildCollection>> {
        const res = await this.route53.send(new GetHostedZoneCommand({Id: zoneId}))
        if (!res.HostedZone) throw new NotFoundError(`Hosted zone not found: ${zoneId}`)

        return {
            items: [
                {
                    id: RECORDS_COLLECTION,
                    name: 'Record sets',
                    parentId: zoneId,
                    createdAt: null,
                    metadata: {recordCount: res.HostedZone.ResourceRecordSetCount ?? null},
                },
            ],
            nextCursor: null,
        }
    }

    async listItems(zoneId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        assertRecords(collectionId)
        const start = page.cursor ? decodeCursor(page.cursor) : undefined
        const res = await this.route53.send(new ListResourceRecordSetsCommand({
            HostedZoneId: zoneId,
            StartRecordName: start?.name,
            StartRecordType: start?.type,
            StartRecordIdentifier: start?.identifier,
            MaxItems: Math.min(page.limit ?? LIST_RECORDS_MAX_ITEMS, LIST_RECORDS_MAX_ITEMS),
        }))

        return {
            items: (res.ResourceRecordSets ?? []).map(recordToItem),
            nextCursor:
                res.IsTruncated && res.NextRecordName
                    ? encodeCursor({name: res.NextRecordName, type: res.NextRecordType, identifier: res.NextRecordIdentifier})
                    : null,
        }
    }

    async putItem(zoneId: string, collectionId: string, body: Record<string, unknown>): Promise<ChildItem> {
        assertRecords(collectionId)
        const record = simpleRecord(body)
        const res = await this.route53.send(new ChangeResourceRecordSetsCommand({
            HostedZoneId: zoneId,
            ChangeBatch: {Changes: [{Action: 'UPSERT', ResourceRecordSet: record}]},
        }))

        const item = recordToItem(record)
        return {...item, body: {...item.body, changeId: res.ChangeInfo?.Id, changeStatus: res.ChangeInfo?.Status}}
    }

    async deleteItem(zoneId: string, collectionId: string, itemId: string): Promise<void> {
        assertRecords(collectionId)
        const key = parseItemId(itemId)
        const found = await this.route53.send(new ListResourceRecordSetsCommand({
            HostedZoneId: zoneId,
            StartRecordName: key.name,
            StartRecordType: key.type,
            StartRecordIdentifier: key.identifier,
            MaxItems: LOCATE_RECORD_MAX_ITEMS,
        }))
        const record = found.ResourceRecordSets?.find((candidate) => sameRecord(candidate, key))
        if (!record) throw new NotFoundError(`Record set not found: ${itemId}`)

        await this.route53.send(new ChangeResourceRecordSetsCommand({
            HostedZoneId: zoneId,
            ChangeBatch: {Changes: [{Action: 'DELETE', ResourceRecordSet: record}]},
        }))
    }
}

function assertRecords(collectionId: string): void {
    if (collectionId !== RECORDS_COLLECTION) {
        throw new NotFoundError(`Unknown Route 53 collection ${collectionId}; use ${RECORDS_COLLECTION}`)
    }
}

function zoneName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new ValidationError('name is required')
    if (name.length > ROUTE53_ZONE_NAME_MAX_LENGTH || !ZONE_NAME.test(name)) {
        throw new ValidationError('Use a domain name such as example.com.')
    }
    return name
}

/** A private zone needs both halves; one without the other is a mistake, not a public zone. */
function vpcFrom(vpcId: unknown, vpcRegion: unknown): VPC | undefined {
    const id = typeof vpcId === 'string' ? vpcId.trim() : ''
    const region = typeof vpcRegion === 'string' ? vpcRegion.trim() : ''
    if (!id && !region) return undefined
    if (!id || !region) throw new ValidationError('A private zone needs both vpcId and vpcRegion.')
    if (!VPC_ID.test(id)) throw new ValidationError('vpcId must look like vpc-0123456789abcdef0.')
    if (!VPC_REGION.test(region)) throw new ValidationError('vpcRegion must look like us-east-1.')
    return {VPCId: id, VPCRegion: region as VPC['VPCRegion']}
}

function simpleRecord(body: Record<string, unknown>): ResourceRecordSet {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new ValidationError('name is required')
    if (name.length > RECORD_NAME_MAX_LENGTH) {
        throw new ValidationError(`name must be at most ${RECORD_NAME_MAX_LENGTH} characters.`)
    }

    const routed = ROUTING_FIELDS.filter((field) => body[field] !== undefined && body[field] !== null && body[field] !== '')
    if (routed.length > 0) {
        throw new ValidationError(`Routed and alias records are not editable here: remove ${routed.join(', ')}.`)
    }

    const type = typeof body.type === 'string' ? body.type.trim().toUpperCase() : ''
    if (!(SIMPLE_RECORD_TYPES as readonly string[]).includes(type)) {
        throw new ValidationError(`type must be one of ${SIMPLE_RECORD_TYPES.join(', ')}.`)
    }

    return {
        Name: name,
        Type: type as RRType,
        TTL: ttl(body.ttl),
        ResourceRecords: recordValues(body.values).map((Value) => ({Value})),
    }
}

function ttl(value: unknown): number {
    if (value === undefined || value === null || value === '') return DEFAULT_TTL
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TTL) {
        throw new ValidationError(`ttl must be a whole number between 0 and ${MAX_TTL}.`)
    }
    return parsed
}

/** An array, or one value per line: TXT and MX values contain commas and spaces. */
function recordValues(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : []
    const values = raw.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
    if (values.length === 0) throw new ValidationError('values is required: one or more record values.')
    return values
}

interface RecordKey {
    name: string
    type: RRType
    identifier?: string
}

function recordId(record: {Name?: string; Type?: string; SetIdentifier?: string}): string {
    const name = record.Name?.endsWith('.') ? record.Name : `${record.Name}.`
    return [record.Type, name, record.SetIdentifier].filter((part) => part !== undefined).join('|')
}

function parseItemId(itemId: string): RecordKey {
    // A set identifier may itself contain '|', so everything after the name belongs to it.
    const [type, name, ...identifier] = itemId.split('|')
    if (!type || !name) throw new ValidationError('A record set id looks like TYPE|name, with an optional |setIdentifier.')
    return {name, type: type as RRType, identifier: identifier.join('|') || undefined}
}

function sameRecord(record: ResourceRecordSet, key: RecordKey): boolean {
    return (
        normalizeName(record.Name) === normalizeName(key.name) &&
        record.Type === key.type &&
        (record.SetIdentifier ?? undefined) === key.identifier
    )
}

function normalizeName(name: string | undefined): string {
    const lower = (name ?? '').toLowerCase()
    return lower.endsWith('.') ? lower : `${lower}.`
}

function encodeCursor(key: {name?: string; type?: string; identifier?: string}): string {
    return Buffer.from(JSON.stringify(key)).toString('base64url')
}

function decodeCursor(cursor: string): {name: string; type: RRType; identifier?: string} {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
        if (typeof parsed.name === 'string' && typeof parsed.type === 'string') {
            return {
                name: parsed.name,
                type: parsed.type as RRType,
                identifier: typeof parsed.identifier === 'string' ? parsed.identifier : undefined,
            }
        }
    } catch {
        // fall through to the validation error
    }
    throw new ValidationError('cursor is not a valid Route 53 continuation token.')
}

function matchesSearch(resource: CloudResource, search: string): boolean {
    const {comment} = resource.metadata as {comment?: string}
    return [resource.id, resource.name, comment].some((value) => value?.toLowerCase().includes(search))
}

function zoneToResource(
    zone: HostedZone,
    detail: {vpcs?: VPC[]; nameServers?: string[]} = {},
): CloudResource {
    const id = (zone.Id ?? '').replace(ZONE_ID_PREFIX, '')
    const isPrivate = zone.Config?.PrivateZone === true
    return {
        id,
        name: zone.Name ?? id,
        cloud: 'aws',
        service: 'dns',
        type: 'route53-hosted-zone',
        // Route 53 is global: its ARNs carry no region segment.
        region: null,
        createdAt: null,
        status: null,
        metadata: {
            provider: 'aws',
            arn: `arn:aws:route53:::hostedzone/${id}`,
            zoneType: isPrivate ? 'Private' : 'Public',
            privateZone: isPrivate,
            recordCount: zone.ResourceRecordSetCount ?? null,
            comment: zone.Config?.Comment ?? '',
            callerReference: zone.CallerReference ?? null,
            vpcs: detail.vpcs?.map((vpc) => ({vpcId: vpc.VPCId, vpcRegion: vpc.VPCRegion})) ?? null,
            nameServers: detail.nameServers ?? null,
        },
    }
}

function recordToItem(record: ResourceRecordSet): ChildItem {
    return {
        id: recordId(record),
        collectionId: RECORDS_COLLECTION,
        timestamp: null,
        body: {
            name: record.Name,
            type: record.Type,
            ttl: record.TTL ?? null,
            values: (record.ResourceRecords ?? []).map((entry) => entry.Value),
            aliasTarget: record.AliasTarget
                ? {
                    dnsName: record.AliasTarget.DNSName,
                    hostedZoneId: record.AliasTarget.HostedZoneId,
                    evaluateTargetHealth: record.AliasTarget.EvaluateTargetHealth,
                }
                : null,
            setIdentifier: record.SetIdentifier ?? null,
        },
        metadata: {},
    }
}
