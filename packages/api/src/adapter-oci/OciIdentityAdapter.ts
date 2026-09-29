import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    OCI_IDENTITY_DESCRIPTION_MAX_LENGTH,
    OCI_IDENTITY_KIND_SINGULAR,
    OCI_IDENTITY_KINDS,
    OCI_IDENTITY_NAME_MAX_LENGTH,
    OCI_IDENTITY_NAME_MESSAGE,
    type OciIdentityKind,
    ociIdentitySchema,
} from '../cloud-spi/iamSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const IDENTITY_API = '/20160918'

/**
 * The fields shared by `Compartment`, `User`, `Group` and `Policy`; each kind
 * adds a few of its own.
 */
interface OciIdentityResource {
    id?: string
    compartmentId?: string
    name?: string
    description?: string
    timeCreated?: string
    lifecycleState?: string
    inactiveStatus?: number
    freeformTags?: Record<string, string>
    definedTags?: Record<string, Record<string, unknown>>
    // Compartment
    isAccessible?: boolean
    // User
    email?: string
    emailVerified?: boolean
    isMfaActivated?: boolean
    lastSuccessfulLoginTime?: string
    // Policy
    statements?: string[]
    versionDate?: string
}

interface OciUserGroupMembership {
    id?: string
    userId?: string
    groupId?: string
    lifecycleState?: string
}

/** Per-kind REST collection under `/20160918`. */
const COLLECTION: Record<OciIdentityKind, string> = {
    compartments: 'compartments',
    users: 'users',
    groups: 'groups',
    policies: 'policies',
}

/** The OCID resource-type segment, `ocid1.<type>.<realm>...`, for each kind. */
const OCID_TYPE_TO_KIND: Record<string, OciIdentityKind> = {
    compartment: 'compartments',
    user: 'users',
    group: 'groups',
    policy: 'policies',
}

/** Compartment, group and policy names cannot be email-shaped; user names can. */
const NAME_PATTERN: Record<OciIdentityKind, RegExp> = {
    compartments: /^[A-Za-z0-9._-]+$/,
    users: /^[A-Za-z0-9._+@-]+$/,
    groups: /^[A-Za-z0-9._-]+$/,
    policies: /^[A-Za-z0-9._-]+$/,
}

/** A compartment in this state is gone; OCI keeps listing it for a while. */
const DELETED_STATE = 'DELETED'

/**
 * OCI Identity (IAM) against the tenancy's root compartment.
 *
 *  - Resource ids are the OCIDs themselves. An OCID already names its type
 *    (`ocid1.user.oc1..`), so `get` and `delete` read the kind from it and no
 *    `kind/` prefix is needed.
 *  - `list` honours the `kind` facet; without it the four kinds are listed
 *    together. Compartments are the tenancy's direct children.
 *  - DeleteCompartment is asynchronous on OCI: it answers 202 with an
 *    `opc-work-request-id`. `delete` returns once the request is accepted and
 *    does not poll the work request; the compartment then reports `DELETING` or
 *    `DELETED`, and deleted ones are dropped from `list` and `get`.
 */
