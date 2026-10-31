import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    GCP_ACCOUNT_DESCRIPTION_MAX_LENGTH,
    GCP_ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
    GCP_ACCOUNT_ID_MESSAGE,
    GCP_ACCOUNT_ID_PATTERN,
    GCP_IDENTITY_KIND_SINGULAR,
    GCP_IDENTITY_KINDS,
    GCP_ROLE_ID_MESSAGE,
    GCP_ROLE_ID_PATTERN,
    GCP_ROLE_STAGES,
    type GcpIdentityKind,
    gcpIdentitySchema,
} from '../cloud-spi/iamSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * GCP IAM service accounts and custom roles of the configured project. Verified
 * against `floci/floci-gcp` 0.12.0, which mirrors the public IAM v1 REST API:
 *
 *   GET|POST        /v1/projects/{project}/serviceAccounts
 *   GET|DELETE      /v1/projects/{project}/serviceAccounts/{email}
 *   GET|POST        /v1/projects/{project}/roles
 *   GET|DELETE      /v1/projects/{project}/roles/{roleId}
 *
 *  - A service account's id is its email, which always has an `@`; a role's id is
 *    its role id, which never does. `get` and `delete` read the kind from that.
 *  - Service account keys are never requested. The runtime returns `privateKeyData`
 *    even when listing keys, so the only safe handling is not to call `/keys` and
 *    to build metadata from named fields instead of copying the response.
 *  - Deleting a custom role is a soft delete: the runtime keeps answering with
 *    `deleted: true` and reserves the role id. Deleted roles are dropped from
 *    `list` and `get`.
 */

