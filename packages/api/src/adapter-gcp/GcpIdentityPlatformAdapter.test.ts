import {afterEach, describe, expect, test} from 'bun:test'
import {GcpIdentityPlatformAdapter} from './GcpIdentityPlatformAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, NotSupportedError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const ACCOUNTS = '/identitytoolkit.googleapis.com/v1/projects/floci-local/accounts'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpIdentityPlatformAdapter {
    return new GcpIdentityPlatformAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function user(localId: string, overrides: Record<string, unknown> = {}) {
    return {
        localId,
        email: `${localId}@example.com`,
        emailVerified: false,
        passwordHash: 'fakeHash:salt=s:password=secret123',
        salt: 'fakeSalt',
        passwordUpdatedAt: 1794538179797,
        validSince: '1794538179',
        createdAt: '1794538179797',
        lastLoginAt: '1794538200000',
        lastRefreshAt: '2026-11-13T02:49:39.802295129Z',
        providerUserInfo: [{providerId: 'password', rawId: `${localId}@example.com`, email: `${localId}@example.com`}],
        ...overrides,
    }
}

interface Sent {
    method: string
    url: string
    headers: Record<string, string>
    body?: Record<string, unknown>
}

function record(respond: (sent: Sent) => Response): Sent[] {
    const calls: Sent[] = []
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
        const sent = {
            method: init?.method ?? 'GET',
            url: String(input).replace(ENDPOINT, ''),
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        }
        calls.push(sent)
        return respond(sent)
    }) as unknown as typeof fetch
    return calls
}

const notFound = () => json({error: {code: 400, message: 'USER_NOT_FOUND'}}, 400)

describe('GcpIdentityPlatformAdapter list and get', () => {
    test('an empty project answers no users field and lists nothing', async () => {
        const calls = record(() => json({kind: 'identitytoolkit#DownloadAccountResponse'}))
        expect(await adapter().list()).toEqual([])
        expect(calls[0].url).toBe(`${ACCOUNTS}:batchGet?maxResults=1000`)
        expect(calls[0].headers.authorization).toBe('Bearer owner')
    })

    test('maps email, providers, state and timestamps', async () => {
        record(() => json({users: [user('u1'), user('u2', {disabled: true})]}))
        const [first, second] = await adapter().list()

        expect(first.id).toBe('u1')
        expect(first.name).toBe('u1@example.com')
        expect(first.type).toBe('user')
        expect(first.status).toBe('enabled')
        expect(first.createdAt).toBe(new Date(1794538179797).toISOString())
        expect(first.metadata.providers).toEqual(['password'])
        expect(first.metadata.lastLoginAt).toBe(new Date(1794538200000).toISOString())
        expect(first.metadata.validSince).toBe(new Date(1794538179 * 1000).toISOString())
        expect(second.status).toBe('disabled')
        expect(second.metadata.state).toBe('disabled')
    })

    test('never carries the password hash or salt', async () => {
        record(() => json({users: [user('u1')]}))
        const [resource] = await adapter().list()
        const text = JSON.stringify(resource)

        expect(text).not.toContain('fakeHash')
        expect(text).not.toContain('secret123')
        expect(text).not.toContain('fakeSalt')
        expect(resource.metadata).not.toHaveProperty('passwordHash')
        expect(resource.metadata).not.toHaveProperty('salt')
    })

    test('an anonymous user has no email or providers and is named by its id', async () => {
        record(() =>
            json({users: [{localId: 'anon1', createdAt: '1794538234954', lastLoginAt: '1794538234954'}]}),
        )
        const [resource] = await adapter().list()

        expect(resource.name).toBe('anon1')
        expect(resource.metadata.email).toBeNull()
        expect(resource.metadata.providers).toEqual([])
    })

    test('follows nextPageToken across pages', async () => {
        const calls = record((sent) =>
            sent.url.includes('nextPageToken=t1') ? json({users: [user('b')]}) : json({users: [user('a')], nextPageToken: 't1'}),
        )
        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['a', 'b'])
        expect(calls[1].url).toBe(`${ACCOUNTS}:batchGet?maxResults=1000&nextPageToken=t1`)
    })

    test('refuses a partial list when the runtime never stops paging', async () => {
        record(() => json({users: [user('a')], nextPageToken: 'again'}))
        await expect(adapter().list()).rejects.toThrow('refusing a partial list')
    })

    test('filters by email, id and display name', async () => {
        record(() => json({users: [user('alice'), user('bob', {displayName: 'Robert'})]}))
        expect((await adapter().list({search: 'ALI'})).map((resource) => resource.id)).toEqual(['alice'])
        expect((await adapter().list({search: 'robert'})).map((resource) => resource.id)).toEqual(['bob'])
    })

    test('inspect looks the user up by id and keeps provider details', async () => {
        const calls = record(() => json({users: [user('u1', {customAttributes: '{"role":"admin"}'})]}))
        const resource = await adapter().get('u1')

        expect(calls[0].method).toBe('POST')
        expect(calls[0].url).toBe(`${ACCOUNTS}:lookup`)
        expect(calls[0].body).toEqual({localId: ['u1']})
        expect(resource?.metadata.providerInfo).toEqual([
            {providerId: 'password', rawId: 'u1@example.com', federatedId: null, email: 'u1@example.com', displayName: null},
        ])
        expect(resource?.metadata.customAttributes).toBe('{"role":"admin"}')
    })

    test('an unknown user is null', async () => {
        record(() => json({kind: 'identitytoolkit#GetAccountInfoResponse'}))
        expect(await adapter().get('ghost')).toBeNull()
    })

    test('an id that is not a user id never reaches the runtime', async () => {
        const calls = record(() => json({}))
        await expect(adapter().get('a/../b')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().delete('')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })
})

