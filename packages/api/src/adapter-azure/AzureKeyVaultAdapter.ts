import {azure, type AzureRuntimeClient} from '../azure'
import {
    AZURE_SECRET_STATES,
    azureSecretsSchema,
    SECRET_NAME_MESSAGE,
    SECRET_NAME_PATTERN,
} from '../cloud-spi/secretsSchema'
import {NotFoundError, RuntimeError, ValidationError, httpStatusToCloudError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
    UpdateResourceInput,
} from '../cloud-spi/types'

const API_VERSION = '7.4'

interface KeyVaultSecretAttributes {
    enabled?: boolean
    created?: number
    updated?: number
    exp?: number | null
    nbf?: number | null
    recoveryLevel?: string
    recoverableDays?: number
}

interface KeyVaultSecretRecord {
    id?: string
    value?: string
    attributes?: KeyVaultSecretAttributes
    contentType?: string
    tags?: Record<string, string>
    recoveryId?: string
    deletedDate?: number
    scheduledPurgeDate?: number
}

type SecretState = (typeof AZURE_SECRET_STATES)[number]

const VERSION_PATTERN = /^[0-9a-fA-F]{1,64}$/

interface KeyVaultSecretListResponse {
    value?: KeyVaultSecretRecord[]
    nextLink?: string | null
}

