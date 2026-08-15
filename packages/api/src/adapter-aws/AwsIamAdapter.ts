import {
    CreatePolicyCommand,
    CreateRoleCommand,
    CreateUserCommand,
    DeletePolicyCommand,
    DeleteRoleCommand,
    DeleteUserCommand,
    GetPolicyCommand,
    GetPolicyVersionCommand,
    GetRoleCommand,
    GetUserCommand,
    type IAMClient,
    ListPoliciesCommand,
    ListRolesCommand,
    ListUsersCommand,
    type Policy,
    type Role,
    type User,
} from '@aws-sdk/client-iam'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {awsIamSchema, IAM_KIND_SINGULAR, IAM_KINDS, type IamKind} from '../cloud-spi/iamSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * IAM holds three kinds of resource under one service, which shapes the whole
 * adapter:
 *
 *  - `list` honours the `kind` facet from `ResourceQuery.filters`. With no facet
 *    it lists users, roles and policies together, which is what an audit view
 *    wants; with one it issues a single List call.
 *  - Resource ids are `{kind}/{identifier}` — `user/alice`, `role/deployer`,
 *    `policy/{arn}`. A bare name would be ambiguous across kinds and would not
 *    tell `get` or `delete` which API to call. Policies are keyed by ARN because
 *    that is what GetPolicy and DeletePolicy take. The ids survive the generic
 *    route because HttpClient encodes path params.
 *  - Policies are listed with `Scope: 'Local'`. Real IAM otherwise returns close
 *    to a thousand AWS-managed policies and buries the account's own.
 */
type Identity =
    | {kind: 'users'; value: User}
    | {kind: 'roles'; value: Role}
    | {kind: 'policies'; value: Policy}

const SINGULAR_TO_KIND: Record<string, IamKind> = {user: 'users', role: 'roles', policy: 'policies'}

/** A policy's document, or the fact that it could not be read. */
type DocumentLookup = {document?: string; unavailable?: true}

