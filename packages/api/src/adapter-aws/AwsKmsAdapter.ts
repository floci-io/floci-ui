import {
    CreateKeyCommand,
    DecryptCommand,
    DescribeKeyCommand,
    EncryptCommand,
    type KeyMetadata,
    type KMSClient,
    ListKeysCommand,
    ListResourceTagsCommand,
    ScheduleKeyDeletionCommand,
    TagResourceCommand,
    UntagResourceCommand,
} from '@aws-sdk/client-kms'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    awsKmsSchema,
    KMS_DESCRIPTION_MAX_LENGTH,
    KMS_KEY_SPECS,
    KMS_KEY_USAGES,
    KMS_SPECS_BY_USAGE,
} from '../cloud-spi/kmsSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    KmsDecryptInput,
    KmsDecryptResult,
    KmsEncryptInput,
    KmsEncryptionAlgorithm,
    KmsEncryptResult,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

type KeyTag = {key: string; value: string}

/** Tags plus whether the lookup itself failed, so the two stay distinguishable. */
type TagLookup = {tags: KeyTag[]; unavailable?: true}

/**
 * The shortest deletion window KMS accepts. Deletion is irreversible once it
 * completes, so the console never offers a longer wait than it has to — but it
 * also cannot delete immediately, which is why `delete` schedules.
 */
const PENDING_DELETION_WINDOW_DAYS = 7
const SYMMETRIC_PLAINTEXT_MAX_BYTES = 4_096
const DECRYPT_CIPHERTEXT_MAX_BYTES = 6_144

const RSA_PLAINTEXT_MAX_BYTES = {
    RSA_2048: {
        RSAES_OAEP_SHA_1: 214,
        RSAES_OAEP_SHA_256: 190,
    },
    RSA_4096: {
        RSAES_OAEP_SHA_1: 470,
        RSAES_OAEP_SHA_256: 446,
    },
} as const

