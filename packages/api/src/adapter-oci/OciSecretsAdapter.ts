import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {OCI_SECRET_NAME_MESSAGE, OCI_SECRET_NAME_PATTERN, ociSecretsSchema} from '../cloud-spi/secretsSchema'
import {oci, type OciRuntimeClient} from '../oci'
import {assertNotPendingDeletion, vaultPlanePath} from './OciKmsAdapter'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * OCI Vault secrets as `secrets` resources, on the Vault service's management plane:
 *
 *   GET  /20180608/secrets?compartmentId=...              ListSecrets
 *   POST /20180608/secrets                                CreateSecret
 *   GET  /20180608/secrets/{secretId}                     GetSecret
 *   GET  /20180608/secrets/{secretId}/versions            ListSecretVersions
 *   POST /20180608/secrets/{secretId}/actions/scheduleDeletion
 *
 * Like the other secrets adapters this is metadata-only. The `Secret` and
 * `SecretVersionSummary` shapes never carry content, and this file never calls the
 * Secret Retrieval service (`/20190301/secretbundles`), so no code path here can
 * return a secret value. The value given on create is sent once, base64-encoded.
 *
 * OCI has no DELETE verb for secrets: delete maps to ScheduleSecretDeletion, which
 * leaves the secret listed as PENDING_DELETION until its deletion time.
 */

interface OciSecret {
    id?: string
    secretName?: string
    compartmentId?: string
    vaultId?: string
    keyId?: string
    lifecycleState?: string
    lifecycleDetails?: string
    description?: string
    timeCreated?: string
    timeOfDeletion?: string
    currentVersionNumber?: number
    freeformTags?: Record<string, string>
}

interface OciSecretVersionSummary {
    versionNumber?: number
    name?: string
    stages?: string[]
    timeCreated?: string
    timeOfDeletion?: string
    contentType?: string
}

interface OciVault {
    id?: string
    displayName?: string
    lifecycleState?: string
    managementEndpoint?: string
}

interface OciKey {
    id?: string
    vaultId?: string
    lifecycleState?: string
    algorithm?: string
    keyShape?: {algorithm?: string}
}

