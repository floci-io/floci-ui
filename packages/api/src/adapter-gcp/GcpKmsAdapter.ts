import {NotFoundError, NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    GCP_KMS_ID_MESSAGE,
    GCP_KMS_ID_PATTERN,
    GCP_KMS_RESOURCE_TYPES,
    gcpKmsSchema,
} from '../cloud-spi/kmsSchema'
import {mapWithLimit} from '../concurrency'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    KmsDecryptInput,
    KmsDecryptResult,
    KmsEncryptInput,
    KmsEncryptResult,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Cloud KMS through the Floci-GCP emulator, which serves the public
 * `cloudkms.googleapis.com` v1 REST paths. Verified against the floci-gcp
 * nightly image.
 *
 *   GET  /v1/projects/{p}/locations/{l}/keyRings
 *   POST /v1/projects/{p}/locations/{l}/keyRings?keyRingId={id}
 *   GET  /v1/projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys
 *   POST /v1/projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys?cryptoKeyId={id}
 *   GET  /v1/projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys/{k}/cryptoKeyVersions
 *   POST /v1/projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys/{k}:encrypt
 *   POST /v1/projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys/{k}:decrypt
 *
 * A key ring has the id `ring`, a key `ring/key`: a key is only addressable
 * through its ring. Only the configured location is read. Cloud KMS has no
 * delete for either resource, so none is offered.
 *
 * Plaintext and ciphertext only ever pass through `encrypt` and `decrypt`; they
 * are never kept on a resource and never put in an error message.
 */

