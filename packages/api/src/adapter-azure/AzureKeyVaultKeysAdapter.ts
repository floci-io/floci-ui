import {azure, type AzureRuntimeClient} from '../azure'
import {ConflictError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    AZURE_KEY_NAME_MESSAGE,
    AZURE_KEY_NAME_PATTERN,
    AZURE_KEY_SHAPES,
    AZURE_KEY_STATES,
    azureKmsSchema,
    type AzureKeyShapeName,
} from '../cloud-spi/kmsSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    KmsDecryptInput,
    KmsDecryptResult,
    KmsEncryptInput,
    KmsEncryptResult,
    KmsEncryptionAlgorithm,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const API_VERSION = '7.4'
const PLAINTEXT_MAX_BYTES = 4096
// Floci-AZ returns a 96-bit nonce and a 128-bit tag for AES-GCM, the sizes Key Vault documents.
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16

const RSA_ALGORITHM: Partial<Record<KmsEncryptionAlgorithm, string>> = {
    RSAES_OAEP_SHA_1: 'RSA-OAEP',
    RSAES_OAEP_SHA_256: 'RSA-OAEP-256',
}

type KeyState = (typeof AZURE_KEY_STATES)[number]

interface KeyVaultKeyBundle {
    kid?: string
    kty?: string
    key_size?: number
    crv?: string
    key_ops?: string[]
}

interface KeyVaultKeyRecord {
    key?: KeyVaultKeyBundle
    // List entries carry the identifier at the top level instead of inside `key`.
    kid?: string
    attributes?: {
        enabled?: boolean
        created?: number
        updated?: number
        exp?: number | null
        nbf?: number | null
        recoveryLevel?: string
        recoverableDays?: number
    }
    tags?: Record<string, string>
    recoveryId?: string
    deletedDate?: number
    scheduledPurgeDate?: number
}

interface KeyVaultListResponse {
    value?: KeyVaultKeyRecord[]
    nextLink?: string | null
}

interface KeyVaultCryptoResult {
    value?: string
    iv?: string
    tag?: string
}

export class AzureKeyVaultKeysAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'kms' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureKmsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const state = keyState(query.filters?.state)
        const collection = state === 'deleted' ? 'deletedkeys' : 'keys'
        const records = await this.listAll(`/${collection}?api-version=${API_VERSION}`)

        return filterBySearch(records.map((record) => toKeyResource(record, '', state)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const body = await this.keyVaultJson<KeyVaultKeyRecord>(
            `/keys/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        if (!body) return this.getDeleted(id)

        const resource = toKeyResource(body, id)
        const records = await this.listAll(`/keys/${encodeURIComponent(id)}/versions?api-version=${API_VERSION}`)
        resource.metadata.versions = sortVersions(records.map((record) => toVersionEntry(record, resource.version ?? null)))
        return resource
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const keyName = stringValue(input.values.keyName ?? input.values.name)
        const shapeName = stringValue(input.values.keyShape) || 'RSA_2048'

        if (!keyName) throw new ValidationError('keyName is required')
        if (!new RegExp(AZURE_KEY_NAME_PATTERN).test(keyName)) throw new ValidationError(AZURE_KEY_NAME_MESSAGE)
        if (!Object.hasOwn(AZURE_KEY_SHAPES, shapeName)) {
            throw new ValidationError(`keyShape must be one of: ${Object.keys(AZURE_KEY_SHAPES).join(', ')}`)
        }
        const shape: {kty: string; keySize?: number; curve?: string} = AZURE_KEY_SHAPES[shapeName as AzureKeyShapeName]

        const body = await this.keyVaultJson<KeyVaultKeyRecord>(
            `/keys/${encodeURIComponent(keyName)}/create?api-version=${API_VERSION}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    kty: shape.kty,
                    ...(shape.keySize ? {key_size: shape.keySize} : {}),
                    ...(shape.curve ? {crv: shape.curve} : {}),
                }),
            },
        )

        if (!body) throw new RuntimeError('Azure Key Vault create returned an empty response')
        return toKeyResource(body, keyName)
    }

    // Key Vault delete is a soft-delete: the key moves to the deleted namespace until it is recovered or purged.
    async delete(id: string): Promise<void> {
        await this.keyVaultJson(`/keys/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {method: 'DELETE'})
    }

    async recover(id: string): Promise<CloudResource> {
        const body = await this.keyVaultJson<KeyVaultKeyRecord>(
            `/deletedkeys/${encodeURIComponent(id)}/recover?api-version=${API_VERSION}`,
            {method: 'POST'},
        )

        if (!body) throw new RuntimeError('Azure Key Vault recover returned an empty response')
        return toKeyResource(body, id)
    }

    async purgeDeleted(id: string): Promise<void> {
        await this.keyVaultJson(`/deletedkeys/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {method: 'DELETE'})
    }

    async rotate(id: string): Promise<CloudResource> {
        const body = await this.keyVaultJson<KeyVaultKeyRecord>(
            `/keys/${encodeURIComponent(id)}/rotate?api-version=${API_VERSION}`,
            {method: 'POST'},
        )

        if (!body) throw new RuntimeError('Azure Key Vault rotate returned an empty response')
        return toKeyResource(body, id)
    }

    async encrypt(id: string, input: KmsEncryptInput): Promise<KmsEncryptResult> {
        const key = await this.requireCryptoKey(id, input.encryptionAlgorithm, input.encryptionContext)
        if (input.plaintext.byteLength === 0) throw new ValidationError('plaintextBase64 must not be empty')
        if (input.plaintext.byteLength > PLAINTEXT_MAX_BYTES) {
            throw new ValidationError(`plaintextBase64 must decode to ${PLAINTEXT_MAX_BYTES} bytes or fewer`)
        }

        const algorithm = azureAlgorithm(key, input.encryptionAlgorithm)
        const res = await this.keyVaultJson<KeyVaultCryptoResult>(
            `/keys/${encodeURIComponent(id)}/encrypt?api-version=${API_VERSION}`,
            {method: 'POST', body: JSON.stringify({alg: algorithm, value: toBase64Url(input.plaintext)})},
        )
        if (!res?.value) throw new RuntimeError('Azure Key Vault did not return ciphertext')

        // AES-GCM needs its nonce and tag to decrypt, and the console round-trips one opaque blob.
        const ciphertext = fromBase64Url(res.value)
        const blob = key.kty === 'oct'
            ? concat(fromBase64Url(res.iv ?? ''), ciphertext, fromBase64Url(res.tag ?? ''))
            : ciphertext

        return {ciphertextBlob: blob, keyId: id, encryptionAlgorithm: input.encryptionAlgorithm}
    }

    async decrypt(id: string, input: KmsDecryptInput): Promise<KmsDecryptResult> {
        const key = await this.requireCryptoKey(id, input.encryptionAlgorithm, input.encryptionContext)
        if (input.ciphertextBlob.byteLength === 0) throw new ValidationError('ciphertextBlobBase64 must not be empty')

        const algorithm = azureAlgorithm(key, input.encryptionAlgorithm)
        const body: Record<string, string> = {alg: algorithm}
        if (key.kty === 'oct') {
            const blob = input.ciphertextBlob
            if (blob.byteLength <= GCM_IV_BYTES + GCM_TAG_BYTES) {
                throw new ValidationError('ciphertextBlobBase64 is not a ciphertext produced by this console')
            }
            body.iv = toBase64Url(blob.subarray(0, GCM_IV_BYTES))
            body.value = toBase64Url(blob.subarray(GCM_IV_BYTES, blob.byteLength - GCM_TAG_BYTES))
            body.tag = toBase64Url(blob.subarray(blob.byteLength - GCM_TAG_BYTES))
        } else {
            body.value = toBase64Url(input.ciphertextBlob)
        }

        const res = await this.decryptWithFallback(id, key, body)
        if (typeof res?.value !== 'string') throw new RuntimeError('Azure Key Vault did not return plaintext')

        return {plaintext: fromBase64Url(res.value), keyId: id, encryptionAlgorithm: input.encryptionAlgorithm}
    }

    // The ciphertext does not say which version produced it, so after a rotation try the
    // current version first and then the older ones, newest first, until one decrypts.
    private async decryptWithFallback(
        id: string,
        key: KeyVaultKeyBundle,
        body: Record<string, string>,
    ): Promise<KeyVaultCryptoResult | null> {
        const decryptAt = (version?: string) => this.keyVaultJson<KeyVaultCryptoResult>(
            `/keys/${encodeURIComponent(id)}${version ? `/${encodeURIComponent(version)}` : ''}/decrypt?api-version=${API_VERSION}`,
            {method: 'POST', body: JSON.stringify(body)},
        )

        try {
            return await decryptAt()
        } catch (err) {
            if (!(err instanceof ValidationError)) throw err

            const current = parseKeyId(key.kid).version
            const records = await this.listAll(`/keys/${encodeURIComponent(id)}/versions?api-version=${API_VERSION}`)
            const older = sortVersions(records.map((record) => ({
                version: parseKeyId(record.kid).version,
                createdAt: epochDate(record.attributes?.created),
            })))
                .map((entry) => entry.version)
                .filter((version): version is string => !!version && version !== current)

            for (const version of older) {
                try {
                    return await decryptAt(version)
                } catch (fallbackErr) {
                    if (!(fallbackErr instanceof ValidationError)) throw fallbackErr
                }
            }
            throw err
        }
    }

    private async requireCryptoKey(
        id: string,
        algorithm: KmsEncryptionAlgorithm,
        context: Record<string, string> | undefined,
    ): Promise<KeyVaultKeyBundle> {
        if (context && Object.keys(context).length > 0) {
            throw new ValidationError('Key Vault keys do not support an encryption context')
        }

        const body = await this.keyVaultJson<KeyVaultKeyRecord>(
            `/keys/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        if (!body?.key) throw new NotFoundError(`Key ${id} was not found`)
        if (body.attributes?.enabled === false) throw new ConflictError(`Key ${id} is disabled`)

        azureAlgorithm(body.key, algorithm)
        return body.key
    }

    private async getDeleted(id: string): Promise<CloudResource | null> {
        const body = await this.keyVaultJson<KeyVaultKeyRecord>(
            `/deletedkeys/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        return body ? toKeyResource(body, id, 'deleted') : null
    }

    private async listAll(firstPath: string): Promise<KeyVaultKeyRecord[]> {
        const records: KeyVaultKeyRecord[] = []
        const visited = new Set<string>()
        let path: string | null = firstPath

        // A runtime that echoes the current page as its own nextLink would otherwise
        // loop forever, so stop as soon as a page repeats.
        while (path && !visited.has(path)) {
            visited.add(path)
            const body: KeyVaultListResponse | null = await this.keyVaultJson<KeyVaultListResponse>(
                path,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            records.push(...(body?.value ?? []))
            path = body?.nextLink ? keyVaultNextPath(body.nextLink) : null
        }

        return records
    }

    private async keyVaultJson<T>(
        path: string,
        init: RequestInit,
        options?: {emptyOnNotFound?: boolean},
    ): Promise<T | null> {
        const res = await this.client.fetch(
            `/${encodeURIComponent(this.client.accountName)}-keyvault${path}`,
            {
                ...init,
                headers: {
                    accept: 'application/json',
                    authorization: 'Bearer floci-ui',
                    'content-type': 'application/json',
                    ...(init.headers ?? {}),
                },
            },
            {...options, includeStorageApiVersion: false},
        )

        if (!res || res.status === 204) return null
        const text = await res.text()
        return text ? JSON.parse(text) as T : null
    }
}

// Which Key Vault algorithm a console algorithm means for this key, or why it cannot be used.
function azureAlgorithm(key: KeyVaultKeyBundle, algorithm: KmsEncryptionAlgorithm): string {
    if (key.kty === 'RSA') {
        const mapped = RSA_ALGORITHM[algorithm]
        if (!mapped) throw new ValidationError('An RSA key needs RSAES_OAEP_SHA_1 or RSAES_OAEP_SHA_256')
        return mapped
    }
    if (key.kty === 'oct') {
        if (algorithm !== 'SYMMETRIC_DEFAULT') throw new ValidationError('An AES key needs SYMMETRIC_DEFAULT')
        return `A${key.key_size ?? 256}GCM`
    }
    throw new ValidationError(`A ${key.kty ?? 'this'} key cannot encrypt or decrypt`)
}

function keyVaultNextPath(nextLink: string): string {
    try {
        const url = new URL(nextLink)
        return `${url.pathname}${url.search}`
    } catch {
        return nextLink.startsWith('/') ? nextLink : `/${nextLink}`
    }
}

function toKeyResource(record: KeyVaultKeyRecord, fallbackName = '', state: KeyState = 'active'): CloudResource {
    const bundle = record.key ?? {}
    const parsed = parseKeyId(bundle.kid ?? record.kid)
    const name = parsed.name || fallbackName
    const attributes = record.attributes ?? {}
    const shape = describeShape(bundle)

    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'kms',
        type: 'key',
        region: null,
        createdAt: epochDate(attributes.created),
        status: state === 'deleted' ? 'deleted' : attributes.enabled === false ? 'disabled' : 'enabled',
        version: parsed.version,
        metadata: {
            provider: 'azure',
            keyType: bundle.kty ?? null,
            keyShapeLabel: shape.label,
            // The console's shared crypto fields, in the vocabulary KmsCryptoPanel reads.
            keyUsage: shape.usage,
            keySpec: shape.spec,
            keyOps: bundle.key_ops ?? [],
            encryptionContextSupported: false,
            enabled: attributes.enabled !== false,
            updatedAt: epochDate(attributes.updated),
            expiresAt: epochDate(attributes.exp),
            notBefore: epochDate(attributes.nbf),
            recoveryLevel: attributes.recoveryLevel,
            recoverableDays: attributes.recoverableDays,
            tags: Object.entries(record.tags ?? {}).map(([key, value]) => ({key, value})),
            ...(state === 'deleted'
                ? {deletedAt: epochDate(record.deletedDate), scheduledPurgeAt: epochDate(record.scheduledPurgeDate)}
                : {}),
        },
    }
}

