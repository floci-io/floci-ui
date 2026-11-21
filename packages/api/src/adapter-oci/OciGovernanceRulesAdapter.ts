import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    PageQuery,
} from '../cloud-spi/childCollections'
import {DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT} from '../cloud-spi/childCollections'
import {NotFoundError, NotSupportedError, ValidationError} from '../cloud-spi/errors'
import {
    OCI_GOVERNANCE_INCLUSION_CRITERIA,
    OCI_GOVERNANCE_TENANCY_ATTACHMENTS,
    ociGovernanceSchema,
} from '../cloud-spi/governanceSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const GOVERNANCE_API = '/20220504'

interface OciGovernanceRule {
    id?: string
    compartmentId?: string
    displayName?: string
    description?: string
    type?: string
    creationOption?: string
    lifecycleState?: string
    timeCreated?: string
    timeUpdated?: string
    /** Only the full shape carries it; the summaries leave it out. */
    template?: Record<string, unknown>
}

interface OciInclusionCriterion {
    id?: string
    governanceRuleId?: string
    type?: string
    association?: {type?: string; tenancyId?: string}
    lifecycleState?: string
    timeCreated?: string
    timeUpdated?: string
}

interface OciTenancyAttachment {
    id?: string
    compartmentId?: string
    governanceRuleId?: string
    tenancyId?: string
    lifecycleState?: string
    timeCreated?: string
    timeUpdated?: string
}

interface OciCollection<T> {
    items?: T[]
}

/**
 * OCI Governance Rules (the parent tenancy's rules for its child tenancies) as one
 * read-only `governance` category.
 *
 *  - Resource ids are the rule OCIDs. Every list is wrapped in `{items}` and paged
 *    with `opc-next-page`; the list needs `compartmentId` (the tenancy) or a rule id.
 *  - A rule holds two fixed child collections, its inclusion criteria and its
 *    tenancy attachments, listed through `documents`.
 *  - Floci-OCI enforces `ALLOWED_REGIONS` only; the schema says so, and the rule's
 *    type is shown as it is, never as an "enforced" flag.
 */
export class OciGovernanceRulesAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'governance' as const

    readonly documents: DocumentStoreAdapter

    constructor(private readonly client: OciRuntimeClient = oci) {
        this.documents = new GovernanceRuleStore(
            (id) => this.requireRule(id),
            <T>(path: string) => this.listItems<T>(path),
        )
    }

    schema(): ServiceSchema {
        return ociGovernanceSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const rules = await this.listItems<OciGovernanceRule>(`${GOVERNANCE_API}/governanceRules?${qs}`)
        return filterBySearch(rules.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        assertRuleId(id)
        const rule = await this.client.json<OciGovernanceRule>(
            `${GOVERNANCE_API}/governanceRules/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return rule ? toResource(rule) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Creating governance rules is not supported yet.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Governance rules cannot be deleted from the console.')
    }

    private async requireRule(id: string): Promise<string> {
        const rule = await this.get(id)
        if (!rule) throw new NotFoundError(`Governance rule ${id} not found`)
        return id
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
}

/** A rule holds two fixed collections, so the store has no create or delete. */
class GovernanceRuleStore implements DocumentStoreAdapter {
    constructor(
        private readonly requireRule: (id: string) => Promise<string>,
        private readonly collect: <T>(path: string) => Promise<T[]>,
    ) {}

    async listCollections(ruleId: string): Promise<CollectionPage<ChildCollection>> {
        await this.requireRule(ruleId)
        const collection = (id: string, name: string): ChildCollection => ({id, name, parentId: ruleId, createdAt: null, metadata: {}})
        return {
            items: [
                collection(OCI_GOVERNANCE_INCLUSION_CRITERIA, 'Inclusion criteria'),
                collection(OCI_GOVERNANCE_TENANCY_ATTACHMENTS, 'Tenancy attachments'),
            ],
            nextCursor: null,
        }
    }

    async listItems(ruleId: string, collectionId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const qs = `governanceRuleId=${encodeURIComponent(ruleId)}`
        let items: ChildItem[]
        if (collectionId === OCI_GOVERNANCE_INCLUSION_CRITERIA) {
            await this.requireRule(ruleId)
            items = (await this.collect<OciInclusionCriterion>(`${GOVERNANCE_API}/inclusionCriteria?${qs}`)).map(toCriterionItem)
        } else if (collectionId === OCI_GOVERNANCE_TENANCY_ATTACHMENTS) {
            await this.requireRule(ruleId)
            items = (await this.collect<OciTenancyAttachment>(`${GOVERNANCE_API}/tenancyAttachments?${qs}`)).map(toAttachmentItem)
        } else {
            throw new NotFoundError(
                `Unknown governance rule collection ${collectionId}; use ${OCI_GOVERNANCE_INCLUSION_CRITERIA} or ${OCI_GOVERNANCE_TENANCY_ATTACHMENTS}`,
            )
        }

        const offset = decodeOffset(page.cursor)
        const limit = Math.min(page.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
        const slice = items.slice(offset, offset + limit)
        const end = offset + slice.length
        return {items: slice, nextCursor: end < items.length ? String(end) : null}
    }
}

function decodeOffset(cursor: string | undefined): number {
    if (cursor === undefined || cursor === '') return 0
    if (!/^\d+$/.test(cursor)) throw new ValidationError('cursor is not valid for this collection')
    return Number(cursor)
}

function toCriterionItem(criterion: OciInclusionCriterion): ChildItem {
    return {
        id: criterion.id ?? '',
        collectionId: OCI_GOVERNANCE_INCLUSION_CRITERIA,
        timestamp: criterion.timeCreated ?? null,
        body: compact({
            type: criterion.type,
            tenancyId: criterion.association?.tenancyId,
            lifecycleState: criterion.lifecycleState,
            timeCreated: criterion.timeCreated,
            timeUpdated: criterion.timeUpdated,
        }),
        metadata: {ocid: criterion.id},
    }
}

function toAttachmentItem(attachment: OciTenancyAttachment): ChildItem {
    return {
        id: attachment.id ?? '',
        collectionId: OCI_GOVERNANCE_TENANCY_ATTACHMENTS,
        timestamp: attachment.timeCreated ?? null,
        body: compact({
            tenancyId: attachment.tenancyId,
            lifecycleState: attachment.lifecycleState,
            timeCreated: attachment.timeCreated,
            timeUpdated: attachment.timeUpdated,
        }),
        metadata: {ocid: attachment.id},
    }
}

function toResource(rule: OciGovernanceRule): CloudResource {
    return {
        id: rule.id ?? '',
        name: rule.displayName ?? '',
        cloud: 'oci',
        service: 'governance',
        type: rule.type ?? 'Governance rule',
        // Governance rules are tenancy wide, not regional.
        region: null,
        createdAt: rule.timeCreated ?? null,
        status: rule.lifecycleState ?? null,
        metadata: compact({
            provider: 'oci',
            ocid: rule.id,
            compartmentId: rule.compartmentId,
            description: rule.description,
            creationOption: rule.creationOption,
            template: rule.template,
            timeUpdated: rule.timeUpdated,
        }),
    }
}

/** A rule id is `ocid1.governancerule...`; anything else never reaches the runtime. */
function assertRuleId(id: string): void {
    const [version, type] = id.split('.')
    if (version !== 'ocid1' || type !== 'governancerule') {
        throw new ValidationError(`Expected the OCID of a governance rule, got "${id}"`)
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized)
        || resource.id.toLowerCase().includes(normalized)
        || resource.type.toLowerCase().includes(normalized))
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null))
}