export class OciSecretsAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'secrets' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociSecretsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const secrets = await this.client.listAll<OciSecret>(`/20180608/secrets?${qs}`)
        return filterBySearch(secrets.map((secret) => this.toResource(secret)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const secret = await this.fetchSecret(id)
        if (!secret) return null
        const versions = await this.client.listAll<OciSecretVersionSummary>(`${secretPath(id)}/versions`)
        const resource = this.toResource(secret)
        resource.metadata.versions = versions.map((version) => ({
            versionNumber: version.versionNumber ?? null,
            name: version.name ?? null,
            stages: version.stages ?? [],
            contentType: version.contentType ?? null,
            timeCreated: version.timeCreated ?? null,
            timeOfDeletion: version.timeOfDeletion ?? null,
        }))
        return resource
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const secretName = stringValue(input.values.secretName ?? input.values.name)
        const vaultId = stringValue(input.values.vaultId)
        const keyId = stringValue(input.values.keyId)
        const secretValue = rawString(input.values.secretValue ?? input.values.value)
        const description = stringValue(input.values.description)

        if (!secretName) throw new ValidationError('secretName is required')
        if (!new RegExp(OCI_SECRET_NAME_PATTERN).test(secretName)) throw new ValidationError(OCI_SECRET_NAME_MESSAGE)
        if (!vaultId) throw new ValidationError(await this.missingVaultMessage())
        if (!keyId) throw new ValidationError('keyId is required: the OCID of an ENABLED AES key in the vault.')
        if (!secretValue) throw new ValidationError('secretValue is required')

        const vault = await this.assertUsableVault(vaultId)
        await this.assertUsableKey(keyId, vault)

        const secret = await this.client.json<OciSecret>('/20180608/secrets', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                compartmentId: this.client.tenancyId,
                vaultId,
                keyId,
                secretName,
                ...(description ? {description} : {}),
                secretContent: {contentType: 'BASE64', content: encodeSecretContent(secretValue)},
            }),
        })

        // Inspect and delete address a secret by OCID, so a create without one is not reported as done.
        if (!secret?.id) throw new RuntimeError(`OCI Vault did not return the created secret ${secretName}`)
        return this.toResource(secret)
    }

    /** ScheduleSecretDeletion with OCI's default window, refused like the Vault keys adapter for a missing or pending secret. */
    async delete(id: string): Promise<void> {
        const secret = await this.fetchSecret(id)
        if (!secret) throw new NotFoundError(`Secret ${id} was not found`)
        assertNotPendingDeletion('Secret', id, secret)
        await this.client.fetch(`${secretPath(id)}/actions/scheduleDeletion`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({}),
        })
    }

    private fetchSecret(id: string): Promise<OciSecret | null> {
        return this.client.json<OciSecret>(secretPath(id), {method: 'GET'}, {emptyOnNotFound: true})
    }

    /** Explain what to do when no vault was given, instead of inventing one. */
    private async missingVaultMessage(): Promise<string> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const vaults = await this.client.listAll<OciVault>(`/20180608/vaults?${qs}`)
        const active = vaults.filter((vault) => vault.lifecycleState === 'ACTIVE')
        if (active.length === 0) {
            return 'No ACTIVE vault exists in the tenancy root compartment. Create a vault and an AES master '
                + 'encryption key in OCI Vault before creating a secret.'
        }
        return `vaultId is required. ACTIVE vaults: ${active.map(describeVault).join(', ')}.`
    }

    /**
     * Real OCI rejects a secret whose vault or key is unusable; Floci-OCI does not
     * check, so validate here to fail with a clear 400 instead of storing an orphan.
     */
    private async assertUsableVault(vaultId: string): Promise<OciVault> {
        const vault = await this.client.json<OciVault>(
            `/20180608/vaults/${encodeURIComponent(vaultId)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        if (!vault) throw new ValidationError(`Vault ${vaultId} was not found. Create it in OCI Vault first.`)
        if (vault.lifecycleState !== 'ACTIVE') {
            throw new ValidationError(`Vault ${vaultId} is ${vault.lifecycleState ?? 'not ACTIVE'}; secrets need an ACTIVE vault.`)
        }
        return {...vault, id: vault.id ?? vaultId}
    }

    /** GetKey goes to the vault's management plane, resolved the same way as the Vault keys adapter. */
    private async assertUsableKey(keyId: string, vault: OciVault): Promise<void> {
        const key = await this.client.json<OciKey>(
            vaultPlanePath(vault.managementEndpoint, `/keys/${encodeURIComponent(keyId)}`),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        if (!key) throw new ValidationError(`Key ${keyId} was not found.`)
        // vaultId and keyShape are required on an OCI Key, so a key missing either is not accepted.
        if (key.vaultId !== vault.id) {
            throw new ValidationError(`Key ${keyId} belongs to vault ${key.vaultId ?? 'unknown'}, not ${vault.id}.`)
        }
        if (key.lifecycleState !== 'ENABLED') {
            throw new ValidationError(`Key ${keyId} is ${key.lifecycleState ?? 'not ENABLED'}; secrets need an ENABLED key.`)
        }
        const algorithm = key.keyShape?.algorithm ?? key.algorithm
        if (algorithm !== 'AES') {
            throw new ValidationError(`Key ${keyId} is ${algorithm ?? 'of an unknown algorithm'}; OCI Vault secrets need an AES key.`)
        }
    }

    private toResource(secret: OciSecret): CloudResource {
        const version = secret.currentVersionNumber
        return {
            id: secret.id ?? '',
            name: secret.secretName ?? secret.id ?? '',
            cloud: 'oci',
            service: 'secrets',
            type: 'secret',
            region: this.client.region,
            createdAt: secret.timeCreated ?? null,
            status: secret.lifecycleState ?? null,
            version: typeof version === 'number' && version > 0 ? String(version) : null,
            metadata: {
                provider: 'oci',
                secretsService: 'vault',
                ocid: secret.id,
                compartmentId: secret.compartmentId,
                vaultId: secret.vaultId,
                keyId: secret.keyId,
                description: secret.description ?? null,
                lifecycleDetails: secret.lifecycleDetails ?? null,
                timeOfDeletion: secret.timeOfDeletion ?? null,
                freeformTags: secret.freeformTags,
            },
        }
    }
}

/** OCI carries secret content as base64 of its bytes; the value is UTF-8 text. */
export function encodeSecretContent(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

function secretPath(id: string): string {
    return `/20180608/secrets/${encodeURIComponent(id)}`
}

function describeVault(vault: OciVault): string {
    return vault.displayName ? `${vault.displayName} (${vault.id ?? ''})` : vault.id ?? ''
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

/** Secret values keep their whitespace; only the empty string counts as missing. */
function rawString(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