export class AwsIamAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'iam' as const

    constructor(private readonly iam: IAMClient) {}

    schema(): ServiceSchema {
        return awsIamSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const kinds = kind ? [kind] : [...IAM_KINDS]

        const groups = await Promise.all(kinds.map((each) => this.listKind(each)))
        // Not `.map(toResource)`: map would pass the index as the document argument.
        return filterBySearch(
            groups.flat().map((identity) => toResource(identity)),
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const {kind, identifier} = parseId(id)

        try {
            if (kind === 'users') {
                const res = await this.iam.send(new GetUserCommand({UserName: identifier}))
                return res.User ? toResource({kind, value: res.User}) : null
            }
            if (kind === 'roles') {
                const res = await this.iam.send(new GetRoleCommand({RoleName: identifier}))
                return res.Role ? toResource({kind, value: res.Role}) : null
            }
            const res = await this.iam.send(new GetPolicyCommand({PolicyArn: identifier}))
            if (!res.Policy) return null
            // Only on inspect: one GetPolicyVersion per row would make list an N+1.
            return toResource({kind, value: res.Policy}, await this.policyDocument(res.Policy))
        } catch (error) {
            if (isNoSuchEntity(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const kind = requiredKind(input.values.kind)
        const name = requiredString(input.values.name, 'name')
        const path = optionalString(input.values.path, 'path')

        if (kind === 'users') {
            const res = await this.iam.send(new CreateUserCommand({UserName: name, ...(path ? {Path: path} : {})}))
            return this.created(res.User ? {kind, value: res.User} : null, name)
        }

        if (kind === 'roles') {
            const document = requiredJson(
                input.values.assumeRolePolicyDocument,
                'assumeRolePolicyDocument',
                'roles',
            )
            const res = await this.iam.send(
                new CreateRoleCommand({
                    RoleName: name,
                    AssumeRolePolicyDocument: document,
                    ...(path ? {Path: path} : {}),
                }),
            )
            return this.created(res.Role ? {kind, value: res.Role} : null, name)
        }

        const document = requiredJson(input.values.policyDocument, 'policyDocument', 'policies')
        const res = await this.iam.send(
            new CreatePolicyCommand({PolicyName: name, PolicyDocument: document, ...(path ? {Path: path} : {})}),
        )
        return this.created(res.Policy ? {kind, value: res.Policy} : null, name)
    }

    async delete(id: string): Promise<void> {
        const {kind, identifier} = parseId(id)

        if (kind === 'users') {
            await this.iam.send(new DeleteUserCommand({UserName: identifier}))
            return
        }
        if (kind === 'roles') {
            await this.iam.send(new DeleteRoleCommand({RoleName: identifier}))
            return
        }
        await this.iam.send(new DeletePolicyCommand({PolicyArn: identifier}))
    }

    /**
     * Load the policy's default version so inspect can show the document, the way
     * a role shows its trust policy. Failure degrades the row rather than the
     * request — the policy metadata is worth showing without the body.
     */
    private async policyDocument(policy: Policy): Promise<DocumentLookup> {
        const arn = policy.Arn
        const versionId = policy.DefaultVersionId
        if (!arn || !versionId) return {}

        try {
            const res = await this.iam.send(new GetPolicyVersionCommand({PolicyArn: arn, VersionId: versionId}))
            return {document: decodePolicyDocument(res.PolicyVersion?.Document)}
        } catch {
            return {unavailable: true}
        }
    }

    private created(identity: Identity | null, name: string): CloudResource {
        if (!identity) throw new RuntimeError(`IAM did not return the created resource for ${name}`)
        return toResource(identity)
    }

    /** Every List call pages on IsTruncated/Marker. */
    private async listKind(kind: IamKind): Promise<Identity[]> {
        const identities: Identity[] = []
        let marker: string | undefined

        do {
            const page = await this.sendList(kind, marker)
            identities.push(...page.identities)
            marker = page.marker
        } while (marker)

        return identities
    }

    private async sendList(
        kind: IamKind,
        marker: string | undefined,
    ): Promise<{identities: Identity[]; marker?: string}> {
        const paging = marker ? {Marker: marker} : {}

        if (kind === 'users') {
            const res = await this.iam.send(new ListUsersCommand(paging))
            return {
                identities: (res.Users ?? []).map((value) => ({kind, value})),
                marker: res.IsTruncated ? res.Marker : undefined,
            }
        }
        if (kind === 'roles') {
            const res = await this.iam.send(new ListRolesCommand(paging))
            return {
                identities: (res.Roles ?? []).map((value) => ({kind, value})),
                marker: res.IsTruncated ? res.Marker : undefined,
            }
        }
        const res = await this.iam.send(new ListPoliciesCommand({Scope: 'Local', ...paging}))
        return {
            identities: (res.Policies ?? []).map((value) => ({kind, value})),
            marker: res.IsTruncated ? res.Marker : undefined,
        }
    }
}

function toResource(identity: Identity, policyDoc: DocumentLookup = {}): CloudResource {
    const singular = IAM_KIND_SINGULAR[identity.kind]
    const common = {
        cloud: 'aws' as const,
        service: 'iam' as const,
        region: null,
        status: null,
    }

    if (identity.kind === 'users') {
        const user = identity.value
        const name = user.UserName ?? ''
        return {
            ...common,
            id: `${singular}/${name}`,
            name,
            type: 'iam-user',
            createdAt: isoDate(user.CreateDate),
            metadata: {
                kind: singular,
                arn: user.Arn,
                path: user.Path,
                userId: user.UserId,
                passwordLastUsed: isoDate(user.PasswordLastUsed),
                tags: mapTags(user.Tags),
            },
        }
    }

    if (identity.kind === 'roles') {
        const role = identity.value
        const name = role.RoleName ?? ''
        return {
            ...common,
            id: `${singular}/${name}`,
            name,
            type: 'iam-role',
            createdAt: isoDate(role.CreateDate),
            metadata: {
                kind: singular,
                arn: role.Arn,
                path: role.Path,
                roleId: role.RoleId,
                description: role.Description,
                maxSessionDuration: role.MaxSessionDuration,
                // IAM returns this percent-encoded; raw, it is unreadable in the
                // inspector.
                assumeRolePolicyDocument: decodePolicyDocument(role.AssumeRolePolicyDocument),
                tags: mapTags(role.Tags),
            },
        }
    }

    const policy = identity.value
    const name = policy.PolicyName ?? ''
    return {
        ...common,
        // Keyed by ARN: GetPolicy and DeletePolicy take an ARN, not a name.
        id: `${singular}/${policy.Arn ?? name}`,
        name,
        type: 'iam-policy',
        createdAt: isoDate(policy.CreateDate),
        metadata: {
            kind: singular,
            arn: policy.Arn,
            path: policy.Path,
            policyId: policy.PolicyId,
            description: policy.Description,
            attachmentCount: policy.AttachmentCount,
            defaultVersionId: policy.DefaultVersionId,
            /** Only populated by inspect; list would be an N+1. */
            ...(policyDoc.document ? {policyDocument: policyDoc.document} : {}),
            ...(policyDoc.unavailable ? {policyDocumentUnavailable: true} : {}),
            updatedAt: isoDate(policy.UpdateDate),
            tags: mapTags(policy.Tags),
        },
    }
}

/** `user/alice`, `role/deployer`, `policy/arn:aws:iam::...:policy/read-buckets`. */
function parseId(id: string): {kind: IamKind; identifier: string} {
    const separator = id.indexOf('/')
    if (separator <= 0) {
        throw new ValidationError(`IAM id must be "kind/name", for example user/alice, got "${id}"`)
    }

    const prefix = id.slice(0, separator)
    const identifier = id.slice(separator + 1)
    const kind = SINGULAR_TO_KIND[prefix]

    if (!kind || !identifier) {
        throw new ValidationError(
            `IAM id must start with ${Object.keys(SINGULAR_TO_KIND).join(', ')}, got "${prefix}"`,
        )
    }
    return {kind, identifier}
}

function optionalKind(value: unknown): IamKind | undefined {
    if (value === undefined || value === null || value === '') return undefined
    return requiredKind(value)
}

function requiredKind(value: unknown): IamKind {
    const raw = requiredString(value, 'kind')
    if (!(IAM_KINDS as readonly string[]).includes(raw)) {
        throw new ValidationError(`kind must be one of ${IAM_KINDS.join(', ')}`)
    }
    return raw as IamKind
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter((resource) => {
        const arn = String(resource.metadata.arn ?? '').toLowerCase()
        return (
            resource.name.toLowerCase().includes(normalized) ||
            resource.id.toLowerCase().includes(normalized) ||
            arn.includes(normalized)
        )
    })
}

function decodePolicyDocument(document: string | undefined): string | undefined {
    if (!document) return undefined
    try {
        return decodeURIComponent(document)
    } catch {
        // A document that is not percent-encoded is returned as-is rather than lost.
        return document
    }
}

function mapTags(tags: Array<{Key?: string; Value?: string}> | undefined): Array<{key: string; value: string}> {
    return (tags ?? []).map((tag) => ({key: tag.Key ?? '', value: tag.Value ?? ''}))
}

function isoDate(date: Date | undefined): string | null {
    return date ? date.toISOString() : null
}

function requiredString(value: unknown, field: string): string {
    const raw = optionalString(value, field)
    if (raw === undefined) throw new ValidationError(`${field} is required`)
    return raw
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value.trim() || undefined
}

/**
 * IAM rejects a role without a trust policy and a policy without a document, so
 * the message names the field *and* the kind that requires it — the form shows
 * both fields for every kind.
 */
function requiredJson(value: unknown, field: string, kind: IamKind): string {
    const raw = optionalString(value, field)
    if (raw === undefined) throw new ValidationError(`${field} is required when kind is ${kind}`)

    try {
        JSON.parse(raw)
    } catch {
        throw new ValidationError(`${field} must be valid JSON`)
    }
    return raw
}

function isNoSuchEntity(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const name = (error as {name?: string}).name
    return name === 'NoSuchEntity' || name === 'NoSuchEntityException'
}
