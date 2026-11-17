import {NotSupportedError, ValidationError} from '../cloud-spi/errors'
import {
    OCI_ORGANIZATIONS_KIND_LABEL,
    OCI_ORGANIZATIONS_KINDS,
    type OciOrganizationsKind,
    ociOrganizationsSchema,
} from '../cloud-spi/organizationsSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const ORGANIZATIONS_API = '/20230401'

interface OciOrganization {
    id?: string
    compartmentId?: string
    displayName?: string
    parentName?: string
    defaultUcmSubscriptionId?: string
    lifecycleState?: string
    timeCreated?: string
    timeUpdated?: string
}

/** A member tenancy of an organization; the summary and the full shape agree on these. */
interface OciOrganizationTenancy {
    tenancyId?: string
    name?: string
    role?: string
    lifecycleState?: string
    governanceStatus?: string
    isApprovedForTransfer?: boolean
    timeJoined?: string
    timeTerminated?: string
    timeLeft?: string
}

interface OciLink {
    id?: string
    parentTenancyId?: string
    childTenancyId?: string
    feature?: string
    lifecycleState?: string
    timeCreated?: string
    timeTerminated?: string
}

/** The sender's and the recipient's invitation share most of their fields. */
interface OciInvitation {
    id?: string
    compartmentId?: string
    displayName?: string
    lifecycleState?: string
    /** The invitation's own status (`PENDING`, `ACCEPTED`, ...), apart from its lifecycle state. */
    status?: string
    subjects?: string[]
    timeCreated?: string
    timeUpdated?: string
    // Sender invitation
    recipientTenancyId?: string
    recipientInvitationId?: string
    // Recipient invitation
    senderTenancyId?: string
    senderInvitationId?: string
}

interface OciCollection<T> {
    items?: T[]
}

/** Per-kind REST collection under `/20230401`; member tenancies hang off an organization instead. */
const COLLECTION = {
    organizations: 'organizations',
    links: 'links',
    senderInvitations: 'senderInvitations',
    recipientInvitations: 'recipientInvitations',
} as const
type CollectionKind = keyof typeof COLLECTION

/** The OCID resource-type segment, `ocid1.<type>.<realm>...`, for each kind. */
const OCID_TYPE_TO_KIND: Record<string, OciOrganizationsKind> = {
    organization: 'organizations',
    tenancy: 'tenancies',
    link: 'links',
    senderinvitation: 'senderInvitations',
    recipientinvitation: 'recipientInvitations',
}

/**
 * OCI Organizations (the Tenant Manager control plane) as one read-only
 * `organizations` category.
 *
 *  - Resource ids are the OCIDs. An OCID names its type, so `get` reads the kind
 *    from it. A member tenancy is addressed through its organization, which its
 *    OCID does not name, so `get` asks each organization in turn.
 *  - `list` honours the `kind` facet; without it the five kinds are listed
 *    together. Organizations data is tenancy wide, so there is no region.
 *  - Every list is wrapped in `{items}` and paged with `opc-next-page`.
 *  - The Organizations API does not return a member's home region, so none is
 *    shown; it is on the tenancy itself (Identity `GetTenancy`), which only that
 *    tenancy can read.
 */
