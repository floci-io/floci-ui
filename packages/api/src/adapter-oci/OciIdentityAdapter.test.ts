import {afterEach, describe, expect, test} from 'bun:test'
import {OciIdentityAdapter} from './OciIdentityAdapter'
import {OciRestRuntimeClient} from '../oci'
import {ConflictError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const API = `${ENDPOINT}/20160918`
const COMPARTMENT = 'ocid1.compartment.oc1..aaaacompartment'
const USER = 'ocid1.user.oc1..aaaauser'
const GROUP = 'ocid1.group.oc1..aaaagroup'
const POLICY = 'ocid1.policy.oc1..aaaapolicy'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciIdentityAdapter {
    return new OciIdentityAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

function listing(url: string): Response {
    const path = new URL(url).pathname
    if (path.endsWith('/compartments')) {
        return json([
            {id: COMPARTMENT, name: 'dev', description: 'Development', lifecycleState: 'ACTIVE', compartmentId: TENANCY},
            {id: 'ocid1.compartment.oc1..gone', name: 'old', description: 'x', lifecycleState: 'DELETED'},
        ])
    }
    if (path.endsWith('/users')) {
        return json([{id: USER, name: 'alice', description: 'Alice', email: 'a@example.com', lifecycleState: 'ACTIVE', timeCreated: '2026-09-29T00:00:00Z'}])
    }
    if (path.endsWith('/groups')) return json([{id: GROUP, name: 'Developers', description: 'Devs', lifecycleState: 'ACTIVE'}])
    if (path.endsWith('/policies')) {
        return json([{id: POLICY, name: 'dev-policy', description: 'p', statements: ['Allow group Developers to read all-resources in tenancy'], lifecycleState: 'ACTIVE'}])
    }
    if (path.endsWith('/userGroupMemberships')) return json([{id: 'ocid1.groupmembership.oc1..m', userId: USER, groupId: GROUP}])
    return json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404})
}