export class AzureKeyVaultAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'secrets' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureSecretsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const state = secretState(query.filters?.state)
        const collection = state === 'deleted' ? 'deletedsecrets' : 'secrets'
        const records = await this.listAll(`/${collection}?api-version=${API_VERSION}`)

        return filterBySearch(records.map((record) => toSecretResource(record, '', state)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const res = await this.client.fetch(
            this.keyVaultPath(`/secrets/${encodeURIComponent(id)}?api-version=${API_VERSION}`),
            {method: 'GET', headers: keyVaultHeaders()},
            {includeStorageApiVersion: false, allowErrorStatus: true},
        )

        // A disabled secret answers 403 on read, but it is still listed and still has versions.
        if (res?.status === 403) return this.withVersions(await this.disabledSecret(id), id, null)
        if (res?.status === 404) return this.getDeleted(id)
        if (!res || !res.ok) {
            throw httpStatusToCloudError(res?.status ?? 502, `Azure Key Vault get failed: HTTP ${res?.status ?? 'unknown'}`)
        }

        const record = await res.json() as KeyVaultSecretRecord
        return this.withVersions(toSecretResource(record, id), id, parseSecretId(record.id).version)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const secretName = stringValue(input.values.secretName ?? input.values.name)
        const secretValue = stringValue(input.values.secretValue ?? input.values.value, false)
        const contentType = stringValue(input.values.contentType)

        if (!secretName) throw new ValidationError('secretName is required')
        if (!new RegExp(SECRET_NAME_PATTERN).test(secretName)) throw new ValidationError(SECRET_NAME_MESSAGE)
        if (!secretValue) throw new ValidationError('secretValue is required')

        const body = await this.keyVaultJson<KeyVaultSecretRecord>(
            `/secrets/${encodeURIComponent(secretName)}?api-version=${API_VERSION}`,
            {
                method: 'PUT',
                body: JSON.stringify({
                    value: secretValue,
                    ...(contentType ? {contentType} : {}),
                }),
            },
        )

        if (!body) throw new Error('Azure Key Vault create returned an empty response')
        return toSecretResource(body, secretName)
    }

    async update(id: string, input: UpdateResourceInput): Promise<CloudResource> {
        const contentType = input.values.contentType === undefined ? undefined : stringValue(input.values.contentType)
        const enabled = booleanValue(input.values.enabled)
        const version = stringValue(input.values.version)

        if (contentType === undefined && enabled === undefined) {
            throw new ValidationError('Provide a content type or an enabled value to update')
        }
        if (version && !VERSION_PATTERN.test(version)) throw new ValidationError('version must be a hexadecimal version ID')

        const target = version || await this.latestVersion(id)
        const body = await this.keyVaultJson<KeyVaultSecretRecord>(
            `/secrets/${encodeURIComponent(id)}/${target}?api-version=${API_VERSION}`,
            {
                method: 'PATCH',
                body: JSON.stringify({
                    ...(contentType === undefined ? {} : {contentType}),
                    ...(enabled === undefined ? {} : {attributes: {enabled}}),
                }),
            },
        )

        if (!body) throw new RuntimeError('Azure Key Vault update returned an empty response')
        return toSecretResource(body, id)
    }

    // Key Vault delete is a soft-delete: the secret moves to the deleted namespace
    // until it is recovered or purged.
    async delete(id: string): Promise<void> {
        await this.client.fetch(
            this.keyVaultPath(`/secrets/${encodeURIComponent(id)}?api-version=${API_VERSION}`),
            {method: 'DELETE', headers: keyVaultHeaders()},
            {includeStorageApiVersion: false},
        )
    }

    async recover(id: string): Promise<CloudResource> {
        const body = await this.keyVaultJson<KeyVaultSecretRecord>(
            `/deletedsecrets/${encodeURIComponent(id)}/recover?api-version=${API_VERSION}`,
            {method: 'POST'},
        )

        if (!body) throw new RuntimeError('Azure Key Vault recover returned an empty response')
        return toSecretResource(body, id)
    }

    async purgeDeleted(id: string): Promise<void> {
        await this.client.fetch(
            this.keyVaultPath(`/deletedsecrets/${encodeURIComponent(id)}?api-version=${API_VERSION}`),
            {method: 'DELETE', headers: keyVaultHeaders()},
            {includeStorageApiVersion: false},
        )
    }

    private async listAll(firstPath: string): Promise<KeyVaultSecretRecord[]> {
        const records: KeyVaultSecretRecord[] = []
        const visited = new Set<string>()
        let path: string | null = firstPath

        // A runtime that echoes the current page as its own nextLink would otherwise
        // loop forever, so stop as soon as a page repeats.
        while (path && !visited.has(path)) {
            visited.add(path)
            const body: KeyVaultSecretListResponse | null = await this.keyVaultJson<KeyVaultSecretListResponse>(
                path,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            records.push(...(body?.value ?? []))
            path = body?.nextLink ? keyVaultNextPath(body.nextLink) : null
        }

        return records
    }

    private async getDeleted(id: string): Promise<CloudResource | null> {
        const body = await this.keyVaultJson<KeyVaultSecretRecord>(
            `/deletedsecrets/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        return body ? toSecretResource(body, id, 'deleted') : null
    }

    private versionRecords(id: string): Promise<KeyVaultSecretRecord[]> {
        return this.listAll(`/secrets/${encodeURIComponent(id)}/versions?api-version=${API_VERSION}`)
    }

    private async withVersions(resource: CloudResource | null, id: string, current: string | null): Promise<CloudResource | null> {
        if (!resource) return null
        const records = await this.versionRecords(id)
        resource.metadata.versions = sortVersions(records.map((record) => toVersionEntry(record, current)))
        return resource
    }

    // The latest version of a disabled secret cannot be read, but it is one of the
    // disabled versions, so its attributes come from the newest of those.
    private async disabledSecret(id: string): Promise<CloudResource | null> {
        const candidates = newestDisabled(await this.versionRecords(id))
        if (candidates.length === 0) return null
        return toSecretResource(candidates[0], id)
    }

    private async latestVersion(id: string): Promise<string> {
        const res = await this.client.fetch(
            this.keyVaultPath(`/secrets/${encodeURIComponent(id)}?api-version=${API_VERSION}`),
            {method: 'GET', headers: keyVaultHeaders()},
            {includeStorageApiVersion: false, allowErrorStatus: true},
        )

        if (res?.status === 404) throw new NotFoundError(`Secret ${id} was not found`)
        if (res?.status === 403) {
            const candidates = newestDisabled(await this.versionRecords(id))
            const version = candidates.length === 1 ? parseSecretId(candidates[0].id).version : null
            if (!version) {
                throw new ValidationError('The latest version of a disabled secret cannot be determined; provide its version ID')
            }
            return version
        }
        if (!res || !res.ok) {
            throw httpStatusToCloudError(res?.status ?? 502, `Azure Key Vault get failed: HTTP ${res?.status ?? 'unknown'}`)
        }

        const version = parseSecretId(((await res.json()) as KeyVaultSecretRecord).id).version
        if (!version) throw new RuntimeError('Azure Key Vault returned a secret without a version')
        return version
    }

    private async keyVaultJson<T>(
        path: string,
        init: RequestInit,
        options?: {emptyOnNotFound?: boolean},
    ): Promise<T | null> {
        const res = await this.client.fetch(
            this.keyVaultPath(path),
            {
                ...init,
                headers: {
                    ...keyVaultHeaders(),
                    ...(init.headers ?? {}),
                },
            },
            {...options, includeStorageApiVersion: false},
        )

        if (!res || res.status === 204) return null
        return await res.json() as T
    }

    private keyVaultPath(path: string): string {
        return `/${encodeURIComponent(this.client.accountName)}-keyvault${path}`
    }
}

function keyVaultNextPath(nextLink: string): string {
    try {
        const url = new URL(nextLink)
        return `${url.pathname}${url.search}`
    } catch {
        return nextLink.startsWith('/') ? nextLink : `/${nextLink}`
    }
}

function keyVaultHeaders(): Record<string, string> {
    return {
        accept: 'application/json',
        authorization: 'Bearer floci-ui',
        'content-type': 'application/json',
    }
}

function toSecretResource(record: KeyVaultSecretRecord, fallbackName = '', state: SecretState = 'active'): CloudResource {
    const parsed = parseSecretId(record.id)
    const name = parsed.name || fallbackName
    const attributes = record.attributes ?? {}

    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'secrets',
        type: 'secret',
        region: null,
        createdAt: epochDate(attributes.created),
        status: state === 'deleted' ? 'deleted' : attributes.enabled === false ? 'disabled' : 'enabled',
        version: parsed.version,
        metadata: {
            provider: 'azure',
            secretsService: 'key-vault',
            vaultAccount: parsed.account,
            contentType: record.contentType || null,
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

function toVersionEntry(record: KeyVaultSecretRecord, current: string | null) {
    const version = parseSecretId(record.id).version
    const attributes = record.attributes ?? {}

    return {
        version,
        enabled: attributes.enabled !== false,
        createdAt: epochDate(attributes.created),
        updatedAt: epochDate(attributes.updated),
        expiresAt: epochDate(attributes.exp),
        notBefore: epochDate(attributes.nbf),
        contentType: record.contentType || null,
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

function newestDisabled(records: KeyVaultSecretRecord[]): KeyVaultSecretRecord[] {
    const disabled = records.filter((record) => record.attributes?.enabled === false)
    const newest = Math.max(...disabled.map((record) => record.attributes?.created ?? 0))
    return disabled.filter((record) => (record.attributes?.created ?? 0) === newest)
}

function secretState(value: string | undefined): SecretState {
    if (!value) return 'active'
    if ((AZURE_SECRET_STATES as readonly string[]).includes(value)) return value as SecretState
    throw new ValidationError(`state must be one of: ${AZURE_SECRET_STATES.join(', ')}`)
}

function booleanValue(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === undefined || value === '') return undefined
    throw new ValidationError('enabled must be true or false')
}

function parseSecretId(id?: string): {account: string | null; name: string; version: string | null} {
    if (!id) return {account: null, name: '', version: null}
    try {
        const url = new URL(id)
        const parts = url.pathname.split('/').filter(Boolean)
        return {
            account: url.hostname.split('.')[0] || null,
            name: decodeURIComponent(parts[1] ?? ''),
            version: parts[2] ? decodeURIComponent(parts[2]) : null,
        }
    } catch {
        const parts = id.split('/').filter(Boolean)
        const secretsIndex = parts.lastIndexOf('secrets')
        return {
            account: null,
            name: decodeURIComponent(parts[secretsIndex + 1] ?? ''),
            version: parts[secretsIndex + 2] ? decodeURIComponent(parts[secretsIndex + 2]) : null,
        }
    }
}

function epochDate(value?: number | null): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return new Date(value * 1000).toISOString()
}

function stringValue(value: unknown, trim = true): string {
    if (typeof value !== 'string') return ''
    return trim ? value.trim() : value
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