export class OciOrganizationsAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'organizations' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociOrganizationsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const kinds = kind ? [kind] : [...OCI_ORGANIZATIONS_KINDS]
        const organizations = needsOrganizations(kinds)
            ? await this.listItems<OciOrganization>(this.listPath('organizations'))
            : []
        const groups = await Promise.all(kinds.map((each) => this.listKind(each, organizations)))
        return filterBySearch(groups.flat(), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const kind = kindOf(id)
        if (kind === 'tenancies') return this.getTenancy(id)

        const item = await this.client.json<OciOrganization & OciLink & OciInvitation>(
            this.itemPath(kind, id),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return item ? this.toResource(kind, item) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Creating child tenancies and invitations is not supported yet.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Organization records cannot be deleted from the console.')
    }

    private async listKind(kind: OciOrganizationsKind, organizations: OciOrganization[]): Promise<CloudResource[]> {
        if (kind === 'organizations') return organizations.map((item) => this.toResource(kind, item))
        if (kind === 'tenancies') {
            const perOrganization = await Promise.all(organizations.map(
                (organization) => this.listItems<OciOrganizationTenancy>(
                    `${ORGANIZATIONS_API}/organizations/${encodeURIComponent(organization.id ?? '')}/tenancies`,
                ),
            ))
            return perOrganization.flat().map((item) => this.toResource(kind, item))
        }
        const items = await this.listItems<OciLink & OciInvitation>(this.listPath(kind))
        return items.map((item) => this.toResource(kind, item))
    }

        private async getTenancy(id: string): Promise<CloudResource | null> {
        const organizations = await this.listItems<OciOrganization>(this.listPath('organizations'))
        for (const organization of organizations) {
            const path = `${ORGANIZATIONS_API}/organizations/${encodeURIComponent(organization.id ?? '')}`
                + `/tenancies/${encodeURIComponent(id)}`
            const item = await this.client.json<OciOrganizationTenancy>(path, {method: 'GET'}, {emptyOnNotFound: true})
            if (item) return this.toResource('tenancies', item, organization.id)
        }
        return null
    }

    private listPath(kind: CollectionKind): string {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        return `${ORGANIZATIONS_API}/${COLLECTION[kind]}?${qs}`
    }

    private itemPath(kind: CollectionKind, id: string): string {
        return `${ORGANIZATIONS_API}/${COLLECTION[kind]}/${encodeURIComponent(id)}`
    }

    /** Every list here wraps its page in `{items:[...]}`, so the client's `listAll` does not apply. */
    private async listItems<T>(path: string): Promise<T[]> {
        const items: T[] = []
        // Stops on a token seen before, so a runtime that repeats one cannot loop forever.
        const seen = new Set<string>()
        let page: string | null = null
        do {
            if (page) seen.add(page)
            const res = await this.client.fetch(page ? `${path}${path.includes('?') ? '&' : '?'}page=${encodeURIComponent(page)}` : path)
            if (!res) break
            const body = (await res.json()) as OciCollection<T>
            items.push(...(body.items ?? []))
            page = res.headers.get('opc-next-page')
        } while (page && !seen.has(page))
        return items
    }

    private toResource(
        kind: OciOrganizationsKind,
        item: OciOrganization & OciOrganizationTenancy & OciLink & OciInvitation,
        organizationId?: string,
    ): CloudResource {
        const id = (kind === 'tenancies' ? item.tenancyId : item.id) ?? ''
        const name = (kind === 'organizations' || kind === 'senderInvitations' || kind === 'recipientInvitations')
            ? (item.displayName ?? '')
            : kind === 'links' ? (item.feature ?? '') : (item.name ?? '')
        return {
            id,
            name,
            cloud: 'oci',
            service: 'organizations',
            type: OCI_ORGANIZATIONS_KIND_LABEL[kind],
            // Organizations data is tenancy wide, not regional.
            region: null,
            createdAt: (kind === 'tenancies' ? item.timeJoined : item.timeCreated) ?? null,
            status: item.lifecycleState ?? null,
            metadata: compact({
                provider: 'oci',
                kind: OCI_ORGANIZATIONS_KIND_LABEL[kind],
                ocid: id,
                organizationId,
                compartmentId: item.compartmentId,
                // Organization
                parentName: item.parentName,
                defaultSubscriptionId: item.defaultUcmSubscriptionId,
                // Tenancy
                role: item.role,
                governanceStatus: item.governanceStatus,
                isApprovedForTransfer: item.isApprovedForTransfer,
                timeJoined: item.timeJoined,
                timeLeft: item.timeLeft,
                // Link
                feature: item.feature,
                parentTenancyId: item.parentTenancyId,
                childTenancyId: item.childTenancyId,
                // Invitation
                invitationStatus: item.status,
                subjects: item.subjects,
                recipientTenancyId: item.recipientTenancyId,
                recipientInvitationId: item.recipientInvitationId,
                senderTenancyId: item.senderTenancyId,
                senderInvitationId: item.senderInvitationId,
                timeUpdated: item.timeUpdated,
                timeTerminated: item.timeTerminated,
            }),
        }
    }
}

function needsOrganizations(kinds: OciOrganizationsKind[]): boolean {
    return kinds.includes('organizations') || kinds.includes('tenancies')
}

/** Reads the kind from an OCID such as `ocid1.link.oc1..aaaa`. */
function kindOf(id: string): OciOrganizationsKind {
    const [version, type] = id.split('.')
    const kind = version === 'ocid1' && type ? OCID_TYPE_TO_KIND[type] : undefined
    if (!kind) {
        throw new ValidationError(
            `Expected the OCID of an organization, tenancy, link or invitation, got "${id}"`,
        )
    }
    return kind
}

function optionalKind(value: unknown): OciOrganizationsKind | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string' || !(OCI_ORGANIZATIONS_KINDS as readonly string[]).includes(value.trim())) {
        throw new ValidationError(`kind must be one of ${OCI_ORGANIZATIONS_KINDS.join(', ')}`)
    }
    return value.trim() as OciOrganizationsKind
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
