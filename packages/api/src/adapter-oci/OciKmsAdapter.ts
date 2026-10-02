import {ConflictError, NotFoundError, NotImplementedByRuntimeError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    OCI_DISPLAY_NAME_MAX_LENGTH,
    OCI_KEY_SHAPES,
    OCI_KMS_RESOURCE_TYPES,
    OCI_PROTECTION_MODES,
    OCI_VAULT_TYPES,
    ociKmsSchema,
    type OciKeyShapeName,
} from '../cloud-spi/kmsSchema'
import {oci, type OciRuntimeClient} from '../oci'
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

/** `Vault` from Get/Create, or the slimmer `VaultSummary` from ListVaults. */
interface OciVault {
    id?: string
    displayName?: string
    compartmentId?: string
    lifecycleState?: string
    vaultType?: string
    managementEndpoint?: string
    cryptoEndpoint?: string
    timeCreated?: string
    timeOfDeletion?: string
    freeformTags?: Record<string, string>
}

interface OciKeyShape {
    algorithm?: string
    length?: number
    curveId?: string
}

/**
 * `Key` from Get/Create carries `keyShape`; `KeySummary` from ListKeys has only
 * a flat `algorithm` and no length.
 */
interface OciKey {
    id?: string
    displayName?: string
    compartmentId?: string
    vaultId?: string
    lifecycleState?: string
    protectionMode?: string
    currentKeyVersion?: string
    keyShape?: OciKeyShape
    algorithm?: string
    timeCreated?: string
    timeOfDeletion?: string
    freeformTags?: Record<string, string>
}

interface OciEncryptedData {
    ciphertext?: string
    keyId?: string
    keyVersionId?: string
    encryptionAlgorithm?: string
}

interface OciDecryptedData {
    plaintext?: string
    keyId?: string
    keyVersionId?: string
    encryptionAlgorithm?: string
}

type OciEncryptionAlgorithm = 'AES_256_GCM' | 'RSA_OAEP_SHA_1' | 'RSA_OAEP_SHA_256'

/** The console's shared crypto vocabulary mapped onto OCI's `encryptionAlgorithm`. */
const OCI_ALGORITHM: Record<KmsEncryptionAlgorithm, OciEncryptionAlgorithm> = {
    SYMMETRIC_DEFAULT: 'AES_256_GCM',
    RSAES_OAEP_SHA_1: 'RSA_OAEP_SHA_1',
    RSAES_OAEP_SHA_256: 'RSA_OAEP_SHA_256',
}

const KMS_API = '/20180608'
const JSON_HEADERS = {'content-type': 'application/json'}

/**
 * Floci-OCI gaps, refused here rather than offered: its crypto plane runs AES-GCM only and
 * never reads `associatedData`, so an RSA call fails and a context would not be bound.
 */
const FLOCI_OCI_NO_RSA_ENCRYPT = 'Floci-OCI does not support RSA encryption yet'
const FLOCI_OCI_NO_ASSOCIATED_DATA = 'Floci-OCI does not bind an encryption context (associatedData) yet'

/** OCI Encrypt accepts at most 4 KiB of plaintext. */
const PLAINTEXT_MAX_BYTES = 4_096

/**
 * OCI Vault: vaults, and the keys inside them.
 *
 * Vaults are served from the regional KMS endpoint. Keys are managed on each
 * vault's `managementEndpoint` and used on its `cryptoEndpoint`, so every key
 * call first resolves the vault that owns it. See `vaultPlanePath`.
 *
 * Nothing is ever deleted outright: OCI has no DELETE verb for either, so
 * `delete` schedules deletion and the row stays, in PENDING_DELETION, until the
 * window elapses.
 */