const JSON_HEADERS = {'content-type': 'application/json'}
const PAGE_SIZE = 100
/** Bound on `nextPageToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100

const COLLECTION: Record<GcpIdentityKind, string> = {serviceAccounts: 'serviceAccounts', roles: 'roles'}

interface GcpServiceAccount {
    name?: string
    projectId?: string
    uniqueId?: string
    email?: string
    displayName?: string
    description?: string
    etag?: string
    oauth2ClientId?: string
    disabled?: boolean
    createTime?: string
}

interface GcpRole {
    name?: string
    title?: string
    description?: string
    includedPermissions?: string[]
    stage?: string
    etag?: string
    deleted?: boolean
}

interface GcpPage {
    nextPageToken?: string
}

interface GcpServiceAccountList extends GcpPage {
    accounts?: GcpServiceAccount[]
}

interface GcpRoleList extends GcpPage {
    roles?: GcpRole[]
}

export class GcpIdentityAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'identity' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpIdentitySchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const kinds = kind ? [kind] : [...GCP_IDENTITY_KINDS]
        const groups = await Promise.all(kinds.map((each) => this.listKind(each)))
        return filterBySearch(groups.flat(), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        if (kindOf(id) === 'serviceAccounts') {
            const account = await this.client.json<GcpServiceAccount>(
                this.itemPath('serviceAccounts', id),
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            return account ? this.accountResource(account) : null
        }

        const role = await this.client.json<GcpRole>(
            this.itemPath('roles', id),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return role && !role.deleted ? this.roleResource(role, true) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const kind = requiredKind(input.values.kind)
        if (kind === 'serviceAccounts') return this.createAccount(input.values)
        return this.createRole(input.values)
    }

    /**
     * Idempotent like the storage adapter: a resource that is already gone is not
     * an error. The runtime answers deleting a soft-deleted role with a 400, so a
     * role is read first and left alone when it is already deleted.
     */
    async delete(id: string): Promise<void> {
        const kind = kindOf(id)
        if (kind === 'roles' && !(await this.get(id))) return
        await this.client.fetch(this.itemPath(kind, id), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    private async createAccount(values: Record<string, unknown>): Promise<CloudResource> {
        const accountId = pattern(values.accountId, 'accountId', GCP_ACCOUNT_ID_PATTERN, GCP_ACCOUNT_ID_MESSAGE)
        const displayName = optionalString(values.displayName, 'displayName')
        const description = optionalString(values.description, 'description')
        maxLength(displayName, 'displayName', GCP_ACCOUNT_DISPLAY_NAME_MAX_LENGTH)
        maxLength(description, 'description', GCP_ACCOUNT_DESCRIPTION_MAX_LENGTH)

        const created = await this.client.json<GcpServiceAccount>(this.collectionPath('serviceAccounts'), {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({accountId, serviceAccount: compact({displayName, description})}),
        })
        if (!created?.email) throw new RuntimeError(`GCP IAM did not return the created service account ${accountId}`)
        return this.accountResource(created)
    }

    private async createRole(values: Record<string, unknown>): Promise<CloudResource> {
        const roleId = pattern(values.roleId, 'roleId', GCP_ROLE_ID_PATTERN, GCP_ROLE_ID_MESSAGE)
        const title = optionalString(values.title, 'title')
        if (!title) throw new ValidationError('title is required')
        const stage = optionalString(values.stage, 'stage') ?? 'GA'
        if (!(GCP_ROLE_STAGES as readonly string[]).includes(stage)) {
            throw new ValidationError(`stage must be one of ${GCP_ROLE_STAGES.join(', ')}`)
        }

        const role = compact({
            title,
            description: optionalString(values.description, 'description'),
            includedPermissions: permissions(values.includedPermissions),
            stage,
        })
        const created = await this.client.json<GcpRole>(this.collectionPath('roles'), {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({roleId, role}),
        })
        if (!created?.name) throw new RuntimeError(`GCP IAM did not return the created role ${roleId}`)
        return this.roleResource(created, true)
    }

    private async listKind(kind: GcpIdentityKind): Promise<CloudResource[]> {
        if (kind === 'serviceAccounts') {
            const accounts = await this.pages<GcpServiceAccount, GcpServiceAccountList>('serviceAccounts', (page) => page.accounts)
            return accounts.map((account) => this.accountResource(account))
        }
        const roles = await this.pages<GcpRole, GcpRoleList>('roles', (page) => page.roles)
        return roles.filter((role) => !role.deleted).map((role) => this.roleResource(role, false))
    }

    /** A failure on any page fails the whole list: a partial list would read as missing identities. */
    private async pages<T, P extends GcpPage>(kind: GcpIdentityKind, pick: (page: P) => T[] | undefined): Promise<T[]> {
        const items: T[] = []
        let pageToken: string | undefined
        for (let hop = 0; hop < MAX_PAGES; hop++) {
            const qs = new URLSearchParams({pageSize: String(PAGE_SIZE)})
            if (pageToken) qs.set('pageToken', pageToken)
            const page = await this.client.json<P>(`${this.collectionPath(kind)}?${qs}`)
            items.push(...(page ? pick(page) ?? [] : []))
            pageToken = page?.nextPageToken || undefined
            if (!pageToken) return items
        }
        throw new RuntimeError(`GCP IAM kept returning pages after ${MAX_PAGES} requests`)
    }

    private collectionPath(kind: GcpIdentityKind): string {
        return `/v1/projects/${encodeURIComponent(this.client.project)}/${COLLECTION[kind]}`
    }

    private itemPath(kind: GcpIdentityKind, id: string): string {
        return `${this.collectionPath(kind)}/${encodeURIComponent(id)}`
    }

    private accountResource(account: GcpServiceAccount): CloudResource {
        const email = account.email ?? ''
        return {
            id: email,
            name: email.split('@')[0] ?? email,
            cloud: 'gcp',
            service: 'identity',
            type: GCP_IDENTITY_KIND_SINGULAR.serviceAccounts,
            // IAM resources belong to the project, not to a region.
            region: null,
            createdAt: account.createTime ?? null,
            status: account.disabled ? 'DISABLED' : 'ENABLED',
            metadata: compact({
                provider: 'gcp',
                kind: GCP_IDENTITY_KIND_SINGULAR.serviceAccounts,
                resourcePath: account.name,
                email: account.email,
                displayName: account.displayName,
                description: account.description,
                projectId: account.projectId,
                uniqueId: account.uniqueId,
                oauth2ClientId: account.oauth2ClientId,
                disabled: account.disabled,
                etag: account.etag,
            }),
        }
    }

    /** `includedPermissions` only comes back from a get; the runtime leaves it out of a list. */
    private roleResource(role: GcpRole, withPermissions: boolean): CloudResource {
        const id = (role.name ?? '').split('/').pop() ?? ''
        return {
            id,
            name: id,
            cloud: 'gcp',
            service: 'identity',
            type: GCP_IDENTITY_KIND_SINGULAR.roles,
            region: null,
            createdAt: null,
            status: role.stage ?? null,
            metadata: compact({
                provider: 'gcp',
                kind: GCP_IDENTITY_KIND_SINGULAR.roles,
                resourcePath: role.name,
                displayName: role.title,
                description: role.description,
                includedPermissions: withPermissions ? role.includedPermissions : undefined,
                etag: role.etag,
            }),
        }
    }
}

/** An email has an `@`; a role id is letters, digits, periods and underscores. */
function kindOf(id: string): GcpIdentityKind {
    if (!id) throw new ValidationError('A service account email or a role id is required')
    return id.includes('@') ? 'serviceAccounts' : 'roles'
}

function optionalKind(value: unknown): GcpIdentityKind | undefined {
    if (value === undefined || value === null || value === '') return undefined
    return requiredKind(value)
}

function requiredKind(value: unknown): GcpIdentityKind {
    const raw = optionalString(value, 'kind')
    if (!raw || !(GCP_IDENTITY_KINDS as readonly string[]).includes(raw)) {
        throw new ValidationError(`kind must be one of ${GCP_IDENTITY_KINDS.join(', ')}`)
    }
    return raw as GcpIdentityKind
}

function pattern(value: unknown, field: string, regex: string, message: string): string {
    const text = optionalString(value, field)
    if (!text) throw new ValidationError(`${field} is required`)
    if (!new RegExp(regex).test(text)) throw new ValidationError(message)
    return text
}

function maxLength(value: string | undefined, field: string, max: number): void {
    if (value && value.length > max) throw new ValidationError(`${field} must be at most ${max} characters`)
}

/** The form sends one permission per line; an API caller may send an array. */
function permissions(value: unknown): string[] | undefined {
    if (value === undefined || value === null || value === '') return undefined
    let lines: unknown[]
    if (Array.isArray(value)) lines = value
    else if (typeof value === 'string') lines = value.split(/\r?\n/)
    else throw new ValidationError('includedPermissions must be text, one permission per line')

    const items = lines.map((line) => {
        if (typeof line !== 'string') throw new ValidationError('includedPermissions must be strings')
        return line.trim()
    }).filter(Boolean)
    return items.length ? items : undefined
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value.trim() || undefined
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized))
}

function compact<T extends Record<string, unknown>>(values: T): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null))
}
