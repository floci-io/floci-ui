import {NotFoundError, NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {gcpIdentityPlatformSchema} from '../cloud-spi/cognitoSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
    UpdateResourceInput,
} from '../cloud-spi/types'

/**
 * Identity Platform (Firebase Auth) users through the Floci-GCP emulator, which
 * serves the Identity Toolkit v1 admin API. Verified against `floci/floci-gcp`:
 *
 *   GET  /identitytoolkit.googleapis.com/v1/projects/{p}/accounts:batchGet   -> {users?, nextPageToken?}, no `users` when empty
 *   POST /identitytoolkit.googleapis.com/v1/projects/{p}/accounts:lookup     -> {users?}, no `users` for an unknown id
 *   POST /identitytoolkit.googleapis.com/v1/projects/{p}/accounts:update     -> {disableUser}
 *   POST /identitytoolkit.googleapis.com/v1/projects/{p}/accounts:delete
 *
 * Every admin call needs `Authorization: Bearer owner`. An unknown id on update
 * or delete answers 400 `USER_NOT_FOUND`, which is mapped to a not-found error.
 * The runtime returns `passwordHash` and `salt` on every user, so resources are
 * built from named fields and those two are never copied.
 */

const ADMIN_HEADERS = {authorization: 'Bearer owner', 'content-type': 'application/json'}
const PAGE_SIZE = 1000
/** Bound on `nextPageToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100
const USER_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,128}$/
const STATES = ['enabled', 'disabled'] as const

interface IdentityProviderInfo {
    providerId?: string
    rawId?: string
    federatedId?: string
    email?: string
    displayName?: string
    photoUrl?: string
    phoneNumber?: string
}

interface IdentityUser {
    localId?: string
    email?: string
    emailVerified?: boolean
    displayName?: string
    photoUrl?: string
    phoneNumber?: string
    disabled?: boolean
    createdAt?: string
    lastLoginAt?: string
    lastRefreshAt?: string
    passwordUpdatedAt?: number | string
    validSince?: string
    customAttributes?: string
    providerUserInfo?: IdentityProviderInfo[]
}

interface IdentityUserList {
    users?: IdentityUser[]
    nextPageToken?: string
}

export class GcpIdentityPlatformAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'cognito' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpIdentityPlatformSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const users: IdentityUser[] = []
        let token: string | undefined
        for (let hop = 0; ; hop += 1) {
            if (hop === MAX_PAGES) {
                throw new RuntimeError(`Identity Platform kept returning pages after ${MAX_PAGES}; refusing a partial list`)
            }
            const params = new URLSearchParams({maxResults: String(PAGE_SIZE)})
            if (token) params.set('nextPageToken', token)
            const page = await this.client.json<IdentityUserList>(`${this.accountsPath()}:batchGet?${params}`, {
                headers: ADMIN_HEADERS,
            })
            users.push(...(page?.users ?? []))
            token = page?.nextPageToken || undefined
            if (!token) break
        }
        return filterBySearch(users.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const userId = userIdOf(id)
        const result = await this.client.json<IdentityUserList>(`${this.accountsPath()}:lookup`, {
            method: 'POST',
            headers: ADMIN_HEADERS,
            body: JSON.stringify({localId: [userId]}),
        })
        const user = result?.users?.[0]
        return user ? toResource(user) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Identity Platform users are created by the applications that sign them up')
    }

    async update(id: string, input: UpdateResourceInput): Promise<CloudResource> {
        const userId = userIdOf(id)
        const state = input.values.state
        if (typeof state !== 'string' || !(STATES as readonly string[]).includes(state)) {
            throw new ValidationError(`state must be one of ${STATES.join(', ')}`)
        }
        await this.admin('update', {localId: userId, disableUser: state === 'disabled'})

        const updated = await this.get(userId)
        if (!updated) throw new RuntimeError('Identity Platform did not return the updated user')
        return updated
    }

    async delete(id: string): Promise<void> {
        await this.admin('delete', {localId: userIdOf(id)})
    }

    /** `accounts:update` and `accounts:delete` answer 400 USER_NOT_FOUND for an unknown user. */
    private async admin(action: 'update' | 'delete', body: Record<string, unknown>): Promise<void> {
        try {
            await this.client.fetch(`${this.accountsPath()}:${action}`, {
                method: 'POST',
                headers: ADMIN_HEADERS,
                body: JSON.stringify(body),
            })
        } catch (error) {
            if (error instanceof ValidationError && error.message.includes('USER_NOT_FOUND')) {
                throw new NotFoundError(`User ${String(body.localId)} not found`, {cause: error})
            }
            throw error
        }
    }

    private accountsPath(): string {
        return `/identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(this.client.project)}/accounts`
    }
}

function toResource(user: IdentityUser): CloudResource {
    const id = user.localId ?? ''
    const providers = user.providerUserInfo ?? []
    const state = user.disabled ? 'disabled' : 'enabled'
    return {
        id,
        name: user.email || user.displayName || id,
        cloud: 'gcp',
        service: 'cognito',
        type: 'user',
        region: null,
        createdAt: epochMillisToIso(user.createdAt),
        status: state,
        metadata: {
            provider: 'gcp',
            uid: id,
            state,
            email: user.email ?? null,
            emailVerified: user.emailVerified ?? false,
            displayName: user.displayName ?? null,
            photoUrl: user.photoUrl ?? null,
            phoneNumber: user.phoneNumber ?? null,
            providers: providers.map((info) => info.providerId).filter((value): value is string => !!value),
            providerInfo: providers.map((info) => ({
                providerId: info.providerId ?? null,
                rawId: info.rawId ?? null,
                federatedId: info.federatedId ?? null,
                email: info.email ?? null,
                displayName: info.displayName ?? null,
            })),
            customAttributes: user.customAttributes ?? null,
            lastLoginAt: epochMillisToIso(user.lastLoginAt),
            lastRefreshAt: user.lastRefreshAt ?? null,
            passwordUpdatedAt: epochMillisToIso(user.passwordUpdatedAt),
            validSince: epochSecondsToIso(user.validSince),
        },
    }
}

function epochMillisToIso(value: string | number | undefined): string | null {
    if (value === undefined || value === '') return null
    const millis = Number(value)
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null
}

function epochSecondsToIso(value: string | undefined): string | null {
    if (!value) return null
    const seconds = Number(value)
    return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null
}

function userIdOf(value: unknown): string {
    if (typeof value !== 'string' || !USER_ID_PATTERN.test(value)) {
        throw new ValidationError('A user id is 1 to 128 letters, digits and . _ : @ - characters')
    }
    return value
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter(
        (resource) =>
            resource.name.toLowerCase().includes(normalized) ||
            resource.id.toLowerCase().includes(normalized) ||
            String(resource.metadata.displayName ?? '').toLowerCase().includes(normalized),
    )
}