function describeShape(bundle: KeyVaultKeyBundle): {label: string | null; usage: string | null; spec: string | null} {
    if (bundle.kty === 'RSA') {
        return {label: `RSA ${bundle.key_size}`, usage: 'ENCRYPT_DECRYPT', spec: `RSA_${bundle.key_size}`}
    }
    if (bundle.kty === 'oct') {
        return {label: `AES ${bundle.key_size}`, usage: 'ENCRYPT_DECRYPT', spec: 'SYMMETRIC_DEFAULT'}
    }
    if (bundle.kty === 'EC') {
        return {label: `EC ${bundle.crv}`, usage: 'SIGN_VERIFY', spec: `ECC_NIST_${(bundle.crv ?? '').replace('-', '')}`}
    }
    return {label: null, usage: null, spec: null}
}

function toVersionEntry(record: KeyVaultKeyRecord, current: string | null) {
    const version = parseKeyId(record.kid ?? record.key?.kid).version
    const attributes = record.attributes ?? {}

    return {
        version,
        enabled: attributes.enabled !== false,
        createdAt: epochDate(attributes.created),
        updatedAt: epochDate(attributes.updated),
        expiresAt: epochDate(attributes.exp),
        notBefore: epochDate(attributes.nbf),
        current: current === null ? null : version === current,
    }
}