export class OciIdentityAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'identity' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociIdentitySchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const kinds = kind ? [kind] : [...OCI_IDENTITY_KINDS]
        const groups = await Promise.all(kinds.map(async (each) => {
            const items = await this.client.listAll<OciIdentityResource>(this.listPath(each))
            return items
                .filter((item) => item.lifecycleState !== DELETED_STATE)
                .map((item) => this.toResource(each, item))
        }))
        return filterBySearch(groups.flat(), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const kind = kindOf(id)
        const item = await this.client.json<OciIdentityResource>(
            this.itemPath(kind, id),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        if (!item || item.lifecycleState === DELETED_STATE) return null

        const resource = this.toResource(kind, item)
        // Only on inspect: resolving memberships per row would make list an N+1.
        if (kind === 'users') resource.metadata.groups = await this.relatedNames('userId', id, 'groups')
        if (kind === 'groups') resource.metadata.members = await this.relatedNames('groupId', id, 'users')
        return resource
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const kind = requiredKind(input.values.kind)
        const name = requiredName(input.values.name, kind)
        const description = requiredDescription(input.values.description)

        const body: Record<string, unknown> = {compartmentId: this.client.tenancyId, name, description}
        if (kind === 'users') {
            const email = optionalString(input.values.email, 'email')
            if (email) body.email = email
        }
        if (kind === 'policies') body.statements = requiredStatements(input.values.statements)

        const created = await this.client.json<OciIdentityResource>(`${IDENTITY_API}/${COLLECTION[kind]}`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(body),
        })
        if (!created?.id) {
            throw new RuntimeError(`OCI Identity did not return the created ${OCI_IDENTITY_KIND_SINGULAR[kind]} ${name}`)
        }
        return this.toResource(kind, created)
    }

    /**
     * Idempotent like the storage adapter: a resource that is already gone is not
     * an error. A compartment with active children fails with a 409 conflict.
     */
    async delete(id: string): Promise<void> {
        if (id === this.client.tenancyId) {
            throw new ValidationError('The root compartment (tenancy) cannot be deleted')
        }
        const kind = kindOf(id)
        await this.client.fetch(this.itemPath(kind, id), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    private listPath(kind: OciIdentityKind): string {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        return `${IDENTITY_API}/${COLLECTION[kind]}?${qs}`
    }

    private itemPath(kind: OciIdentityKind, id: string): string {
        return `${IDENTITY_API}/${COLLECTION[kind]}/${encodeURIComponent(id)}`
    }

    /**
     * The groups a user is in, or the users a group holds, by name. Memberships
     * only carry OCIDs, so the other side is listed once and joined.
     */
    private async relatedNames(
        by: 'userId' | 'groupId',
        id: string,
        other: 'users' | 'groups',
    ): Promise<Array<{id: string; name: string}>> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId, [by]: id})
        const [memberships, candidates] = await Promise.all([
            this.client.listAll<OciUserGroupMembership>(`${IDENTITY_API}/userGroupMemberships?${qs}`),
            this.client.listAll<OciIdentityResource>(this.listPath(other)),
        ])
        const names = new Map(candidates.map((item) => [item.id ?? '', item.name ?? '']))
        return memberships
            .map((membership) => (by === 'userId' ? membership.groupId : membership.userId) ?? '')
            .filter(Boolean)
            .map((relatedId) => ({id: relatedId, name: names.get(relatedId) || relatedId}))
    }

    private toResource(kind: OciIdentityKind, item: OciIdentityResource): CloudResource {
        const singular = OCI_IDENTITY_KIND_SINGULAR[kind]
        return {
            id: item.id ?? '',
            name: item.name ?? '',
            cloud: 'oci',
            service: 'identity',
            type: singular,
            // Identity resources are global to the tenancy, not regional.
            region: null,
            createdAt: item.timeCreated ?? null,
            status: item.lifecycleState ?? null,
            metadata: compact({
                provider: 'oci',
                kind: singular,
                ocid: item.id,
                compartmentId: item.compartmentId,
                description: item.description,
                inactiveStatus: item.inactiveStatus,
                isAccessible: item.isAccessible,
                email: item.email,
                emailVerified: item.emailVerified,
                isMfaActivated: item.isMfaActivated,
                lastSuccessfulLoginTime: item.lastSuccessfulLoginTime,
                statements: item.statements,
                versionDate: item.versionDate,
                freeformTags: item.freeformTags,
                definedTags: item.definedTags,
            }),
        }
    }
}

/** Reads the kind from an OCID such as `ocid1.policy.oc1..aaaa`. */
function kindOf(id: string): OciIdentityKind {
    const [version, type] = id.split('.')
    const kind = version === 'ocid1' && type ? OCID_TYPE_TO_KIND[type] : undefined
    if (!kind) {
        throw new ValidationError(
            `Expected the OCID of a compartment, user, group or policy, got "${id}"`,
        )
    }
    return kind
}

function optionalKind(value: unknown): OciIdentityKind | undefined {
    if (value === undefined || value === null || value === '') return undefined
    return requiredKind(value)
}

function requiredKind(value: unknown): OciIdentityKind {
    const raw = optionalString(value, 'kind')
    if (!raw || !(OCI_IDENTITY_KINDS as readonly string[]).includes(raw)) {
        throw new ValidationError(`kind must be one of ${OCI_IDENTITY_KINDS.join(', ')}`)
    }
    return raw as OciIdentityKind
}

function requiredName(value: unknown, kind: OciIdentityKind): string {
    const name = optionalString(value, 'name')
    if (!name) throw new ValidationError('name is required')
    if (name.length > OCI_IDENTITY_NAME_MAX_LENGTH || !NAME_PATTERN[kind].test(name)) {
        throw new ValidationError(OCI_IDENTITY_NAME_MESSAGE)
    }
    return name
}

function requiredDescription(value: unknown): string {
    const description = optionalString(value, 'description')
    if (!description) throw new ValidationError('description is required')
    if (description.length > OCI_IDENTITY_DESCRIPTION_MAX_LENGTH) {
        throw new ValidationError(`description must be at most ${OCI_IDENTITY_DESCRIPTION_MAX_LENGTH} characters`)
    }
    return description
}

/** The form sends one statement per line; an API caller may send an array. */
function requiredStatements(value: unknown): string[] {
    let lines: unknown[]
    if (Array.isArray(value)) lines = value
    else if (typeof value === 'string') lines = value.split(/\r?\n/)
    else if (value === undefined || value === null) lines = []
    else throw new ValidationError('statements must be text, one statement per line')

    const statements = lines.map((line) => {
        if (typeof line !== 'string') throw new ValidationError('statements must be strings')
        return line.trim()
    }).filter(Boolean)
    if (statements.length === 0) throw new ValidationError('statements are required when kind is policies')
    return statements
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

function compact(values: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null))
}