export class AwsKmsAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'kms' as const

    constructor(private readonly kms: KMSClient) {}

    schema(): ServiceSchema {
        return awsKmsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const ids = await this.listKeyIds()
        const resources = await Promise.all(ids.map((id) => this.describe(id)))
        return filterBySearch(resources.filter((resource): resource is CloudResource => resource !== null), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        return this.describe(id)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const description = optionalString(input.values.description, 'description')
        if (description && description.length > KMS_DESCRIPTION_MAX_LENGTH) {
            throw new ValidationError(`description must be ${KMS_DESCRIPTION_MAX_LENGTH} characters or fewer`)
        }

        const keyUsage = oneOf(input.values.keyUsage, KMS_KEY_USAGES, 'keyUsage')
        const keySpec = keySpecFor(keyUsage, input.values.keySpec)

        const res = await this.kms.send(
            new CreateKeyCommand({
                ...(description ? {Description: description} : {}),
                KeyUsage: keyUsage,
                KeySpec: keySpec,
            }),
        )
        if (!res.KeyMetadata) throw new ValidationError('KMS did not return metadata for the created key')

        // A brand new key has no tags, so this skips the ListResourceTags call.
        return toResource(res.KeyMetadata, {tags: []})
    }

    /**
     * KMS has no immediate delete: the key enters PendingDeletion and is destroyed
     * when the window elapses. It keeps appearing in `list()` until then, which is
     * the runtime's behaviour and not something to hide.
     */
    async delete(id: string): Promise<void> {
        await this.kms.send(
            new ScheduleKeyDeletionCommand({KeyId: id, PendingWindowInDays: PENDING_DELETION_WINDOW_DAYS}),
        )
    }

    async updateTags(id: string, tags: Record<string, string | null>): Promise<void> {
        const added = Object.entries(tags).filter((entry): entry is [string, string] => entry[1] !== null)
        const removed = Object.keys(tags).filter((key) => tags[key] === null)

        if (added.length > 0) {
            await this.kms.send(
                new TagResourceCommand({
                    KeyId: id,
                    Tags: added.map(([key, value]) => ({TagKey: key, TagValue: value})),
                }),
            )
        }
        if (removed.length > 0) {
            await this.kms.send(new UntagResourceCommand({KeyId: id, TagKeys: removed}))
        }
    }

    async encrypt(id: string, input: KmsEncryptInput): Promise<KmsEncryptResult> {
        const metadata = await this.describeForCrypto(id)
        validateCryptoKey(metadata, input.encryptionAlgorithm, input.encryptionContext)
        validatePlaintextSize(metadata, input.plaintext, input.encryptionAlgorithm)

        const res = await this.kms.send(
            new EncryptCommand({
                KeyId: id,
                Plaintext: input.plaintext,
                EncryptionAlgorithm: input.encryptionAlgorithm,
                ...(input.encryptionContext ? {EncryptionContext: input.encryptionContext} : {}),
            }),
        )
        if (!res.CiphertextBlob) throw new RuntimeError('KMS did not return ciphertext')

        return {
            ciphertextBlob: res.CiphertextBlob,
            keyId: res.KeyId ?? id,
            encryptionAlgorithm: responseAlgorithm(res.EncryptionAlgorithm, input.encryptionAlgorithm),
        }
    }

    async decrypt(id: string, input: KmsDecryptInput): Promise<KmsDecryptResult> {
        const metadata = await this.describeForCrypto(id)
        validateCryptoKey(metadata, input.encryptionAlgorithm, input.encryptionContext)
        if (input.ciphertextBlob.byteLength === 0) throw new ValidationError('ciphertextBlobBase64 must not be empty')
        if (input.ciphertextBlob.byteLength > DECRYPT_CIPHERTEXT_MAX_BYTES) {
            throw new ValidationError(`ciphertextBlobBase64 must decode to ${DECRYPT_CIPHERTEXT_MAX_BYTES} bytes or fewer`)
        }

        const res = await this.kms.send(
            new DecryptCommand({
                KeyId: id,
                CiphertextBlob: input.ciphertextBlob,
                EncryptionAlgorithm: input.encryptionAlgorithm,
                ...(input.encryptionContext ? {EncryptionContext: input.encryptionContext} : {}),
            }),
        )
        if (!res.Plaintext) throw new RuntimeError('KMS did not return plaintext')

        return {
            plaintext: res.Plaintext,
            keyId: res.KeyId ?? id,
            encryptionAlgorithm: responseAlgorithm(res.EncryptionAlgorithm, input.encryptionAlgorithm),
        }
    }

    /** ListKeys pages at 100 keys, so an account past that would silently truncate. */
    private async listKeyIds(): Promise<string[]> {
        const ids: string[] = []
        let marker: string | undefined

        do {
            const res = await this.kms.send(new ListKeysCommand(marker ? {Marker: marker} : {}))
            for (const key of res.Keys ?? []) {
                if (key.KeyId) ids.push(key.KeyId)
            }
            marker = res.Truncated ? res.NextMarker : undefined
        } while (marker)

        return ids
    }

    /** Crypto actions need key metadata but not the extra tag lookup used by get(). */
    private async describeForCrypto(id: string): Promise<KeyMetadata> {
        const res = await this.kms.send(new DescribeKeyCommand({KeyId: id}))
        if (!res.KeyMetadata) throw new RuntimeError('KMS did not return key metadata')
        return res.KeyMetadata
    }

    /**
     * ListKeys returns only an id and an ARN, so every column the table shows
     * comes from this per-key DescribeKey call.
     */
    private async describe(id: string): Promise<CloudResource | null> {
        try {
            const res = await this.kms.send(new DescribeKeyCommand({KeyId: id}))
            if (!res.KeyMetadata) return null
            return toResource(res.KeyMetadata, await this.getTags(id))
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    /**
     * Paged like ListKeys, so a heavily tagged key would otherwise be truncated.
     *
     * Tags are enrichment, so a failure degrades the row rather than the request:
     * `list` builds every row through `Promise.all`, so an unisolated throttle
     * would reject the whole view. Isolating it here also stops a tag 404 — a key
     * deleted mid-list — from reaching `describe`'s catch and silently dropping
     * the key. The failure is reported rather than swallowed, so an untagged key
     * and an unreadable one stay distinguishable.
     */
    private async getTags(id: string): Promise<TagLookup> {
        const tags: KeyTag[] = []
        let marker: string | undefined

        try {
            do {
                const res = await this.kms.send(
                    new ListResourceTagsCommand({KeyId: id, ...(marker ? {Marker: marker} : {})}),
                )
                for (const tag of res.Tags ?? []) {
                    tags.push({key: tag.TagKey ?? '', value: tag.TagValue ?? ''})
                }
                marker = res.Truncated ? res.NextMarker : undefined
            } while (marker)
        } catch {
            // Keep whatever pages already arrived rather than discarding them.
            return {tags, unavailable: true}
        }

        return {tags}
    }
}

function validateCryptoKey(
    metadata: KeyMetadata,
    algorithm: KmsEncryptionAlgorithm,
    encryptionContext: Record<string, string> | undefined,
): void {
    if (metadata.KeyUsage !== 'ENCRYPT_DECRYPT') {
        throw new ValidationError('Selected key does not support encryption and decryption')
    }
    if (metadata.Enabled !== true || metadata.KeyState !== 'Enabled') {
        throw new ValidationError('Selected key must be enabled')
    }

    const keySpec = metadata.KeySpec ?? metadata.CustomerMasterKeySpec
    if (keySpec === 'SYMMETRIC_DEFAULT') {
        if (algorithm !== 'SYMMETRIC_DEFAULT') {
            throw new ValidationError('Symmetric keys require SYMMETRIC_DEFAULT')
        }
        return
    }

    if (keySpec !== 'RSA_2048' && keySpec !== 'RSA_4096') {
        throw new ValidationError('Selected key spec does not support encryption and decryption')
    }
    if (algorithm !== 'RSAES_OAEP_SHA_1' && algorithm !== 'RSAES_OAEP_SHA_256') {
        throw new ValidationError('RSA keys require an RSAES_OAEP encryption algorithm')
    }
    if (encryptionContext && Object.keys(encryptionContext).length > 0) {
        throw new ValidationError('RSA keys do not support encryptionContext')
    }
}

function validatePlaintextSize(
    metadata: KeyMetadata,
    plaintext: Uint8Array,
    algorithm: KmsEncryptionAlgorithm,
): void {
    if (plaintext.byteLength === 0) throw new ValidationError('plaintextBase64 must not be empty')

    const keySpec = metadata.KeySpec ?? metadata.CustomerMasterKeySpec
    if (keySpec === 'SYMMETRIC_DEFAULT') {
        if (plaintext.byteLength > SYMMETRIC_PLAINTEXT_MAX_BYTES) {
            throw new ValidationError(`plaintextBase64 must decode to ${SYMMETRIC_PLAINTEXT_MAX_BYTES} bytes or fewer`)
        }
        return
    }

    if (keySpec !== 'RSA_2048' && keySpec !== 'RSA_4096') return
    if (algorithm !== 'RSAES_OAEP_SHA_1' && algorithm !== 'RSAES_OAEP_SHA_256') return

    const limit = RSA_PLAINTEXT_MAX_BYTES[keySpec][algorithm]
    if (plaintext.byteLength > limit) {
        throw new ValidationError(`plaintextBase64 must decode to ${limit} bytes or fewer for ${keySpec}/${algorithm}`)
    }
}

function responseAlgorithm(
    value: string | undefined,
    fallback: KmsEncryptionAlgorithm,
): KmsEncryptionAlgorithm {
    if (value === undefined) return fallback
    if (value === 'SYMMETRIC_DEFAULT' || value === 'RSAES_OAEP_SHA_1' || value === 'RSAES_OAEP_SHA_256') {
        return value
    }
    throw new RuntimeError('KMS returned an unsupported encryption algorithm')
}

function toResource(metadata: KeyMetadata, tagLookup: TagLookup): CloudResource {
    const id = metadata.KeyId ?? ''

    return {
        id,
        // KMS keys have no name field; the uuid is the identity.
        name: id,
        cloud: 'aws',
        service: 'kms',
        type: 'key',
        region: regionFromArn(metadata.Arn),
        createdAt: metadata.CreationDate ? metadata.CreationDate.toISOString() : null,
        status: metadata.KeyState ?? null,
        metadata: {
            arn: metadata.Arn,
            accountId: metadata.AWSAccountId,
            description: metadata.Description,
            keyUsage: metadata.KeyUsage,
            keySpec: metadata.KeySpec,
            keyManager: metadata.KeyManager,
            origin: metadata.Origin,
            enabled: metadata.Enabled,
            deletionDate: metadata.DeletionDate ? metadata.DeletionDate.toISOString() : null,
            encryptionAlgorithms: metadata.EncryptionAlgorithms,
            signingAlgorithms: metadata.SigningAlgorithms,
            multiRegion: metadata.MultiRegion,
            tags: tagLookup.tags,
            ...(tagLookup.unavailable ? {tagsUnavailable: true} : {}),
        },
    }
}

/** `arn:aws:kms:us-east-1:000000000000:key/<uuid>` — the region is the 4th field. */
function regionFromArn(arn: string | undefined): string | null {
    return arn?.split(':')[3] || null
}

/** Matches on the id and the description, because the id alone is an opaque uuid. */
function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter((resource) => {
        const description = String(resource.metadata.description ?? '').toLowerCase()
        return resource.name.toLowerCase().includes(normalized) || description.includes(normalized)
    })
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value
}

/**
 * Resolve the key spec for a usage, defaulting to the first spec that usage
 * supports rather than to a fixed symmetric default.
 *
 * A fixed default would pair SIGN_VERIFY with SYMMETRIC_DEFAULT, which real KMS
 * rejects — and the local runtime accepts, so the failure would only appear
 * against a real provider.
 */
function keySpecFor(keyUsage: (typeof KMS_KEY_USAGES)[number], raw: unknown): (typeof KMS_KEY_SPECS)[number] {
    const allowed = KMS_SPECS_BY_USAGE[keyUsage]
    const requested = oneOf(raw, KMS_KEY_SPECS, 'keySpec', allowed[0])

    if (!(allowed as readonly string[]).includes(requested)) {
        throw new ValidationError(
            `keySpec ${requested} is not valid for keyUsage ${keyUsage}; use one of ${allowed.join(', ')}`,
        )
    }
    return requested
}

/**
 * Keeps create honest about the schema: a value the form never offers would be
 * rejected by KMS anyway, and failing here gives a typed error instead of a 400.
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
 * KMS is one of the AWS services that does not use 404 for not-found: real KMS
 * answers `NotFoundException` with HTTP **400**. The local runtime happens to
 * send 404, so a status-only check passes every test here and would start
 * throwing 502s the moment the runtime tightened to the real contract — the same
 * shape of bug as matching a wire code the SDK never produces. Match the name
 * first and keep the status as a fallback for the emulator.
 */
function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    if ((error as {name?: string}).name === 'NotFoundException') return true
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === 404
}