export class OciKmsAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'kms' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociKmsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const vaults = await this.withDeletionDates(await this.listVaults())
        const keys = await this.listKeys(vaults)
        const vaultNames = new Map(vaults.map((vault) => [vault.id ?? '', vault.displayName]))
        return filterBySearch(
            [
                ...vaults.map((vault) => this.vaultResource(vault)),
                ...keys.map((key) => this.keyResource(key, vaultNames.get(key.vaultId ?? ''))),
            ],
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        if (isVaultId(id)) {
            const vault = await this.getVault(id)
            return vault ? this.vaultResource(vault) : null
        }
        const found = await this.findKey(id)
        return found ? this.keyResource(found.key, found.vault?.displayName) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = oneOf(input.values.resourceType, OCI_KMS_RESOURCE_TYPES, 'resourceType')
        const displayName = requiredString(input.values.displayName, 'displayName')
        if (displayName.length > OCI_DISPLAY_NAME_MAX_LENGTH) {
            throw new ValidationError(`displayName must be ${OCI_DISPLAY_NAME_MAX_LENGTH} characters or fewer`)
        }
        return resourceType === 'vault'
            ? this.createVault(displayName, input.values)
            : this.createKey(displayName, input.values)
    }

    /** ScheduleVaultDeletion / ScheduleKeyDeletion, with OCI's default window. */
    async delete(id: string): Promise<void> {
        if (isVaultId(id)) {
            const vault = await this.getVault(id)
            if (!vault) throw new NotFoundError(`Vault ${id} was not found`)
            assertNotPendingDeletion('Vault', id, vault)
            await this.client.fetch(`${KMS_API}/vaults/${encodeURIComponent(id)}/actions/scheduleDeletion`, {
                method: 'POST',
                headers: JSON_HEADERS,
                body: '{}',
            })
            return
        }
        const {key, vault} = await this.requireKey(id)
        assertNotPendingDeletion('Key', id, key)
        await this.client.fetch(
            vaultPlanePath(vault?.managementEndpoint, `/keys/${encodeURIComponent(id)}/actions/scheduleDeletion`),
            {method: 'POST', headers: JSON_HEADERS, body: '{}'},
        )
    }

    async encrypt(id: string, input: KmsEncryptInput): Promise<KmsEncryptResult> {
        const {key, vault} = await this.requireKey(id)
        validateCryptoKey(key, input.encryptionAlgorithm, input.encryptionContext)
        if (input.plaintext.byteLength === 0) throw new ValidationError('plaintextBase64 must not be empty')
        if (input.plaintext.byteLength > PLAINTEXT_MAX_BYTES) {
            throw new ValidationError(`plaintextBase64 must decode to ${PLAINTEXT_MAX_BYTES} bytes or fewer`)
        }

        const res = await this.client.json<OciEncryptedData>(vaultPlanePath(vault?.cryptoEndpoint, '/encrypt'), {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
                keyId: id,
                plaintext: toBase64(input.plaintext),
                encryptionAlgorithm: OCI_ALGORITHM[input.encryptionAlgorithm],
            }),
        })
        if (!res?.ciphertext) throw new RuntimeError('OCI KMS did not return ciphertext')

        return {
            ciphertextBlob: fromBase64(res.ciphertext),
            keyId: res.keyId ?? id,
            encryptionAlgorithm: responseAlgorithm(res.encryptionAlgorithm, input.encryptionAlgorithm),
        }
    }

    async decrypt(id: string, input: KmsDecryptInput): Promise<KmsDecryptResult> {
        const {key, vault} = await this.requireKey(id)
        validateCryptoKey(key, input.encryptionAlgorithm, input.encryptionContext)
        if (input.ciphertextBlob.byteLength === 0) throw new ValidationError('ciphertextBlobBase64 must not be empty')

        const res = await this.client.json<OciDecryptedData>(vaultPlanePath(vault?.cryptoEndpoint, '/decrypt'), {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
                keyId: id,
                ciphertext: toBase64(input.ciphertextBlob),
                encryptionAlgorithm: OCI_ALGORITHM[input.encryptionAlgorithm],
            }),
        })
        if (typeof res?.plaintext !== 'string') throw new RuntimeError('OCI KMS did not return plaintext')

        return {
            plaintext: fromBase64(res.plaintext),
            keyId: res.keyId ?? id,
            encryptionAlgorithm: responseAlgorithm(res.encryptionAlgorithm, input.encryptionAlgorithm),
        }
    }

    private async createVault(displayName: string, values: Record<string, unknown>): Promise<CloudResource> {
        const vaultType = oneOf(values.vaultType, OCI_VAULT_TYPES, 'vaultType')
        const vault = await this.client.json<OciVault>(`${KMS_API}/vaults`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({compartmentId: this.client.tenancyId, displayName, vaultType}),
        })
        if (!vault?.id) throw new RuntimeError('OCI KMS did not return the created vault')
        return this.vaultResource(vault)
    }

    /**
     * CreateKey names no vault in its body: the vault is whichever one's
     * `managementEndpoint` receives the call. So the vault is resolved first and
     * must be ACTIVE, as OCI refuses new keys in a vault pending deletion.
     */
    private async createKey(displayName: string, values: Record<string, unknown>): Promise<CloudResource> {
        const shapeName = oneOf(values.keyShape, Object.keys(OCI_KEY_SHAPES) as OciKeyShapeName[], 'keyShape')
        const protectionMode = oneOf(values.protectionMode, OCI_PROTECTION_MODES, 'protectionMode')
        const vault = await this.vaultForNewKey(optionalString(values.vaultId, 'vaultId'))

        const key = await this.client.json<OciKey>(vaultPlanePath(vault.managementEndpoint, '/keys'), {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
                compartmentId: this.client.tenancyId,
                displayName,
                keyShape: OCI_KEY_SHAPES[shapeName],
                protectionMode,
            }),
        })
        if (!key?.id) throw new RuntimeError('OCI KMS did not return the created key')
        // The vault is chosen by the management endpoint the call reaches. A runtime that
        // serves every vault from one endpoint picks its own, so a mismatch is reported.
        if (key.vaultId && vault.id && key.vaultId !== vault.id) {
            throw new ConflictError(
                `The runtime created key ${displayName} (${key.id}) in vault ${key.vaultId}, not the selected ${vault.displayName ?? vault.id}`,
            )
        }
        return this.keyResource(key, vault.displayName)
    }

    private async vaultForNewKey(vaultId: string | undefined): Promise<OciVault> {
        if (vaultId) {
            if (!isVaultId(vaultId)) throw new ValidationError('vaultId must be a vault OCID (ocid1.vault...)')
            const vault = await this.getVault(vaultId)
            if (!vault) throw new ValidationError(`Vault ${vaultId} was not found`)
            if (vault.lifecycleState !== 'ACTIVE') {
                throw new ConflictError(`Vault ${vaultId} is ${vault.lifecycleState ?? 'not active'}; keys can only be created in an ACTIVE vault`)
            }
            return vault
        }

        const active = (await this.listVaults()).filter((vault) => vault.lifecycleState === 'ACTIVE')
        if (active.length === 1 && active[0]) return active[0]
        throw new ValidationError(
            active.length === 0
                ? 'Create a vault first: the compartment has no ACTIVE vault to hold the key'
                : 'The compartment has several ACTIVE vaults; set vaultId to choose one',
        )
    }

    private listVaults(): Promise<OciVault[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        return this.client.listAll<OciVault>(`${KMS_API}/vaults?${qs}`)
    }

    /** VaultSummary has no `timeOfDeletion`, so pending vaults are read in full. */
    private withDeletionDates(vaults: OciVault[]): Promise<OciVault[]> {
        return Promise.all(
            vaults.map(async (vault) => {
                if (vault.lifecycleState !== 'PENDING_DELETION' || vault.timeOfDeletion || !vault.id) return vault
                return (await this.getVault(vault.id)) ?? vault
            }),
        )
    }

    private getVault(id: string): Promise<OciVault | null> {
        return this.client.json<OciVault>(`${KMS_API}/vaults/${encodeURIComponent(id)}`, {method: 'GET'}, {
            emptyOnNotFound: true,
        })
    }

    /**
     * ListKeys runs once per distinct management plane. Vaults that resolve to
     * the same plane (every vault on Floci-OCI) would otherwise return the same
     * keys repeatedly, so the calls are shared and the keys deduplicated by id.
     *
     * A KeySummary has no key length or current version, so each key is then
     * read with GetKey; a key gone by then keeps its summary row.
     */
    private async listKeys(vaults: OciVault[]): Promise<OciKey[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const planes = [...new Set(vaults.map((vault) => vaultPlanePath(vault.managementEndpoint, '')))]
        const pages = await Promise.all(
            planes.map(async (plane) => {
                const keys = await this.client.listAll<OciKey>(`${plane}/keys?${qs}`)
                return keys.map((key) => ({key, plane}))
            }),
        )

        const byId = new Map<string, {key: OciKey; plane: string}>()
        for (const entry of pages.flat()) {
            if (entry.key.id && !byId.has(entry.key.id)) byId.set(entry.key.id, entry)
        }
        return Promise.all(
            [...byId.values()].map(async ({key, plane}) => {
                const full = await this.client.json<OciKey>(
                    `${plane}/keys/${encodeURIComponent(key.id ?? '')}`,
                    {method: 'GET'},
                    {emptyOnNotFound: true},
                )
                return full ?? key
            }),
        )
    }

    /**
     * A key OCID does not name its vault, and GetKey must be sent to that
     * vault's management plane, so each plane is asked in turn. The key's own
     * `vaultId` then picks the vault whose crypto plane serves it.
     */
    private async findKey(id: string): Promise<{key: OciKey; vault: OciVault | undefined} | null> {
        const vaults = await this.listVaults()
        const planes = [...new Set(vaults.map((vault) => vaultPlanePath(vault.managementEndpoint, '')))]
        for (const plane of planes) {
            const key = await this.client.json<OciKey>(`${plane}/keys/${encodeURIComponent(id)}`, {method: 'GET'}, {
                emptyOnNotFound: true,
            })
            if (key) return {key, vault: vaults.find((vault) => vault.id === key.vaultId)}
        }
        return null
    }

    private async requireKey(id: string): Promise<{key: OciKey; vault: OciVault | undefined}> {
        if (isVaultId(id)) throw new ValidationError('Select a key: vaults do not encrypt, decrypt, or hold key material')
        const found = await this.findKey(id)
        if (!found) throw new NotFoundError(`Key ${id} was not found in any vault of the compartment`)
        return found
    }

    private vaultResource(vault: OciVault): CloudResource {
        const id = vault.id ?? ''
        return {
            id,
            name: vault.displayName || id,
            cloud: 'oci',
            service: 'kms',
            type: 'vault',
            region: this.client.region,
            createdAt: vault.timeCreated ?? null,
            status: vault.lifecycleState ?? null,
            metadata: {
                provider: 'oci',
                ocid: id,
                compartmentId: vault.compartmentId,
                vaultType: vault.vaultType,
                lifecycleState: vault.lifecycleState,
                managementEndpoint: vault.managementEndpoint,
                cryptoEndpoint: vault.cryptoEndpoint,
                timeOfDeletion: vault.timeOfDeletion ?? null,
                freeformTags: vault.freeformTags ?? {},
            },
        }
    }

    /**
     * `keyUsage`, `keySpec` and `enabled` are the console's shared crypto fields,
     * which decide whether the encrypt/decrypt panel can act on the key. OCI has
     * no key usage: AES and RSA keys encrypt, ECDSA keys only sign.
     */
    private keyResource(key: OciKey, vaultName: string | undefined): CloudResource {
        const id = key.id ?? ''
        const algorithm = key.keyShape?.algorithm ?? key.algorithm
        const length = key.keyShape?.length
        return {
            id,
            name: key.displayName || id,
            cloud: 'oci',
            service: 'kms',
            type: 'key',
            region: this.client.region,
            createdAt: key.timeCreated ?? null,
            status: key.lifecycleState ?? null,
            metadata: {
                provider: 'oci',
                ocid: id,
                compartmentId: key.compartmentId,
                vaultId: key.vaultId,
                vaultName: vaultName ?? null,
                lifecycleState: key.lifecycleState,
                protectionMode: key.protectionMode,
                currentKeyVersion: key.currentKeyVersion ?? null,
                algorithm,
                length: length ?? null,
                curveId: key.keyShape?.curveId ?? null,
                keyShapeLabel: keyShapeLabel(algorithm, length, key.keyShape?.curveId),
                keyUsage: algorithm === 'ECDSA' ? 'SIGN_VERIFY' : algorithm ? 'ENCRYPT_DECRYPT' : undefined,
                keySpec: keySpec(algorithm, length),
                cryptoUnavailableReason: algorithm === 'RSA' ? FLOCI_OCI_NO_RSA_ENCRYPT : null,
                encryptionContextSupported: false,
                enabled: key.lifecycleState === 'ENABLED',
                timeOfDeletion: key.timeOfDeletion ?? null,
                freeformTags: key.freeformTags ?? {},
            },
        }
    }
}