// Key Vault does not document an order for the versions list, so show the newest
// first by creation time and keep the runtime's order for versions created in the same second.
function sortVersions<T extends {createdAt: string | null}>(entries: T[]): T[] {
    return entries
        .map((entry, index) => ({entry, index}))
        .sort((a, b) => (b.entry.createdAt ?? '').localeCompare(a.entry.createdAt ?? '') || a.index - b.index)
        .map(({entry}) => entry)
}

function keyState(value: string | undefined): KeyState {
    if (!value) return 'active'
    if ((AZURE_KEY_STATES as readonly string[]).includes(value)) return value as KeyState
    throw new ValidationError(`state must be one of: ${AZURE_KEY_STATES.join(', ')}`)
}

function parseKeyId(id?: string): {name: string; version: string | null} {
    if (!id) return {name: '', version: null}
    // Ids are <host>/keys/<name>/<version>; read by position because a key may be named "keys".
    const [, name, version] = (id.includes('://') ? new URL(id).pathname : id).split('/').filter(Boolean)
    return {
        name: name ? decodeURIComponent(name) : '',
        version: version ? decodeURIComponent(version) : null,
    }
}

function epochDate(value?: number | null): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return new Date(value * 1000).toISOString()
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

// Key Vault carries binary values as base64url without padding.
function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url')
}

function fromBase64Url(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, 'base64url'))
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.byteLength
    }
    return out
}