const SYMMETRIC_PURPOSE = 'ENCRYPT_DECRYPT'
const SYMMETRIC_ALGORITHM = 'GOOGLE_SYMMETRIC_ENCRYPTION'
const JSON_HEADERS = {'content-type': 'application/json'}
const ID_PATTERN = new RegExp(GCP_KMS_ID_PATTERN)
/** Bound on `nextPageToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100
const LIST_CONCURRENCY = 8

interface GcpKeyRing {
    name?: string
    createTime?: string
}

interface GcpKeyVersion {
    name?: string
    state?: string
    protectionLevel?: string
    algorithm?: string
    createTime?: string
    destroyTime?: string
}

interface GcpCryptoKey {
    name?: string
    purpose?: string
    createTime?: string
    labels?: Record<string, string>
    versionTemplate?: {protectionLevel?: string; algorithm?: string}
    primary?: GcpKeyVersion
}

interface GcpPage {
    nextPageToken?: string
}

interface GcpKeyRingList extends GcpPage {
    keyRings?: GcpKeyRing[]
}

interface GcpCryptoKeyList extends GcpPage {
    cryptoKeys?: GcpCryptoKey[]
}

interface GcpKeyVersionList extends GcpPage {
    cryptoKeyVersions?: GcpKeyVersion[]
}

interface GcpEncryptResponse {
    name?: string
    ciphertext?: string
}

interface GcpDecryptResponse {
    plaintext?: string
}

export class GcpKmsAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'kms' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpKmsSchema()
    }

    /** A failure on any ring fails the whole list: a partial list would read as missing keys. */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const rings = await this.pages<GcpKeyRing, GcpKeyRingList>(this.ringsPath(), (page) => page.keyRings)
        const keysByRing = await mapWithLimit(rings, LIST_CONCURRENCY, (ring) =>
            this.pages<GcpCryptoKey, GcpCryptoKeyList>(
                `${this.ringsPath()}/${encodeURIComponent(leaf(ring.name))}/cryptoKeys`,
                (page) => page.cryptoKeys,
            ),
        )
        return filterBySearch(
            [...rings.map(ringResource(this.client)), ...keysByRing.flat().map((key) => keyResource(this.client)(key))],
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const parts = id.split('/')
        if (parts.length === 1) {
            const ring = await this.client.json<GcpKeyRing>(this.ringPath(id), {method: 'GET'}, {emptyOnNotFound: true})
            return ring ? ringResource(this.client)(ring) : null
        }
        if (parts.length !== 2) return null

        const key = await this.client.json<GcpCryptoKey>(this.keyPath(id), {method: 'GET'}, {emptyOnNotFound: true})
        if (!key) return null
        const versions = await this.pages<GcpKeyVersion, GcpKeyVersionList>(
            `${this.keyPath(id)}/cryptoKeyVersions`,
            (page) => page.cryptoKeyVersions,
        )
        return keyResource(this.client)(key, versions)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = oneOf(input.values.resourceType, GCP_KMS_RESOURCE_TYPES, 'resourceType')
        const name = kmsId(input.values.name, 'name')

        if (resourceType === 'keyRing') {
            const ring = await this.client.json<GcpKeyRing>(`${this.ringsPath()}?keyRingId=${encodeURIComponent(name)}`, {
                method: 'POST',
                headers: JSON_HEADERS,
                body: '{}',
            })
            if (!ring?.name) throw new RuntimeError('Cloud KMS did not return the created key ring')
            return ringResource(this.client)(ring)
        }

        const keyRing = kmsId(input.values.keyRing, 'keyRing')
        const key = await this.client.json<GcpCryptoKey>(
            `${this.ringPath(keyRing)}/cryptoKeys?cryptoKeyId=${encodeURIComponent(name)}`,
            {method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({purpose: SYMMETRIC_PURPOSE})},
        )
        if (!key?.name) throw new RuntimeError('Cloud KMS did not return the created key')
        return keyResource(this.client)(key)
    }

    async delete(): Promise<void> {
        throw new NotSupportedError('Cloud KMS cannot delete a key ring or a key; destroy a key version instead')
    }

    async encrypt(id: string, input: KmsEncryptInput): Promise<KmsEncryptResult> {
        assertSymmetric(input.encryptionAlgorithm, input.encryptionContext)
        if (input.plaintext.byteLength === 0) throw new ValidationError('plaintextBase64 must not be empty')

        const res = await this.client.json<GcpEncryptResponse>(`${this.keyPath(id)}:encrypt`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({plaintext: toBase64(input.plaintext)}),
        })
        if (!res?.ciphertext) throw new RuntimeError('Cloud KMS did not return ciphertext')
        return {ciphertextBlob: fromBase64(res.ciphertext), keyId: id, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'}
    }

    async decrypt(id: string, input: KmsDecryptInput): Promise<KmsDecryptResult> {
        assertSymmetric(input.encryptionAlgorithm, input.encryptionContext)
        if (input.ciphertextBlob.byteLength === 0) throw new ValidationError('ciphertextBlobBase64 must not be empty')

        const res = await this.client.json<GcpDecryptResponse>(`${this.keyPath(id)}:decrypt`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ciphertext: toBase64(input.ciphertextBlob)}),
        })
        if (typeof res?.plaintext !== 'string') throw new RuntimeError('Cloud KMS did not return plaintext')
        return {plaintext: fromBase64(res.plaintext), keyId: id, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'}
    }

    /** Every page of a list call, following `nextPageToken`. */
    private async pages<T, L extends GcpPage>(path: string, items: (page: L) => T[] | undefined): Promise<T[]> {
        const all: T[] = []
        let token: string | undefined
        for (let hop = 0; hop < MAX_PAGES; hop += 1) {
            const separator = path.includes('?') ? '&' : '?'
            const page = await this.client.json<L>(token ? `${path}${separator}pageToken=${encodeURIComponent(token)}` : path)
            all.push(...(page ? (items(page) ?? []) : []))
            token = page?.nextPageToken || undefined
            if (!token) return all
        }
        throw new RuntimeError(`Cloud KMS kept returning pages after ${MAX_PAGES}; refusing a partial list`)
    }

    private ringsPath(): string {
        const {project, location} = this.client
        return `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/keyRings`
    }

    private ringPath(ring: string): string {
        return `${this.ringsPath()}/${encodeURIComponent(kmsId(ring, 'keyRing'))}`
    }

    /** `ring/key`, validated segment by segment so an id can never address another path. */
    private keyPath(id: string): string {
        const [ring, key, ...rest] = id.split('/')
        if (rest.length > 0 || key === undefined) throw new NotFoundError(`Key ${id} was not found`)
        return `${this.ringPath(ring)}/cryptoKeys/${encodeURIComponent(kmsId(key, 'key'))}`
    }
}