describe('GcpIdentityPlatformAdapter update, delete and create', () => {
    test('disables a user and reads it back', async () => {
        const calls = record((sent) =>
            sent.url.endsWith(':update') ? json({localId: 'u1'}) : json({users: [user('u1', {disabled: true})]}),
        )
        const updated = await adapter().update('u1', {values: {state: 'disabled'}})

        expect(calls[0].url).toBe(`${ACCOUNTS}:update`)
        expect(calls[0].body).toEqual({localId: 'u1', disableUser: true})
        expect(calls[0].headers.authorization).toBe('Bearer owner')
        expect(updated.status).toBe('disabled')
    })

    test('enables a user', async () => {
        const calls = record((sent) => (sent.url.endsWith(':update') ? json({}) : json({users: [user('u1')]})))
        await adapter().update('u1', {values: {state: 'enabled'}})
        expect(calls[0].body).toEqual({localId: 'u1', disableUser: false})
    })

    test('rejects a bad state and sends nothing', async () => {
        const calls = record(() => json({}))
        await expect(adapter().update('u1', {values: {state: 'banned'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().update('u1', {values: {}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('updating an unknown user is not found', async () => {
        record(notFound)
        await expect(adapter().update('ghost', {values: {state: 'disabled'}})).rejects.toBeInstanceOf(NotFoundError)
    })

    test('deletes by user id', async () => {
        const calls = record(() => json({kind: 'identitytoolkit#DeleteAccountResponse'}))
        await adapter().delete('u1')

        expect(calls[0].method).toBe('POST')
        expect(calls[0].url).toBe(`${ACCOUNTS}:delete`)
        expect(calls[0].body).toEqual({localId: 'u1'})
    })

    test('deleting an unknown user is not found', async () => {
        record(notFound)
        await expect(adapter().delete('ghost')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('creating a user is not offered', async () => {
        await expect(adapter().create({values: {}})).rejects.toBeInstanceOf(NotSupportedError)
    })

    test('the schema advertises exactly what the adapter performs', () => {
        const schema = adapter().schema()
        expect(schema.actions).toEqual(['list', 'update', 'delete', 'inspect'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name)).toEqual(schema.actions)
    })
})