describe('OciIdentityAdapter', () => {
    test('identifies itself as the OCI identity adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('identity')
        expect(instance.schema().displayName).toBe('OCI Identity')
    })

    test('lists every kind in the tenancy root compartment and hides deleted compartments', async () => {
        const calls = stubFetch(listing)
        const resources = await adapter().list()

        const urls = calls.map((c) => new URL(c.url))
        expect(urls.map((u) => u.pathname).sort()).toEqual([
            '/20160918/compartments',
            '/20160918/groups',
            '/20160918/policies',
            '/20160918/users',
        ])
        for (const url of urls) expect(url.searchParams.get('compartmentId')).toBe(TENANCY)
        expect(resources.map((r) => [r.type, r.name])).toEqual([
            ['compartment', 'dev'],
            ['user', 'alice'],
            ['group', 'Developers'],
            ['policy', 'dev-policy'],
        ])
    })

    test('maps a user to a resource keyed by OCID', async () => {
        stubFetch(listing)
        const [user] = await adapter().list({filters: {kind: 'users'}})

        expect(user).toMatchObject({
            id: USER,
            name: 'alice',
            cloud: 'oci',
            service: 'identity',
            type: 'user',
            region: null,
            status: 'ACTIVE',
            createdAt: '2026-09-29T00:00:00Z',
        })
        expect(user?.metadata).toMatchObject({ocid: USER, description: 'Alice', email: 'a@example.com', kind: 'user'})
    })

    test('lists only the requested kind', async () => {
        const calls = stubFetch(listing)
        const resources = await adapter().list({filters: {kind: 'policies'}})

        expect(calls).toHaveLength(1)
        expect(new URL(calls[0]!.url).pathname).toBe('/20160918/policies')
        expect(resources[0]?.metadata.statements).toEqual(['Allow group Developers to read all-resources in tenancy'])
    })

    test('rejects an unknown kind facet', async () => {
        const calls = stubFetch(listing)
        await expect(adapter().list({filters: {kind: 'roles'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toEqual([])
    })

    test('follows opc-next-page', async () => {
        const calls = stubFetch((url) => url.includes('page=p2')
            ? json([{id: 'ocid1.group.oc1..b', name: 'b'}])
            : json([{id: 'ocid1.group.oc1..a', name: 'a'}], {status: 200, headers: {'opc-next-page': 'p2'}}))
        const resources = await adapter().list({filters: {kind: 'groups'}})

        expect(calls).toHaveLength(2)
        expect(resources.map((r) => r.name)).toEqual(['a', 'b'])
    })

    test('filters by name or OCID', async () => {
        stubFetch(listing)
        expect((await adapter().list({search: 'ALI'})).map((r) => r.name)).toEqual(['alice'])
        expect((await adapter().list({search: 'aaaapolicy'})).map((r) => r.name)).toEqual(['dev-policy'])
    })

    test('get reads the kind from the OCID and returns the policy', async () => {
        const calls = stubFetch(() => json({id: POLICY, name: 'dev-policy', statements: ['Allow x'], lifecycleState: 'ACTIVE'}))
        const policy = await adapter().get(POLICY)

        expect(calls[0]?.url).toBe(`${API}/policies/${encodeURIComponent(POLICY)}`)
        expect(policy?.type).toBe('policy')
        expect(policy?.metadata.statements).toEqual(['Allow x'])
    })

    test('get on a user resolves its group names', async () => {
        const calls = stubFetch((url) => new URL(url).pathname.endsWith(`/users/${USER}`)
            ? json({id: USER, name: 'alice', description: 'Alice', lifecycleState: 'ACTIVE'})
            : listing(url))
        const user = await adapter().get(USER)

        const membershipCall = calls.find((c) => c.url.includes('/userGroupMemberships'))
        expect(new URL(membershipCall!.url).searchParams.get('userId')).toBe(USER)
        expect(new URL(membershipCall!.url).searchParams.get('compartmentId')).toBe(TENANCY)
        expect(user?.metadata.groups).toEqual([{id: GROUP, name: 'Developers'}])
    })

    test('get on a group resolves its member names', async () => {
        stubFetch((url) => new URL(url).pathname.endsWith(`/groups/${GROUP}`)
            ? json({id: GROUP, name: 'Developers', description: 'Devs', lifecycleState: 'ACTIVE'})
            : listing(url))
        const group = await adapter().get(GROUP)
        expect(group?.metadata.members).toEqual([{id: USER, name: 'alice'}])
    })

    test('get returns null for a missing resource or a deleted compartment', async () => {
        stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().get(USER)).resolves.toBeNull()

        stubFetch(() => json({id: COMPARTMENT, name: 'dev', lifecycleState: 'DELETED'}))
        await expect(adapter().get(COMPARTMENT)).resolves.toBeNull()
    })

    test('get rejects an id that is not an identity OCID', async () => {
        const calls = stubFetch(listing)
        await expect(adapter().get('alice')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().get('ocid1.bucket.oc1..x')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toEqual([])
    })

    test('creates a compartment under the tenancy', async () => {
        const calls = stubFetch(() => json({id: COMPARTMENT, name: 'dev', description: 'Development', lifecycleState: 'ACTIVE'}))
        const resource = await adapter().create({values: {kind: 'compartments', name: 'dev', description: 'Development'}})

        expect(calls[0]?.url).toBe(`${API}/compartments`)
        expect(calls[0]?.init?.method).toBe('POST')
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({compartmentId: TENANCY, name: 'dev', description: 'Development'})
        expect(resource).toMatchObject({id: COMPARTMENT, type: 'compartment', status: 'ACTIVE'})
    })

    test('creates a user with an optional email', async () => {
        const calls = stubFetch(() => json({id: USER, name: 'alice@example.com'}))
        await adapter().create({values: {kind: 'users', name: 'alice@example.com', description: 'Alice', email: 'alice@example.com'}})

        expect(calls[0]?.url).toBe(`${API}/users`)
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            compartmentId: TENANCY,
            name: 'alice@example.com',
            description: 'Alice',
            email: 'alice@example.com',
        })
    })

    test('creates a group without user-only fields', async () => {
        const calls = stubFetch(() => json({id: GROUP, name: 'Developers'}))
        await adapter().create({values: {kind: 'groups', name: 'Developers', description: 'Devs', email: 'ignored@example.com'}})

        expect(calls[0]?.url).toBe(`${API}/groups`)
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({compartmentId: TENANCY, name: 'Developers', description: 'Devs'})
    })

    test('creates a policy with one statement per non-blank line', async () => {
        const calls = stubFetch(() => json({id: POLICY, name: 'dev-policy'}))
        await adapter().create({values: {
            kind: 'policies',
            name: 'dev-policy',
            description: 'Dev access',
            statements: 'Allow group Developers to manage buckets in tenancy\r\n\n  Allow group Developers to read users in tenancy  \n',
        }})

        expect(calls[0]?.url).toBe(`${API}/policies`)
        expect(JSON.parse(String(calls[0]?.init?.body)).statements).toEqual([
            'Allow group Developers to manage buckets in tenancy',
            'Allow group Developers to read users in tenancy',
        ])
    })

    test('accepts policy statements as an array', async () => {
        const calls = stubFetch(() => json({id: POLICY, name: 'p'}))
        await adapter().create({values: {kind: 'policies', name: 'p', description: 'd', statements: ['Allow x']}})
        expect(JSON.parse(String(calls[0]?.init?.body)).statements).toEqual(['Allow x'])
    })

    test('validates input before calling the runtime', async () => {
        const calls = stubFetch(() => json({}))
        const create = (values: Record<string, unknown>) => adapter().create({values})

        await expect(create({name: 'x', description: 'd'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'roles', name: 'x', description: 'd'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'users', description: 'd'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'users', name: 'has space', description: 'd'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'groups', name: 'a@b', description: 'd'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'groups', name: 'x'.repeat(101), description: 'd'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'groups', name: 'g'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'groups', name: 'g', description: 'd'.repeat(401)})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'policies', name: 'p', description: 'd'})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'policies', name: 'p', description: 'd', statements: '  \n '})).rejects.toBeInstanceOf(ValidationError)
        await expect(create({kind: 'policies', name: 'p', description: 'd', statements: [1]})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toEqual([])
    })

    test('throws a runtime error when create returns no resource', async () => {
        stubFetch(() => json({}))
        await expect(adapter().create({values: {kind: 'groups', name: 'g', description: 'd'}})).rejects.toBeInstanceOf(RuntimeError)
    })

    test('maps a duplicate name to a conflict', async () => {
        stubFetch(() => json({code: 'Conflict', message: 'Group g already exists.'}, {status: 409}))
        await expect(adapter().create({values: {kind: 'groups', name: 'g', description: 'd'}})).rejects.toBeInstanceOf(ConflictError)
    })

    test('deletes a user by OCID', async () => {
        const calls = stubFetch(() => new Response(null, {status: 204}))
        await adapter().delete(USER)

        expect(calls[0]?.url).toBe(`${API}/users/${encodeURIComponent(USER)}`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })

    test('returns once a compartment delete is accepted', async () => {
        const calls = stubFetch(() => new Response(null, {status: 202, headers: {'opc-work-request-id': 'ocid1.workrequest.oc1..w'}}))
        await adapter().delete(COMPARTMENT)

        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe(`${API}/compartments/${encodeURIComponent(COMPARTMENT)}`)
    })

    test('surfaces a compartment with active children as a conflict', async () => {
        stubFetch(() => json({code: 'Conflict', message: 'has active child compartments'}, {status: 409}))
        await expect(adapter().delete(COMPARTMENT)).rejects.toBeInstanceOf(ConflictError)
    })

    test('treats deleting a missing resource as done', async () => {
        stubFetch(() => json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404}))
        await expect(adapter().delete(GROUP)).resolves.toBeUndefined()
    })

    test('refuses to delete the tenancy or a non-identity OCID', async () => {
        const calls = stubFetch(() => new Response(null, {status: 204}))
        await expect(adapter().delete(TENANCY)).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().delete('ocid1.instance.oc1..x')).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toEqual([])
    })
})
