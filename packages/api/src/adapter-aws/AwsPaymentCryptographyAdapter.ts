import {
    CreateAliasCommand,
    CreateKeyCommand,
    GetKeyCommand as ReadKey,
    DeleteAliasCommand,
    DeleteKeyCommand,
    GetAliasCommand,
    GetKeyCommand,
    GetPublicKeyCertificateCommand,
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
import {setKeyUsage} from './paymentCryptographyLifecycle'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {isNotFound} from './paymentCryptographyErrors'
import {setKeyUsage} from './paymentCryptographyLifecycle'
import {deleteKeyPolicy, getKeyPolicy, putKeyPolicy, type KeyPolicyLookup} from './paymentCryptographyPolicies'
import {
    defaultReplicationRegions,
    disableDefaultReplicationRegions,
    enableDefaultReplicationRegions,
    setReplicationRegions,
} from './paymentCryptographyReplication'
import {exportKeyTr31, importKeyTr31, type ExportedKeyMaterial} from './paymentCryptographyTransfer'
import {
    algorithmsForUsage,
    awsPaymentCryptographySchema,
    keyClassForAlgorithm,
<<<<<<< HEAD
<<<<<<< HEAD
=======
    mayWrapWith,
    wrappingAlgorithmsFor,
>>>>>>> d7092c2 (feat(paymentcryptography): the material a key leaves under)
    PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES,
=======
    mayWrapWith,
<<<<<<< HEAD
>>>>>>> b5174b9 (feat(paymentcryptography): the export form offers only the pairings allowed)
=======
    PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES,
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
    PAYMENT_CRYPTOGRAPHY_KEY_ALGORITHMS,
    PAYMENT_CRYPTOGRAPHY_KEY_CLASSES,
    PAYMENT_CRYPTOGRAPHY_KEY_USAGES,
    PAYMENT_CRYPTOGRAPHY_KIND_PREFIX,
    PAYMENT_CRYPTOGRAPHY_KINDS,
    PAYMENT_CRYPTOGRAPHY_MODES_OF_USE,
    PAYMENT_CRYPTOGRAPHY_SOURCES,
    PAYMENT_CRYPTOGRAPHY_USAGE_RULES,
    type ModeCombination,
    type PaymentCryptographyCertificateState,
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

/**
 * The certificate of a key's public half, as the read found it.
 *
 * <p>The state says which of the five there is, so the console never has to
 * work it out for itself. The state, the certificate and the chain are
 * published only where the service answered: absent means it did not, and
 * null means it answered that there is none.
 */
type CertificateLookup = {
    /** The state the certificate is in, where the question was asked of the key. */
    state?: PaymentCryptographyCertificateState
    /** The certificate the service signed, or null for a key that has none. */
    certificate?: string | null
    /** The chain the certificate is signed in, when the service handed one out. */
    chain?: string | null
}

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

    /**
     * The material a key leaves under.
     *
     * <p>The form the console offers is the TR-31 block the service wraps with a
     * key the account holds, which is the form a key usually leaves in.
     *
     * <p>The wrapping key has to be one the reference allows: a key encryption key
     * that may wrap, and at least as strong as the key it carries. The matrix is
     * the reference's own, and it is in one place, so the panel and this agree
     * about it.
     */
    async exportKey(id: string, input: {wrappingKeyArn: string}): Promise<ExportedKeyMaterial> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            throw new ValidationError('an alias is a name for a key; it is the key that leaves')
        }
        // The form names a resource, and the resource id carries its kind, so the
        // prefix is taken off before the runtime is asked about it.
        const wrappingKeyArn = targetKeyArn(requiredString(input?.wrappingKeyArn, 'wrappingKeyArn'))

        // The pairing is checked here as well as by the runtime, so a caller that
        // goes past the form is refused with the reference's own reason.
        const carried = await this.describe(identifier)
        if (!carried) throw new ValidationError(`the key ${identifier} is not there`)
        const wrapping = await this.describe(wrappingKeyArn)
        if (!wrapping) throw new ValidationError(`the wrapping key ${wrappingKeyArn} is not there`)

        const carriedAlgorithm = String(carried.KeyAttributes?.KeyAlgorithm ?? '')
        const wrappingAlgorithm = String(wrapping.KeyAttributes?.KeyAlgorithm ?? '')
        if (!mayWrapWith(carriedAlgorithm, wrappingAlgorithm)) {
            const allowed = wrappingAlgorithmsFor(carriedAlgorithm)
            throw new ValidationError(
                `a ${carriedAlgorithm} key may not be carried by a ${wrappingAlgorithm} key: ` +
                'the wrapping key has to be at least as strong as the key it carries, ' +
                (allowed.length > 0
                    ? `so it may be one of ${allowed.join(', ')}`
                    : 'and the matrix names no key that may carry it'),
            )
        }

        return exportKeyTr31(this.client, identifier, wrappingKeyArn)
    }

    /**
     * The Regions a key is replicated to.
     *
     * <p>The route is the only way in, so this is what decides what the operation
     * does.
     */
    async setReplication(id: string, input: Record<string, unknown>): Promise<void> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            throw new ValidationError('an alias has no settings of its own; the key it names does')
        }
        // The reference's own commands add and remove one Region at a time, so
        // the request says which Region to add and which to remove rather than a
        // set the service has to diff.
        const added = regionList(input?.addReplicationRegions, 'addReplicationRegions')
        const removed = regionList(input?.removeReplicationRegions, 'removeReplicationRegions')
        const key = await this.readKey(identifier)
        // A replica is read-only: the reference says a Replica Region key cannot
        // be configured to replicate to other Regions, so the API refuses what
        // it cannot do rather than sending a request the service would refuse.
        if (key?.MultiRegionKeyType === 'REPLICA') {
            throw new ValidationError(
                'a replica is read-only, so the Regions it is replicated to are those of its primary',
            )
        }
        const primary = key?.PrimaryRegion ?? null
        if (primary && (added.includes(primary) || removed.includes(primary))) {
            // The Region the primary is in is not a replica, and the reference
            // refuses it. It is refused here too, before anything is changed:
            // the Regions that are gone go first, so a request that named the
            // primary would take a replica away and then fail.
            throw new ValidationError(
                `the key is the primary in ${primary}, so it is not replicated to it`,
            )
        }
        const current = key ? replicationRegionsOf(key) : []
        // A Region the key already holds is not added again, and one it does not
        // hold is not taken away.
        const toAdd = added.filter((region) => !current.includes(region))
        const toRemove = removed.filter((region) => current.includes(region))
        // The Regions that are gone go first: a key that replicates to as many
        // Regions as it may would be refused a fifth one, so a Region that is
        // replaced would fail to be replaced.
        if (toRemove.length > 0) {
            await setReplicationRegions(this.client, identifier, toRemove, false)
        }
        if (toAdd.length > 0) {
            await setReplicationRegions(this.client, identifier, toAdd, true)
        }
    }

    /** The key as it answers, which is where the rules of its replication are read from. */
    private async readKey(keyArn: string): Promise<Key | undefined> {
        const res = await this.client.send(new ReadKey({KeyIdentifier: keyArn}))
        return res.Key
    }

    /** The Regions the account replicates a new key to by default. */
    async defaultReplicationRegions(): Promise<string[]> {
        return defaultReplicationRegions(this.client)
    }

    /** Turns the account's default replication on for the Regions named. */
    async enableDefaultReplicationRegions(regions: string[]): Promise<string[]> {
        return enableDefaultReplicationRegions(this.client, regions)
    }

    /** Turns the account's default replication off for the Regions named. */
    async disableDefaultReplicationRegions(regions: string[]): Promise<string[]> {
        return disableDefaultReplicationRegions(this.client, regions)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            const alias = await this.describeAlias(identifier)
            return alias ? toAliasResource(alias) : null
        }
        const key = await this.describe(identifier)
        if (!key) return null
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
        // The tags and the certificate are reads of their own and do not depend on
        // each other, so they are asked together rather than one after the other.
        // Both are addressed by the ARN the key resolved to, because the service
        // takes an ARN and a key may have been asked for by an alias or a short id.
        const arn = key.KeyArn ?? identifier
        const [tags, certificate] = await Promise.all([
            this.getTags(arn),
            this.publicKeyCertificate(arn, key),
        ])
        return toResource(key, tags, certificate)