/**
 * Resolve a vault's advertised management or crypto endpoint onto the runtime.
 *
 * Real OCI gives every vault its own hostname. Floci UI only ever talks to the
 * one configured Floci-OCI endpoint, and Floci-OCI serves every vault's planes
 * from that host, advertising its own base URL (which, behind a Docker port
 * mapping or a service hostname, is not an address this API can reach). So the
 * advertised host is dropped and any path it carries is kept — never following
 * a host taken from a response body.
 */
export function vaultPlanePath(endpoint: string | undefined, path: string): string {
    let base = ''
    if (endpoint) {
        try {
            base = new URL(endpoint).pathname.replace(/\/+$/, '')
        } catch {
            base = ''
        }
    }
    return `${base}${KMS_API}${path}`
}

/** A resource already pending deletion is refused rather than reported as deleted again. */
export function assertNotPendingDeletion(kind: string, id: string, resource: {lifecycleState?: string; timeOfDeletion?: string}): void {
    if (resource.lifecycleState !== 'PENDING_DELETION' && resource.lifecycleState !== 'SCHEDULING_DELETION') return
    const when = resource.timeOfDeletion ? ` for ${resource.timeOfDeletion}` : ''
    throw new ConflictError(`${kind} ${id} is already scheduled for deletion${when}`)
}

