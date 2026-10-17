import {azure, type AzureRuntimeClient} from '../azure'
import {
    APP_CONFIG_FEATURE_FLAG_CONTENT_TYPE,
    APP_CONFIG_FEATURE_FLAG_PREFIX,
    azureAppConfigSchema,
} from '../cloud-spi/appConfigSchema'
import {ConflictError, httpStatusToCloudError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
    UpdateResourceInput,
} from '../cloud-spi/types'

const API_VERSION = '2024-09-01'

interface KeyValueRecord {
    key?: string
    label?: string | null
    value?: string | null
    content_type?: string | null
    tags?: Record<string, string> | null
    etag?: string
    last_modified?: string
    locked?: boolean
}

interface KeyValueListResponse {
    items?: KeyValueRecord[]
    '@nextLink'?: string | null
}

export class AzureAppConfigAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'configuration' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureAppConfigSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const records = await this.collect(`/kv?api-version=${API_VERSION}`)
        const kind = query.filters?.kind
        const search = query.search?.trim().toLowerCase()
        return records
            .map((record) => toResource(record))
            .filter((resource) => !kind || resource.metadata.kind === kind)
            .filter((resource) => !search || resource.name.toLowerCase().includes(search))
    }

    async get(id: string): Promise<CloudResource | null> {
        const {key, label} = parseId(id)
        const record = await this.json<KeyValueRecord>(kvPath(key, label), {method: 'GET'}, true)
        if (!record) return null

        const revisions = await this.collect(
            `/revisions?api-version=${API_VERSION}&key=${encodeURIComponent(key)}&label=${encodeURIComponent(label || '\0')}`,
            true,
        )
        const resource = toResource(record)
        resource.metadata.revisions = revisions.map((revision) => ({
            etag: revision.etag ?? null,
            lastModified: revision.last_modified ?? null,
            value: revision.value ?? null,
        }))
        return resource
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const isFlag = text(input.values.kind) === 'feature-flag'
        const name = text(input.values.key)
        const label = text(input.values.label)
        if (!name) throw new ValidationError('key is required')

        const key = isFlag ? `${APP_CONFIG_FEATURE_FLAG_PREFIX}${name}` : name
        const payload = isFlag
            ? {
                value: featureFlagValue(name, input.values.enabled === 'true' || input.values.enabled === true),
                content_type: APP_CONFIG_FEATURE_FLAG_CONTENT_TYPE,
            }
            : {value: text(input.values.value, false), ...optional('content_type', text(input.values.contentType))}

        // The runtime does not honour If-None-Match on a PUT, so the existence check is made here.
        const existing = await this.json<KeyValueRecord>(kvPath(key, label), {method: 'GET'}, true)
        if (existing) throw new ConflictError(`Key-value ${name}${label ? ` with label ${label}` : ''} already exists`)

        const record = await this.json<KeyValueRecord>(kvPath(key, label), {
            method: 'PUT',
            headers: {'if-none-match': '*'},
            body: JSON.stringify(payload),
        })
        if (!record) throw new RuntimeError('Azure App Configuration create returned an empty response')
        return toResource(record)
    }

    async update(id: string, input: UpdateResourceInput): Promise<CloudResource> {
        const {key, label} = parseId(id)
        const current = await this.json<KeyValueRecord>(kvPath(key, label), {method: 'GET'}, true)
        if (!current) throw new NotFoundError(`Key-value ${key} was not found`)
        assertUnlocked(current)

        const isFlag = kindOf(current) === 'feature-flag'
        const enabled = text(input.values.enabled)
        if (enabled && !isFlag) throw new ValidationError('enabled only applies to feature flags')

        let value = current.value ?? ''
        if (isFlag) {
            if (typeof input.values.value === 'string') value = input.values.value
            if (enabled) value = withFlagState(value, enabled === 'true')
        } else if (typeof input.values.value === 'string') {
            value = input.values.value
        }
        const contentType = typeof input.values.contentType === 'string'
            ? input.values.contentType.trim()
            : current.content_type ?? ''

        const record = await this.json<KeyValueRecord>(kvPath(key, label), {
            method: 'PUT',
            body: JSON.stringify({value, ...optional('content_type', contentType), tags: current.tags ?? {}}),
        })
        if (!record) throw new RuntimeError('Azure App Configuration update returned an empty response')
        return toResource(record)
    }

    async delete(id: string): Promise<void> {
        const {key, label} = parseId(id)
        const current = await this.json<KeyValueRecord>(kvPath(key, label), {method: 'GET'}, true)
        if (current) assertUnlocked(current)
        await this.json(kvPath(key, label), {method: 'DELETE'}, true)
    }

    // A runtime that echoes the current page as its own nextLink would otherwise
    // loop forever, so stop as soon as a page repeats.
    private async collect(firstPath: string, emptyOnNotFound = false): Promise<KeyValueRecord[]> {
        const records: KeyValueRecord[] = []
        const visited = new Set<string>()
        let path: string | null = firstPath

        while (path && !visited.has(path)) {
            visited.add(path)
            const body: KeyValueListResponse | null = await this.json<KeyValueListResponse>(path, {method: 'GET'}, emptyOnNotFound)
            records.push(...(body?.items ?? []))
            path = body?.['@nextLink'] ? nextPath(body['@nextLink']) : null
        }
        return records
    }

    private async json<T>(path: string, init: RequestInit, emptyOnNotFound = false): Promise<T | null> {
        const res = await this.client.fetch(
            `/${encodeURIComponent(this.client.accountName)}-appconfig${path}`,
            {
                ...init,
                headers: {
                    accept: 'application/json',
                    authorization: 'Bearer floci-ui',
                    ...(init.body ? {'content-type': 'application/json'} : {}),
                    ...(init.headers ?? {}),
                },
            },
            {emptyOnNotFound, includeStorageApiVersion: false, allowErrorStatus: true},
        )

        if (!res) return null
        // The runtime answers a write on a locked key-value with an empty 423, so it
        // has to be named here rather than surfacing as a bare runtime failure.
        if (res.status === 423) throw lockedError()
        if (res.status === 404 && emptyOnNotFound) return null
        if (!res.ok) throw httpStatusToCloudError(res.status, `Azure App Configuration request failed: HTTP ${res.status} ${path}`)
        const body = await res.text()
        return body ? JSON.parse(body) as T : null
    }
}

