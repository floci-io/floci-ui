import {
    CreateAliasCommand,
    CreateKeyCommand,
    DeleteAliasCommand,
    DeleteKeyCommand,
    GetAliasCommand,
    GetKeyCommand,
    ListAliasesCommand,
    ListKeysCommand,
    ListTagsForResourceCommand,
    type Alias,
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
    PAYMENT_CRYPTOGRAPHY_KIND_PREFIX,
    PAYMENT_CRYPTOGRAPHY_KINDS,
    PAYMENT_CRYPTOGRAPHY_MODES_OF_USE,
    PAYMENT_CRYPTOGRAPHY_USAGE_RULES,
    type ModeCombination,
    type PaymentCryptographyKeyAlgorithm,
    type PaymentCryptographyKeyUsage,
    type PaymentCryptographyKind,
    type PaymentCryptographyModeOfUse,
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

/** The prefix an alias's own name carries, as the reference names it. */
const ALIAS_PREFIX = 'alias/'

/** The reference's own rule for the name of an alias. */
const ALIAS_NAME_PATTERN = /^alias\/[A-Za-z0-9/_-]+$/

export class AwsPaymentCryptographyAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'paymentcryptography' as const

    constructor(private readonly client: PaymentCryptographyClient) {}

    schema(): ServiceSchema {
        return awsPaymentCryptographySchema()
    }

    /**
     * The keys and the aliases that name them, in one table.
     *
     * The summary of a key carries the attributes, the check value and the flags, but
     * not the moment the key was made, so every key is read in full. The count of
     * keys is the count of a local account, not of a cloud one.
     */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const kinds = kind ? [kind] : [...PAYMENT_CRYPTOGRAPHY_KINDS]
        const groups = await Promise.all(kinds.map((each) => this.listKind(each)))
        return filterBySearch(groups.flat(), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            const alias = await this.describeAlias(identifier)
            return alias ? toAliasResource(alias) : null
        }
        const key = await this.describe(identifier)
        if (!key) return null
        return toResource(key, await this.getTags(identifier))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const kind = oneOf(input.values.kind, PAYMENT_CRYPTOGRAPHY_KINDS, 'kind', 'keys')
        if (kind === 'aliases') {
            return this.createAlias(input)
        }

        const keyUsage = oneOf(input.values.keyUsage, PAYMENT_CRYPTOGRAPHY_KEY_USAGES, 'keyUsage')
        const keyAlgorithm = algorithmFor(keyUsage, input.values.keyAlgorithm)
        const keyModesOfUse = modesOfUse(input.values, keyUsage)

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
     *
     * <p>An alias is removed at once, which is the reference's own behaviour too.
     */
    async delete(id: string): Promise<void> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            await this.client.send(new DeleteAliasCommand({AliasName: aliasNameOf(identifier)}))
            return
        }
        await this.client.send(new DeleteKeyCommand({KeyIdentifier: identifier}))
    }

    async updateTags(id: string, tags: Record<string, string | null>): Promise<void> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            // An alias carries no tags of its own: the tags belong to the key it names.
            throw new ValidationError('an alias carries no tags of its own; the key it names does')
        }

        const added = Object.entries(tags).filter((entry): entry is [string, string] => entry[1] !== null)
        const removed = Object.keys(tags).filter((key) => tags[key] === null)

        if (added.length > 0) {
            await this.client.send(
                new TagResourceCommand({
                    ResourceArn: identifier,
                    Tags: added.map(([key, value]) => ({Key: key, Value: value})),
                }),
            )
        }
        if (removed.length > 0) {
            await this.client.send(new UntagResourceCommand({ResourceArn: identifier, TagKeys: removed}))
        }
    }

    /**
     * One page is enough to prove liveness without paging the whole account.
     *
     * The status is polled every few seconds, and the table's own list reads every
     * key in full, so the probe reads one page rather than the account.
     */
    async health(): Promise<void> {
        await this.client.send(new ListKeysCommand({MaxResults: 1}))
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

    /** One kind of resource: the keys, or the aliases that name them. */
    private async listKind(kind: PaymentCryptographyKind): Promise<CloudResource[]> {
        if (kind === 'aliases') {
            return (await this.listAliases()).map(toAliasResource)
        }

        const arns = await this.listKeyArns()
        const resources = await Promise.all(
            arns.map(async (arn) => {
                const key = await this.describe(arn)
                return key ? toResource(key, {tags: []}) : null
            }),
        )
        return resources.filter((resource): resource is CloudResource => resource !== null)
    }

    /** ListAliases pages like ListKeys, so an account past that would be truncated. */
    private async listAliases(): Promise<Alias[]> {
        const aliases: Alias[] = []
        let nextToken: string | undefined

        do {
            const res = await this.client.send(
                new ListAliasesCommand({
                    MaxResults: LIST_PAGE_SIZE,
                    ...(nextToken ? {NextToken: nextToken} : {}),
                }),
            )
            aliases.push(...(res.Aliases ?? []))
            nextToken = res.NextToken
        } while (nextToken)

        return aliases
    }

    /** An alias, by the name it goes under. */
    private async describeAlias(identifier: string): Promise<Alias | null> {
        try {
            const res = await this.client.send(new GetAliasCommand({AliasName: aliasNameOf(identifier)}))
            return res.Alias ?? null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    /** An alias points at a key, and the reference refuses one that points at none. */
    private async createAlias(input: CreateResourceInput): Promise<CloudResource> {
        const aliasName = requiredAliasName(input.values.aliasName)
        const targetKey = requiredString(input.values.aliasTargetKey, 'aliasTargetKey')

        const res = await this.client.send(new CreateAliasCommand({AliasName: aliasName, KeyArn: targetKey}))
        if (!res.Alias) throw new RuntimeError('Payment Cryptography did not return the alias it created')

        return toAliasResource(res.Alias)
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
 * work. The reference allows a fixed set of combinations of them per usage, so a
 * combination that is not one of those is refused and the ones that are named.
 */
function modesOfUse(values: Record<string, unknown>, keyUsage: PaymentCryptographyKeyUsage): KeyModesOfUse {
    const modes: KeyModesOfUse = {}

    for (const mode of PAYMENT_CRYPTOGRAPHY_MODES_OF_USE) {
        const value = values[`mode${mode}`]
        if (value === undefined || value === null || value === '') continue
        // A mode is a yes or a no, so anything else is a fault of the caller rather
        // than a quiet "no".
        if (booleanValue(value, `mode${mode}`)) {
            modes[mode] = true
        }
    }

    const allowed = Object.keys(modes) as PaymentCryptographyModeOfUse[]
    const combinations = PAYMENT_CRYPTOGRAPHY_USAGE_RULES[keyUsage].modes
    if (!combinations.some((combination) => sameModes(combination, allowed))) {
        throw new ValidationError(
            `the modes of use ${labelModes(allowed)} are not valid for keyUsage ${keyUsage}; ` +
            `use one of ${combinations.map(labelModes).join(', ')}`,
        )
    }
    return modes
}

/** Whether two sets of modes of use are the same, whatever order they are in. */
function sameModes(combination: ModeCombination, allowed: readonly PaymentCryptographyModeOfUse[]): boolean {
    if (combination.length !== allowed.length) return false
    const left = orderedModes(combination)
    const right = orderedModes(allowed)
    return left.every((mode, index) => mode === right[index])
}

/**
 * A combination of modes of use, for a message.
 *
 * The modes are in the order the reference names them in, so a combination reads the
 * way the reference's own table writes it.
 */
function labelModes(modes: readonly PaymentCryptographyModeOfUse[]): string {
    return modes.length === 0 ? 'none' : orderedModes(modes).join('+')
}

function orderedModes(modes: readonly PaymentCryptographyModeOfUse[]): PaymentCryptographyModeOfUse[] {
    return [...modes].sort((a, b) => PAYMENT_CRYPTOGRAPHY_MODES_OF_USE.indexOf(a) - PAYMENT_CRYPTOGRAPHY_MODES_OF_USE.indexOf(b))
}

function toResource(key: Key, tagLookup: TagLookup): CloudResource {
    const arn = key.KeyArn ?? ''

    return {
        id: `${PAYMENT_CRYPTOGRAPHY_KIND_PREFIX.keys}/${arn}`,
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

/**
 * An alias, which is a name for a key.
 *
 * <p>The reference's own alias list carries the name and the key it points at, and
 * nothing else: an alias has no attributes of its own, so the row shows the key's
 * name and leaves the key's own columns empty.
 */
function toAliasResource(alias: Alias): CloudResource {
    const name = alias.AliasName ?? ''
    const identifier = name.startsWith(ALIAS_PREFIX) ? name.slice(ALIAS_PREFIX.length) : name

    return {
        id: `${PAYMENT_CRYPTOGRAPHY_KIND_PREFIX.aliases}/${identifier}`,
        name,
        cloud: 'aws',
        service: 'paymentcryptography',
        type: 'alias',
        // An alias is regional, and it is in the region of the key it names.
        region: regionFromArn(alias.KeyArn),
        createdAt: null,
        status: null,
        metadata: {
            aliasName: name,
            targetKeyArn: alias.KeyArn ?? null,
            tags: [],
        },
    }
}

/**
 * The kind and the identifier of a resource id.
 *
 * <p>The explorer holds several kinds in one table, so the id says which kind it is:
 * `key/<arn>` for a key and `alias/<name>` for an alias. The name is the one the
 * alias goes under, without the `alias/` the reference's own name carries.
 */
function parseId(id: string): {kind: PaymentCryptographyKind; identifier: string} {
    const slash = id.indexOf('/')
    if (slash < 0) {
        throw new ValidationError(`the resource id ${id} names no kind`)
    }
    const prefix = id.slice(0, slash)
    const kind = kindForPrefix(prefix)
    return {kind, identifier: id.slice(slash + 1)}
}

function kindForPrefix(prefix: string): PaymentCryptographyKind {
    for (const kind of PAYMENT_CRYPTOGRAPHY_KINDS) {
        if (PAYMENT_CRYPTOGRAPHY_KIND_PREFIX[kind] === prefix) return kind
    }
    throw new ValidationError(`the resource id names the unknown kind ${prefix}`)
}

/** The kind a request asks for, or none when it asks for every kind. */
function optionalKind(value: unknown): PaymentCryptographyKind | undefined {
    if (value === undefined || value === null || value === '') return undefined
    return oneOf(value, PAYMENT_CRYPTOGRAPHY_KINDS, 'kind')
}

/** The name the reference gives an alias, which carries the `alias/` prefix. */
function aliasNameOf(identifier: string): string {
    return identifier.startsWith(ALIAS_PREFIX) ? identifier : `${ALIAS_PREFIX}${identifier}`
}

/**
 * The name an alias is created under.
 *
 * <p>The reference's own rule: the name begins with `alias/` and holds only letters,
 * digits, slashes, underscores and dashes.
 */
function requiredAliasName(value: unknown): string {
    const name = requiredString(value, 'aliasName')
    if (!ALIAS_NAME_PATTERN.test(name)) {
        throw new ValidationError(
            'aliasName must begin with "alias/" and hold only letters, digits, slashes, underscores and dashes',
        )
    }
    return name
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

function requiredString(value: unknown, field: string): string {
    const raw = optionalString(value, field)?.trim()
    if (!raw) throw new ValidationError(`${field} is required`)
    return raw
}

/**
 * A yes-or-no member of the create form, which arrives as the text of the answer
 * the form offered. Anything else is a fault of the caller, not a quiet "no".
 */
function booleanValue(value: unknown, field: string, fallback = false): boolean {
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
