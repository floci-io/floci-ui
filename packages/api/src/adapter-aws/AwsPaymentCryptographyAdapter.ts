import {
    CreateKeyCommand,
    DeleteKeyCommand,
    GetKeyCommand,
    ListKeysCommand,
    ListTagsForResourceCommand,
    type Key,
    type KeyModesOfUse,
    type PaymentCryptographyClient,
    TagResourceCommand,
    UntagResourceCommand,
} from '@aws-sdk/client-payment-cryptography'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    algorithmsForUsage,
    awsPaymentCryptographySchema,
    keyClassForAlgorithm,
    PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS,
    PAYMENT_CRYPTOGRAPHY_KEY_USAGES,
    PAYMENT_CRYPTOGRAPHY_MODES_OF_USE,
    type PaymentCryptographyKeyAlgorithm,
    type PaymentCryptographyKeyUsage,
} from '../cloud-spi/paymentCryptographySchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

type KeyTag = {key: string; value: string}

/** Tags plus whether the lookup itself failed, so an untagged key and an unreadable one stay distinguishable. */
type TagLookup = {tags: KeyTag[]; unavailable?: true}

/** ListKeys takes at most 100 keys per page. */
const LIST_PAGE_SIZE = 100

export class AwsPaymentCryptographyAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'paymentcryptography' as const

    constructor(private readonly client: PaymentCryptographyClient) {}

    schema(): ServiceSchema {
        return awsPaymentCryptographySchema()
    }

    /**
     * The summary carries the attributes, the check value and the flags, but not the
     * moment the key was made, so every key is read in full. The count of keys is
     * the count of a local account, not of a cloud one.
     */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const arns = await this.listKeyArns()
        const resources = await Promise.all(
            arns.map(async (arn) => {
                const key = await this.describe(arn)
                return key ? toResource(key, {tags: []}) : null
            }),
        )
        return filterBySearch(resources.filter((resource): resource is CloudResource => resource !== null), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const key = await this.describe(id)
        if (!key) return null
        return toResource(key, await this.getTags(id))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const keyUsage = oneOf(input.values.keyUsage, PAYMENT_CRYPTOGRAPHY_KEY_USAGES, 'keyUsage')
        const keyAlgorithm = algorithmFor(keyUsage, input.values.keyAlgorithm)
        const keyModesOfUse = modesOfUse(input.values)

        const res = await this.client.send(
            new CreateKeyCommand({
                KeyAttributes: {
                    KeyUsage: keyUsage,
                    KeyAlgorithm: keyAlgorithm,
                    KeyClass: keyClassForAlgorithm(keyAlgorithm),
                    KeyModesOfUse: keyModesOfUse,
                },
                Exportable: booleanValue(input.values.exportable, 'exportable', false),
                Enabled: booleanValue(input.values.enabled, 'enabled', true),
            }),
        )
        if (!res.Key) throw new RuntimeError('Payment Cryptography did not return the key it created')

        // A brand new key has no tags, so this skips the ListTagsForResource call.
        return toResource(res.Key, {tags: []})
    }

    /**
     * Deletion is scheduled, not immediate: the key is disabled and stays readable
     * until the waiting period ends, which is the reference's own behaviour.
     */
    async delete(id: string): Promise<void> {
        await this.client.send(new DeleteKeyCommand({KeyIdentifier: id}))
    }

    async updateTags(id: string, tags: Record<string, string | null>): Promise<void> {
        const added = Object.entries(tags).filter((entry): entry is [string, string] => entry[1] !== null)
        const removed = Object.keys(tags).filter((key) => tags[key] === null)

        if (added.length > 0) {
            await this.client.send(
                new TagResourceCommand({
                    ResourceArn: id,
                    Tags: added.map(([key, value]) => ({Key: key, Value: value})),
                }),
            )
        }
        if (removed.length > 0) {
            await this.client.send(new UntagResourceCommand({ResourceArn: id, TagKeys: removed}))
        }
    }

    /** ListKeys pages at 100 keys, so an account past that would silently truncate. */
    private async listKeyArns(): Promise<string[]> {
        const arns: string[] = []
        let nextToken: string | undefined

        do {
            const res = await this.client.send(
                new ListKeysCommand({
                    MaxResults: LIST_PAGE_SIZE,
                    ...(nextToken ? {NextToken: nextToken} : {}),
                }),
            )
            for (const key of res.Keys ?? []) {
                if (key.KeyArn) arns.push(key.KeyArn)
            }
            nextToken = res.NextToken
        } while (nextToken)

        return arns
    }

    private async describe(id: string): Promise<Key | null> {
        try {
            const res = await this.client.send(new GetKeyCommand({KeyIdentifier: id}))
            return res.Key ?? null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    /**
     * Tags are enrichment, so a failure degrades the inspector rather than the
     * request, and is reported so it cannot pass for an untagged key.
     */
    private async getTags(id: string): Promise<TagLookup> {
        const tags: KeyTag[] = []
        let nextToken: string | undefined

        try {
            do {
                const res = await this.client.send(
                    new ListTagsForResourceCommand({
                        ResourceArn: id,
                        ...(nextToken ? {NextToken: nextToken} : {}),
                    }),
                )
                for (const tag of res.Tags ?? []) {
                    tags.push({key: tag.Key ?? '', value: tag.Value ?? ''})
                }
                nextToken = res.NextToken
            } while (nextToken)
        } catch {
            // Keep whatever pages already arrived rather than discarding them.
            return {tags, unavailable: true}
        }

        return {tags}
    }
}

/**
 * The algorithm a key is made of, for the usage it is made for.
 *
 * The usage binds the key to its purpose, so a key whose algorithm does not serve
 * that purpose is refused. The local runtime is more permissive here than the
 * reference, so this table, not the runtime, is the authority.
 */
function algorithmFor(
    keyUsage: PaymentCryptographyKeyUsage,
    raw: unknown,
): PaymentCryptographyKeyAlgorithm {
    const allowed = algorithmsForUsage(keyUsage)
    const requested = oneOf(raw, PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS, 'keyAlgorithm', allowed[0])

    if (!(allowed as readonly string[]).includes(requested)) {
        throw new ValidationError(
            `keyAlgorithm ${requested} is not valid for keyUsage ${keyUsage}; use one of ${allowed.join(', ')}`,
        )
    }
    return requested
}

/**
 * The modes of use the key is made with.
 *
 * A mode says what the key may be used for, so a key with none of them does no
 * work: one is required, and the refusal names the field rather than the key.
 */
function modesOfUse(values: Record<string, unknown>): KeyModesOfUse {
    const modes: KeyModesOfUse = {}

    for (const mode of PAYMENT_CRYPTOGRAPHY_MODES_OF_USE) {
        const value = values[`mode${mode}`]
        if (value === undefined || value === null || value === '') continue
        modes[mode] = value === 'true'
    }

    if (!Object.values(modes).some(Boolean)) {
        throw new ValidationError(
            'a key needs at least one mode of use: it is what says what the key may be used for',
        )
    }
    return modes
}

function toResource(key: Key, tagLookup: TagLookup): CloudResource {
    const arn = key.KeyArn ?? ''

    return {
        id: arn,
        // A payment key has no name of its own: the ARN is its identity.
        name: arn,
        cloud: 'aws',
        service: 'paymentcryptography',
        type: 'key',
        region: regionFromArn(arn),
        createdAt: key.CreateTimestamp ? key.CreateTimestamp.toISOString() : null,
        status: key.KeyState ?? null,
        metadata: {
            arn,
            keyClass: key.KeyAttributes?.KeyClass,
            keyUsage: key.KeyAttributes?.KeyUsage,
            keyAlgorithm: key.KeyAttributes?.KeyAlgorithm,
            keyModesOfUse: key.KeyAttributes?.KeyModesOfUse,
            keyCheckValue: key.KeyCheckValue,
            keyCheckValueAlgorithm: key.KeyCheckValueAlgorithm,
            keyOrigin: key.KeyOrigin,
            enabled: key.Enabled,
            exportable: key.Exportable,
            usageStartTimestamp: isoDate(key.UsageStartTimestamp),
            usageStopTimestamp: isoDate(key.UsageStopTimestamp),
            deletePendingTimestamp: isoDate(key.DeletePendingTimestamp),
            deleteTimestamp: isoDate(key.DeleteTimestamp),
            multiRegionKeyType: key.MultiRegionKeyType,
            primaryRegion: key.PrimaryRegion,
            tags: tagLookup.tags,
            ...(tagLookup.unavailable ? {tagsUnavailable: true} : {}),
        },
    }
}

/** `arn:aws:payment-cryptography:us-east-1:000000000000:key/<id>`: the region is the 4th field. */
function regionFromArn(arn: string | undefined): string | null {
    return arn?.split(':')[3] || null
}

function isoDate(value: Date | undefined): string | null {
    return value ? value.toISOString() : null
}

/** Matches on the ARN and the usage, because the ARN alone says nothing of the key. */
function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter((resource) => {
        const usage = String(resource.metadata.keyUsage ?? '').toLowerCase()
        return resource.name.toLowerCase().includes(normalized) || usage.includes(normalized)
    })
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value
}

/**
 * A yes-or-no member of the create form, which arrives as the text of the answer
 * the form offered.
 */
function booleanValue(value: unknown, field: string, fallback: boolean): boolean {
    const raw = optionalString(value, field)
    if (raw === undefined) return fallback
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new ValidationError(`${field} must be either true or false`)
}

/**
 * Keeps create honest about the schema: a value the form never offers would be
 * rejected by the service anyway, and failing here gives a typed error instead.
 */
function oneOf<T extends readonly string[]>(
    value: unknown,
    allowed: T,
    field: string,
    fallback: T[number] = allowed[0] as T[number],
): T[number] {
    const raw = optionalString(value, field)
    if (raw === undefined) return fallback
    if (!allowed.includes(raw)) {
        throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
    }
    return raw as T[number]
}

/**
 * Payment Cryptography answers a missing key with `ResourceNotFoundException` and
 * HTTP **400**, the way KMS does, so the name is the signal and the status is only
 * a fallback for the emulator.
 */
function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    if ((error as {name?: string}).name === 'ResourceNotFoundException') return true
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === 404
}