=======
=======
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
<<<<<<< HEAD
        return toResource(key, await this.getTags(identifier))
=======
        return toResource(
            key,
            await this.getTags(identifier),
            await this.publicKeyCertificate(key),
            await getKeyPolicy(this.client, identifier),
        )
>>>>>>> debf197 (feat(paymentcryptography): the panels a payment key has of its own)
<<<<<<< HEAD
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
=======
=======
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
        // The tags and the certificate are reads of their own and do not depend on
        // each other, so they are asked together rather than one after the other.
        // Both are addressed by the ARN the key resolved to, because the service
        // takes an ARN and a key may have been asked for by an alias or a short id.
        const arn = key.KeyArn ?? identifier
        const [tags, certificate] = await Promise.all([
            this.getTags(arn),
            this.publicKeyCertificate(arn, key),
        ])
        return toResource(key, tags, certificate, await getKeyPolicy(this.client, identifier))
<<<<<<< HEAD
>>>>>>> be82d93 (feat(paymentcryptography): the certificate of a key's public half)
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const source = oneOf(input.values.source, PAYMENT_CRYPTOGRAPHY_SOURCES, 'source', 'keys')
        if (source === 'aliases') {
            return this.createAlias(input)
        }
        if (source === 'import') {
            return this.importKey(input)
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

    /**
     * Whether a key may be used.
     *
     * <p>The route is the only way in, so this is what decides what the operation
     * does.
     */
    async setUsage(id: string, input: Record<string, unknown>): Promise<void> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            throw new ValidationError('an alias has no settings of its own; the key it names does')
        }
        const enabled = input?.enabled
        if (enabled !== 'true' && enabled !== 'false' && enabled !== true && enabled !== false) {
            throw new ValidationError('the enabled member of the request must say whether the key may be used')
        }
        await setKeyUsage(this.client, identifier, enabled === true || enabled === 'true')
    }

    /**
     * The policy that lets another account use a key.
     *
     * <p>The route is the only way in, so this is what decides what the operation
     * does.
     */
    async setPolicy(id: string, input: Record<string, unknown>): Promise<void> {
        const {kind, identifier} = parseId(id)
        if (kind === 'aliases') {
            throw new ValidationError('an alias has no settings of its own; the key it names does')
        }
        const policy = input?.policy
        // A request that says nothing about the policy is a fault of the caller,
        // and it is refused: reading it as a removal would take the policy away
        // from a key that still holds one.
        if (policy === undefined) {
            throw new ValidationError('the request must say what the policy is')
        }
        // An empty policy is the console's way of saying that the policy is gone,
        // so it removes the one the key holds rather than attaching nothing.
        if (policy === null || (typeof policy === 'string' && policy.trim() === '')) {
            await deleteKeyPolicy(this.client, identifier)
            return
        }
        if (typeof policy !== 'string') {
            throw new ValidationError('the policy of the request must be the policy document itself')
        }
        await putKeyPolicy(this.client, identifier, policy)
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

    /**
     * A key comes in under a TR-31 block a key the account holds wraps.
     *
     * <p>The material carries the key's own attributes, so the form asks for the
     * block and the wrapping key and not for the usage and the algorithm.
     */
    private async importKey(input: CreateResourceInput): Promise<CloudResource> {
        const wrappingKeyArn = requiredString(input.values.wrappingKeyArn, 'wrappingKeyArn')
        const wrappedKeyBlock = requiredString(input.values.wrappedKeyBlock, 'wrappedKeyBlock')
        const enabled = booleanValue(input.values.enabled, 'enabled', true)

        const arn = await importKeyTr31(this.client, wrappingKeyArn, wrappedKeyBlock, enabled)
        if (!arn) throw new RuntimeError('Payment Cryptography did not return the key it imported')

        const key = await this.describe(arn)
        if (!key) throw new RuntimeError('Payment Cryptography did not return the key it imported')
        return toResource(key, {tags: []})
    }

    /** An alias points at a key, and the reference refuses one that points at none. */
    private async createAlias(input: CreateResourceInput): Promise<CloudResource> {
        const aliasName = requiredAliasName(input.values.aliasName)
        const targetKey = targetKeyArn(input.values.aliasTargetKey)

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
<<<<<<< HEAD
<<<<<<< HEAD
=======
<<<<<<< HEAD
=======
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
     * The certificate of an asymmetric key, which the reference signs and hands out
     * for the key's public half.
     *
     * <p>A symmetric key has no public half and so no certificate, and the reference
     * refuses the question, so it is only asked of a key that has a pair. The
     * certificate belongs to the key's detail rather than to the table, so it is read
     * when a key is inspected and not for every row.
     *
     * <p>The certificate is enrichment, so a failure degrades the inspector rather
     * than the request, the way the tag lookup does: it is reported as unreadable
     * and the key itself is still shown.
     */
    private async publicKeyCertificate(identifier: string, key: Key): Promise<CertificateLookup> {
        const keyClass = key.KeyAttributes?.KeyClass
        // A key whose class was not read is neither a pair nor a symmetric key, so
        // the question of a certificate was never asked of it.
        if (keyClass === undefined) {
            return {state: PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES.unknown}
        }
        if (keyClass !== PAYMENT_CRYPTOGRAPHY_KEY_CLASSES.pair) {
            return {state: PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES.noPublicHalf}
        }
        try {
            const res = await this.client.send(
                // The certificate is addressed by the key's ARN, which is what the
                // service takes, and a key may have been asked for by an alias or a
                // short id.
                new GetPublicKeyCertificateCommand({KeyIdentifier: key.KeyArn ?? identifier}),
            )
            if (!res.KeyCertificate) {
                // The service answered about the leaf only, so the chain is left
                // absent rather than claimed to be none.
                return {state: PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES.unsigned, certificate: null}
            }
            return {
                state: PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES.signed,
                certificate: res.KeyCertificate,
                // The service hands out the chain with the certificate, so both are
                // published: the leaf alone cannot be verified against anything.
                ...(res.KeyCertificateChain !== undefined ? {chain: res.KeyCertificateChain} : {}),
            }
<<<<<<< HEAD
        } catch (error) {
=======
        } catch {
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
            // The reference gives a refusal one meaning: a denied permission, a
            // throttled service, a key that is gone or a request whose parameters
            // are invalid. The adapter already knows whether the key has a public
            // half, so it never asks the service about a key that has none, and
            // every refusal here is a read that did not come: the console is told
            // which one it was rather than told the service signed no certificate.
            return {state: PAYMENT_CRYPTOGRAPHY_CERTIFICATE_STATES.unreadable}
        }
    }

    /**
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> be82d93 (feat(paymentcryptography): the certificate of a key's public half)
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
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

<<<<<<< HEAD
<<<<<<< HEAD
function toResource(
    key: Key,
    tagLookup: TagLookup,
    // A row of the table, or a key that was just made, has had no certificate
    // read, so it carries no state at all.
    certificateLookup: CertificateLookup = {},
): CloudResource {
=======
<<<<<<< HEAD
function toResource(key: Key, tagLookup: TagLookup): CloudResource {
=======
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
function toResource(
    key: Key,
    tagLookup: TagLookup,
    // A row of the table, or a key that was just made, has had no certificate
    // read, so it carries no state at all.
    certificateLookup: CertificateLookup = {},
    policyLookup?: KeyPolicyLookup,
): CloudResource {
<<<<<<< HEAD
>>>>>>> debf197 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
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
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
            // The certificate is published only where it was read, so a row that
            // was never inspected does not claim that the key has none. The
            // state says which of the five it is, so the console does not have
            // to work it out from the key's class, and it is published only
            // where the question was asked, so it never contradicts the key
            // class above.
            ...(certificateLookup.certificate !== undefined
                ? {publicKeyCertificate: certificateLookup.certificate}
                : {}),
            ...(certificateLookup.chain !== undefined
                ? {publicKeyCertificateChain: certificateLookup.chain}
                : {}),
            ...(certificateLookup.state !== undefined
                ? {publicKeyCertificateState: certificateLookup.state}
                : {}),
=======
=======
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
<<<<<<< HEAD
=======
            publicKeyCertificate,
=======
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
            // The certificate is published only where it was read, so a row that
            // was never inspected does not claim that the key has none. The
            // state says which of the five it is, so the console does not have
            // to work it out from the key's class, and it is published only
            // where the question was asked, so it never contradicts the key
            // class above.
            ...(certificateLookup.certificate !== undefined
                ? {publicKeyCertificate: certificateLookup.certificate}
                : {}),
            ...(certificateLookup.chain !== undefined
                ? {publicKeyCertificateChain: certificateLookup.chain}
                : {}),
            ...(certificateLookup.state !== undefined
                ? {publicKeyCertificateState: certificateLookup.state}
                : {}),
            ...policyMetadata(policyLookup),
            replicationRegions: replicationRegionsOf(key),
            usingDefaultReplicationRegions: key.UsingDefaultReplicationRegions,
<<<<<<< HEAD
>>>>>>> debf197 (feat(paymentcryptography): the panels a payment key has of its own)
>>>>>>> 3a8a552 (feat(paymentcryptography): the panels a payment key has of its own)
=======
>>>>>>> 2fb3a61 (fix(console): the shared surface is main's, the panels are the branch's own)
            tags: tagLookup.tags,
            ...(tagLookup.unavailable ? {tagsUnavailable: true} : {}),
        },
    }
}

/**
 * The policy of a key, as the metadata carries it.
 *
 * <p>The policy is published only where it was read: a row of the table carries
 * none, because it never read one. A read that failed is said so, so it cannot
 * pass for a key that holds none.
 */
function policyMetadata(policyLookup: KeyPolicyLookup | undefined): Record<string, unknown> {
    if (!policyLookup) return {}
    if (policyLookup.unavailable) return {keyPolicyUnavailable: true}
    return {keyPolicy: policyLookup.policy}
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

/**
 * The key an alias points at.
 *
 * <p>The form offers the keys the account holds, by the id the console knows them
 * by, and an ARN is accepted as well for a caller that has one. The reference names
 * a key that exists, so the alias never names one that is not there yet.
 */
function targetKeyArn(value: unknown): string {
    const raw = requiredString(value, 'aliasTargetKey')
    const prefix = `${PAYMENT_CRYPTOGRAPHY_KIND_PREFIX.keys}/`
    return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

/**
 * The name the reference gives an alias, which carries the `alias/` prefix.
 *
 * <p>parseId removes exactly one prefix, and the name may itself begin with one
 * (`alias/alias/foo` is the alias named `alias/foo`), so the one removed is always
 * restored rather than guessed from what the identifier starts with.
 */
function aliasNameOf(identifier: string): string {
    return `${ALIAS_PREFIX}${identifier}`
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

/**
 * The Regions a key is replicated to, as the key answers them.
 *
 * <p>The status holds the Regions the key is replicated to, and the Region the
 * primary is in is not one of them. It is named apart, and a runtime that
 * answered with it in the status would have it taken away, which the reference
 * refuses.
 */
function replicationRegionsOf(key: Key): string[] {
    const status = key.ReplicationStatus
    if (!status) return []
    return Object.keys(status).filter((region) => region !== key.PrimaryRegion)
}

function regionList(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some((region) => typeof region !== 'string')) {
        throw new ValidationError(`the ${field} of the request must be a list of Region names`)
    }
    return value as string[]
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