function lockedError(): ConflictError {
    return new ConflictError('This key-value is locked. Unlock it before changing or deleting it.')
}

function assertUnlocked(record: KeyValueRecord): void {
    if (record.locked) throw lockedError()
}

function kvPath(key: string, label: string): string {
    const query = label ? `&label=${encodeURIComponent(label)}` : ''
    return `/kv/${encodeURIComponent(key)}?api-version=${API_VERSION}${query}`
}

// `|` is always percent-encoded inside a component, so it can only be the separator.
function makeId(key: string, label: string): string {
    return `${encodeURIComponent(key)}|${encodeURIComponent(label)}`
}

function parseId(id: string): {key: string; label: string} {
    const separator = id.lastIndexOf('|')
    if (separator < 0) throw new ValidationError('Invalid key-value id')
    try {
        return {
            key: decodeURIComponent(id.slice(0, separator)),
            label: decodeURIComponent(id.slice(separator + 1)),
        }
    } catch {
        throw new ValidationError('Invalid key-value id')
    }
}

function nextPath(nextLink: string): string {
    try {
        const url = new URL(nextLink)
        return stripAccountPrefix(`${url.pathname}${url.search}`)
    } catch {
        return stripAccountPrefix(nextLink.startsWith('/') ? nextLink : `/${nextLink}`)
    }
}

// The runtime's relative nextLink is already below the account prefix.
function stripAccountPrefix(path: string): string {
    return path.replace(/^\/[^/]+-appconfig(?=\/)/, '')
}

function kindOf(record: KeyValueRecord): 'feature-flag' | 'key-value' {
    return record.key?.startsWith(APP_CONFIG_FEATURE_FLAG_PREFIX) ? 'feature-flag' : 'key-value'
}

function flagEnabled(value?: string | null): boolean | null {
    try {
        const parsed = JSON.parse(value ?? '') as {enabled?: unknown}
        return typeof parsed.enabled === 'boolean' ? parsed.enabled : null
    } catch {
        return null
    }
}

function featureFlagValue(id: string, enabled: boolean): string {
    return JSON.stringify({id, description: '', enabled, conditions: {client_filters: []}})
}

function withFlagState(value: string, enabled: boolean): string {
    try {
        return JSON.stringify({...JSON.parse(value) as Record<string, unknown>, enabled})
    } catch {
        throw new ValidationError('The feature flag value is not valid JSON, so its state cannot be changed')
    }
}

function toResource(record: KeyValueRecord): CloudResource {
    const key = record.key ?? ''
    const label = record.label ?? ''
    const kind = kindOf(record)
    const enabled = kind === 'feature-flag' ? flagEnabled(record.value) : null

    return {
        id: makeId(key, label),
        name: key,
        cloud: 'azure',
        service: 'configuration',
        type: kind,
        region: null,
        createdAt: null,
        status: record.locked ? 'locked' : 'active',
        version: record.etag ?? null,
        metadata: {
            provider: 'azure',
            label: label || null,
            kind,
            value: record.value ?? null,
            contentType: record.content_type ?? null,
            enabled,
            enabledValue: enabled === null ? null : String(enabled),
            locked: record.locked === true,
            etag: record.etag ?? null,
            lastModified: record.last_modified ?? null,
            tags: Object.entries(record.tags ?? {}).map(([name, value]) => ({key: name, value})),
        },
    }
}

function text(value: unknown, trim = true): string {
    if (typeof value !== 'string') return ''
    return trim ? value.trim() : value
}

function optional<K extends string>(name: K, value: string): Partial<Record<K, string>> {
    return value ? {[name]: value} as Record<K, string> : {}
}