function ringResource(client: GcpRuntimeClient) {
    return (ring: GcpKeyRing): CloudResource => {
        const name = leaf(ring.name)
        return {
            id: name,
            name,
            cloud: 'gcp',
            service: 'kms',
            type: 'keyRing',
            region: client.location,
            createdAt: ring.createTime ?? null,
            status: null,
            metadata: {provider: 'gcp', resourcePath: ring.name ?? null},
        }
    }
}

/**
 * `keyUsage`, `keySpec` and `enabled` are the console's shared crypto fields,
 * which decide whether the encrypt and decrypt panel can act on the key. Only a
 * symmetric key qualifies: an asymmetric key encrypts with its public key, which
 * is done outside Cloud KMS.
 *
 * `encryptionContextSupported` is false because Cloud KMS binds one blob of
 * additional authenticated data, not the key-value context the console offers.
 */
function keyResource(client: GcpRuntimeClient) {
    return (key: GcpCryptoKey, versions?: GcpKeyVersion[]): CloudResource => {
        // projects/{p}/locations/{l}/keyRings/{ring}/cryptoKeys/{key}
        const segments = (key.name ?? '').split('/')
        const name = segments[7] ?? ''
        const keyRing = segments[5] ?? ''
        const algorithm = key.primary?.algorithm ?? key.versionTemplate?.algorithm
        const symmetric = key.purpose === SYMMETRIC_PURPOSE && algorithm === SYMMETRIC_ALGORITHM
        return {
            id: `${keyRing}/${name}`,
            name,
            cloud: 'gcp',
            service: 'kms',
            type: 'key',
            region: client.location,
            createdAt: key.createTime ?? null,
            status: key.primary?.state ?? null,
            metadata: {
                provider: 'gcp',
                resourcePath: key.name ?? null,
                keyRing,
                purpose: key.purpose ?? null,
                algorithm: algorithm ?? null,
                protectionLevel: key.primary?.protectionLevel ?? key.versionTemplate?.protectionLevel ?? null,
                primaryVersion: key.primary?.name ? leaf(key.primary.name) : null,
                keyUsage: symmetric ? SYMMETRIC_PURPOSE : undefined,
                keySpec: symmetric ? 'SYMMETRIC_DEFAULT' : undefined,
                encryptionContextSupported: false,
                enabled: key.primary?.state === 'ENABLED',
                labels: key.labels ?? {},
                ...(versions
                    ? {
                          versions: versions.map((version) => ({
                              version: leaf(version.name),
                              state: version.state ?? null,
                              algorithm: version.algorithm ?? null,
                              createdAt: version.createTime ?? null,
                              destroyTime: version.destroyTime ?? null,
                          })),
                      }
                    : {}),
            },
        }
    }
}

function assertSymmetric(algorithm: string, context: Record<string, string> | undefined): void {
    if (algorithm !== 'SYMMETRIC_DEFAULT') {
        throw new ValidationError('Cloud KMS encrypts with a symmetric key here; RSA keys encrypt with their public key')
    }
    if (context && Object.keys(context).length > 0) {
        throw new ValidationError('Cloud KMS binds additional authenticated data, not an encryption context')
    }
}

function leaf(path: string | undefined): string {
    return (path ?? '').split('/').pop() ?? ''
}

function kmsId(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
    const trimmed = value.trim()
    if (!ID_PATTERN.test(trimmed)) throw new ValidationError(`${field}: ${GCP_KMS_ID_MESSAGE}`)
    return trimmed
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
    throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
}

function toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64')
}

function fromBase64(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, 'base64'))
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter(
        (resource) => resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized),
    )
}