function validateCryptoKey(
    key: OciKey,
    algorithm: KmsEncryptionAlgorithm,
    encryptionContext: Record<string, string> | undefined,
): void {
    if (key.lifecycleState !== 'ENABLED') {
        throw new ConflictError(`Key must be ENABLED; it is ${key.lifecycleState ?? 'in an unknown state'}`)
    }
    const keyAlgorithm = key.keyShape?.algorithm ?? key.algorithm
    if (keyAlgorithm === 'AES') {
        if (algorithm !== 'SYMMETRIC_DEFAULT') throw new ValidationError('AES keys require SYMMETRIC_DEFAULT (AES_256_GCM)')
        if (hasEntries(encryptionContext)) throw new NotImplementedByRuntimeError(FLOCI_OCI_NO_ASSOCIATED_DATA)
        return
    }
    if (keyAlgorithm === 'RSA') {
        if (algorithm === 'SYMMETRIC_DEFAULT') {
            throw new ValidationError('RSA keys require an RSAES_OAEP encryption algorithm')
        }
        if (hasEntries(encryptionContext)) throw new ValidationError('RSA keys do not support encryptionContext')
        throw new NotImplementedByRuntimeError(FLOCI_OCI_NO_RSA_ENCRYPT)
    }
    throw new ValidationError(`${keyAlgorithm ?? 'This'} keys cannot encrypt or decrypt`)
}

