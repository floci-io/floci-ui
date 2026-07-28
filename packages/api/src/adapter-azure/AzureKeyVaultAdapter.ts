import {azure, type AzureRuntimeClient} from '../azure'
import {azureSecretsSchema, SECRET_NAME_MESSAGE, SECRET_NAME_PATTERN} from '../cloud-spi/secretsSchema'
import {ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
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
}

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
        const records: KeyVaultSecretRecord[] = []
        const visited = new Set<string>()
        let path: string | null = `/secrets?api-version=${API_VERSION}`

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

        return filterBySearch(records.map((record) => toSecretResource(record)), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const body = await this.keyVaultJson<KeyVaultSecretRecord>(
            `/secrets/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )

        return body ? toSecretResource(body, id) : null
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

    async delete(id: string): Promise<void> {
        await this.client.fetch(
            this.keyVaultPath(`/secrets/${encodeURIComponent(id)}?api-version=${API_VERSION}`),
            {method: 'DELETE', headers: keyVaultHeaders()},
            {includeStorageApiVersion: false},
        )
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

function toSecretResource(record: KeyVaultSecretRecord, fallbackName = ''): CloudResource {
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
        status: attributes.enabled === false ? 'disabled' : 'enabled',
        version: parsed.version,
        metadata: {
            provider: 'azure',
            secretsService: 'key-vault',
            vaultAccount: parsed.account,
            contentType: record.contentType || null,
            updatedAt: epochDate(attributes.updated),
            expiresAt: epochDate(attributes.exp),
            notBefore: epochDate(attributes.nbf),
            recoveryLevel: attributes.recoveryLevel,
            recoverableDays: attributes.recoverableDays,
            tags: Object.entries(record.tags ?? {}).map(([key, value]) => ({key, value})),
        },
    }
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