function responseAlgorithm(value: string | undefined, fallback: KmsEncryptionAlgorithm): KmsEncryptionAlgorithm {
    if (value === undefined) return fallback
    const match = (Object.keys(OCI_ALGORITHM) as KmsEncryptionAlgorithm[]).find((name) => OCI_ALGORITHM[name] === value)
    if (!match) throw new RuntimeError(`OCI KMS returned an unsupported encryption algorithm: ${value}`)
    return match
}

/** AES of any length is the symmetric default; RSA is named by its modulus in bits. */
function keySpec(algorithm: string | undefined, length: number | undefined): string | undefined {
    if (algorithm === 'AES') return 'SYMMETRIC_DEFAULT'
    if (algorithm === 'RSA' && length) return `RSA_${length * 8}`
    return undefined
}

function keyShapeLabel(algorithm: string | undefined, length: number | undefined, curveId: string | undefined): string | null {
    if (!algorithm) return null
    if (algorithm === 'ECDSA' && curveId) return `ECDSA ${curveId.replace('NIST_', '')}`
    return length ? `${algorithm}-${length * 8}` : algorithm
}

function isVaultId(id: string): boolean {
    return id.startsWith('ocid1.vault.')
}

function hasEntries(value: Record<string, string> | undefined): value is Record<string, string> {
    return value !== undefined && Object.keys(value).length > 0
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

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value.trim() || undefined
}

function requiredString(value: unknown, field: string): string {
    const text = optionalString(value, field)
    if (!text) throw new ValidationError(`${field} is required`)
    return text
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    const raw = optionalString(value, field)
    if (raw === undefined) return allowed[0] as T
    if (!(allowed as readonly string[]).includes(raw)) {
        throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
    }
    return raw as T
}
