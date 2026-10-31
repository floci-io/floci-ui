import {afterEach, describe, expect, test} from 'bun:test'
import {GcpIdentityAdapter} from './GcpIdentityAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const PROJECT = 'floci-local'
const ACCOUNTS = `/v1/projects/${PROJECT}/serviceAccounts`
const ROLES = `/v1/projects/${PROJECT}/roles`
const EMAIL = `build-bot@${PROJECT}.iam.gserviceaccount.com`

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpIdentityAdapter {
    return new GcpIdentityAdapter(new GcpRestRuntimeClient(ENDPOINT, PROJECT, 'us-central1'))
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

/** Records each request as `METHOD path?query` and answers from the first matching route. */
function runtimeStub(routes: Record<string, (init?: RequestInit) => Response>) {
    const calls: Array<{key: string; body?: unknown}> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        const key = `${init?.method ?? 'GET'} ${url.pathname}`
        calls.push({key: `${key}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : undefined})
        const route = routes[key]
        return route ? route(init) : json({error: {code: 404, message: 'not found'}}, 404)
    }) as unknown as typeof fetch
    return calls
}

/** Shapes captured from floci-gcp 0.12.0. */
function account(accountId = 'build-bot', overrides: Record<string, unknown> = {}) {
    return {
        name: `projects/${PROJECT}/serviceAccounts/${accountId}@${PROJECT}.iam.gserviceaccount.com`,
        projectId: PROJECT,
        uniqueId: '138595842831551569833',
        email: `${accountId}@${PROJECT}.iam.gserviceaccount.com`,
        displayName: 'Build bot',
        description: 'CI identity',
        createTime: '2026-10-31T19:19:06.512188464Z',
        etag: 'b40d7f33',
        ...overrides,
    }
}

function role(roleId = 'bucketReader', overrides: Record<string, unknown> = {}) {
    return {
        name: `projects/${PROJECT}/roles/${roleId}`,
        title: 'Bucket reader',
        description: 'Reads buckets',
        stage: 'GA',
        etag: 'EmU3a7gyJTk=',
        ...overrides,
    }
}

describe('GcpIdentityAdapter', () => {
    test('advertises list, create, delete and inspect with a kind facet', () => {
        const schema = adapter().schema()
        expect(schema.actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(schema.filters?.find((filter) => filter.name === 'kind')?.options?.map((option) => option.value))
            .toEqual(['serviceAccounts', 'roles'])
    })

    test('lists service accounts with their email and display name', async () => {
        runtimeStub({[`GET ${ACCOUNTS}`]: () => json({accounts: [account()]}), [`GET ${ROLES}`]: () => json({})})

        const resources = await adapter().list()

        expect(resources).toEqual([{
            id: EMAIL,
            name: 'build-bot',
            cloud: 'gcp',
            service: 'identity',
            type: 'serviceAccount',
            region: null,
            createdAt: '2026-10-31T19:19:06.512188464Z',
            status: 'ENABLED',
            metadata: {
                provider: 'gcp',
                kind: 'serviceAccount',
                resourcePath: `projects/${PROJECT}/serviceAccounts/${EMAIL}`,
                email: EMAIL,
                displayName: 'Build bot',
                description: 'CI identity',
                projectId: PROJECT,
                uniqueId: '138595842831551569833',
                etag: 'b40d7f33',
            },
        }])
    })

    test('lists custom roles, and an empty project answers {} for roles', async () => {
        runtimeStub({[`GET ${ACCOUNTS}`]: () => json({accounts: []}), [`GET ${ROLES}`]: () => json({roles: [role()]})})
        const [first] = await adapter().list()
        expect(first).toMatchObject({id: 'bucketReader', name: 'bucketReader', type: 'role', status: 'GA'})
        expect(first?.metadata.displayName).toBe('Bucket reader')

        runtimeStub({[`GET ${ACCOUNTS}`]: () => json({accounts: []}), [`GET ${ROLES}`]: () => json({})})
        expect(await adapter().list()).toEqual([])
    })

    test('the kind facet lists only that kind', async () => {
        const calls = runtimeStub({[`GET ${ACCOUNTS}`]: () => json({accounts: [account()]})})

        const resources = await adapter().list({filters: {kind: 'serviceAccounts'}})

        expect(resources.map((resource) => resource.type)).toEqual(['serviceAccount'])
        expect(calls.some((call) => call.key.includes('/roles'))).toBe(false)
        await expect(adapter().list({filters: {kind: 'groups'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('search matches name, email and role id, case insensitively', async () => {
        runtimeStub({
            [`GET ${ACCOUNTS}`]: () => json({accounts: [account('build-bot'), account('deploy-bot')]}),
            [`GET ${ROLES}`]: () => json({roles: [role('BucketReader')]}),
        })

        expect((await adapter().list({search: 'DEPLOY'})).map((resource) => resource.name)).toEqual(['deploy-bot'])
        expect((await adapter().list({search: 'bucketreader'})).map((resource) => resource.name)).toEqual(['BucketReader'])
    })

    test('follows nextPageToken and fails instead of returning a partial list', async () => {
        const calls = runtimeStub({
            [`GET ${ACCOUNTS}`]: () => {
                const token = calls.filter((call) => call.key.startsWith(`GET ${ACCOUNTS}`)).length
                return token === 1
                    ? json({accounts: [account('first-bot')], nextPageToken: 'p2'})
                    : json({accounts: [account('second-bot')]})
            },
        })

        const resources = await adapter().list({filters: {kind: 'serviceAccounts'}})

        expect(resources.map((resource) => resource.name)).toEqual(['first-bot', 'second-bot'])
        expect(calls[1]?.key).toContain('pageToken=p2')

        runtimeStub({[`GET ${ACCOUNTS}`]: () => json({error: {message: 'boom'}}, 500)})
        await expect(adapter().list({filters: {kind: 'serviceAccounts'}})).rejects.toBeInstanceOf(RuntimeError)
    })

    test('hides soft-deleted roles from the list', async () => {
        runtimeStub({
            [`GET ${ACCOUNTS}`]: () => json({}),
            [`GET ${ROLES}`]: () => json({roles: [role('live'), role('gone', {deleted: true})]}),
        })
        expect((await adapter().list()).map((resource) => resource.name)).toEqual(['live'])
    })

    test('flags a disabled service account', async () => {
        runtimeStub({[`GET ${ACCOUNTS}`]: () => json({accounts: [account('off-bot', {disabled: true})]})})
        const [resource] = await adapter().list({filters: {kind: 'serviceAccounts'}})
        expect(resource).toMatchObject({status: 'DISABLED', metadata: {disabled: true}})
    })

    test('get reads a service account by email and a role by id', async () => {
        runtimeStub({
            [`GET ${ACCOUNTS}/${encodeURIComponent(EMAIL)}`]: () => json(account()),
            [`GET ${ROLES}/bucketReader`]: () => json(role('bucketReader', {includedPermissions: ['storage.buckets.get']})),
        })

        expect((await adapter().get(EMAIL))?.metadata.email).toBe(EMAIL)
        expect((await adapter().get('bucketReader'))?.metadata.includedPermissions).toEqual(['storage.buckets.get'])
    })

    test('get returns null for an unknown or soft-deleted identity', async () => {
        runtimeStub({[`GET ${ROLES}/gone`]: () => json(role('gone', {deleted: true}))})
        expect(await adapter().get('gone')).toBeNull()
        expect(await adapter().get('missing')).toBeNull()
        expect(await adapter().get(`nobody@${PROJECT}.iam.gserviceaccount.com`)).toBeNull()
    })

    test('creates a service account with the accountId and its details', async () => {
        const calls = runtimeStub({[`POST ${ACCOUNTS}`]: () => json(account())})

        const created = await adapter().create({
            values: {kind: 'serviceAccounts', accountId: 'build-bot', displayName: ' Build bot ', description: 'CI identity'},
        })

        expect(created.id).toBe(EMAIL)
        expect(calls[0]?.body).toEqual({
            accountId: 'build-bot',
            serviceAccount: {displayName: 'Build bot', description: 'CI identity'},
        })
    })

    test('rejects a service account id the real API would refuse', async () => {
        const calls = runtimeStub({})
        for (const accountId of ['short', 'Upper-case', '1starts-with-digit', 'ends-with-hyphen-', 'x'.repeat(31), undefined]) {
            await expect(adapter().create({values: {kind: 'serviceAccounts', accountId}})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('creates a custom role, splitting permissions one per line', async () => {
        const calls = runtimeStub({[`POST ${ROLES}`]: () => json(role('bucketReader', {includedPermissions: ['a.b.c', 'd.e.f']}))})

        const created = await adapter().create({
            values: {kind: 'roles', roleId: 'bucketReader', title: 'Bucket reader', includedPermissions: 'a.b.c\r\n\n d.e.f '},
        })

        expect(created).toMatchObject({id: 'bucketReader', type: 'role'})
        expect(calls[0]?.body).toEqual({
            roleId: 'bucketReader',
            role: {title: 'Bucket reader', includedPermissions: ['a.b.c', 'd.e.f'], stage: 'GA'},
        })
    })

    test('validates role input before calling the runtime', async () => {
        const calls = runtimeStub({})
        const bad = [
            {kind: 'roles', roleId: 'no', title: 't'},
            {kind: 'roles', roleId: 'has space', title: 't'},
            {kind: 'roles', roleId: 'okRole'},
            {kind: 'roles', roleId: 'okRole', title: 't', stage: 'STABLE'},
            {kind: 'roles', roleId: 'okRole', title: 't', includedPermissions: 5},
            {kind: 'groups', roleId: 'okRole'},
        ]
        for (const values of bad) {
            await expect(adapter().create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('surfaces a duplicate as a conflict', async () => {
        runtimeStub({[`POST ${ACCOUNTS}`]: () => json({error: {code: 409, message: 'already exists'}}, 409)})
        await expect(adapter().create({values: {kind: 'serviceAccounts', accountId: 'build-bot'}}))
            .rejects.toMatchObject({name: expect.stringMatching(/Conflict/)})
    })

    test('deletes a service account and a role, and ignores one that is already gone', async () => {
        const calls = runtimeStub({
            [`DELETE ${ACCOUNTS}/${encodeURIComponent(EMAIL)}`]: () => json({}),
            [`GET ${ROLES}/bucketReader`]: () => json(role('bucketReader')),
            [`DELETE ${ROLES}/bucketReader`]: () => json(role('bucketReader', {deleted: true})),
        })

        await adapter().delete(EMAIL)
        await adapter().delete('bucketReader')
        await adapter().delete('missing')
        await adapter().delete(`nobody@${PROJECT}.iam.gserviceaccount.com`)

        expect(calls.filter((call) => call.key.startsWith('DELETE'))).toHaveLength(3)
        await expect(adapter().delete('')).rejects.toBeInstanceOf(ValidationError)
    })

    test('deleting a role that is already soft-deleted does not call delete again', async () => {
        const calls = runtimeStub({
            [`GET ${ROLES}/gone`]: () => json(role('gone', {deleted: true})),
            [`DELETE ${ROLES}/gone`]: () => json({error: {code: 400, message: 'already deleted'}}, 400),
        })

        await adapter().delete('gone')

        expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false)
    })

    test('a role deleted by a concurrent request counts as deleted, a refused one still fails', async () => {
        let reads = 0
        runtimeStub({
            [`GET ${ROLES}/raced`]: () => json(++reads === 1 ? role('raced') : role('raced', {deleted: true})),
            [`DELETE ${ROLES}/raced`]: () => json({error: {code: 400, message: 'already deleted'}}, 400),
        })
        await adapter().delete('raced')

        runtimeStub({
            [`GET ${ROLES}/stuck`]: () => json(role('stuck')),
            [`DELETE ${ROLES}/stuck`]: () => json({error: {code: 400, message: 'refused'}}, 400),
        })
        await expect(adapter().delete('stuck')).rejects.toBeInstanceOf(ValidationError)
    })

    test('never requests service account keys and never copies key material', async () => {
        const calls = runtimeStub({
            [`GET ${ACCOUNTS}`]: () => json({accounts: [account('build-bot', {privateKeyData: 'c2VjcmV0', keys: [{privateKeyData: 'c2VjcmV0'}]})]}),
            [`GET ${ACCOUNTS}/${encodeURIComponent(EMAIL)}`]: () => json(account('build-bot', {privateKeyData: 'c2VjcmV0'})),
            [`POST ${ACCOUNTS}`]: () => json(account('build-bot', {privateKeyData: 'c2VjcmV0'})),
            [`GET ${ROLES}`]: () => json({}),
        })

        const listed = await adapter().list()
        const inspected = await adapter().get(EMAIL)
        const created = await adapter().create({values: {kind: 'serviceAccounts', accountId: 'build-bot'}})

        expect(calls.every((call) => !call.key.includes('/keys'))).toBe(true)
        for (const value of [listed, inspected, created]) {
            expect(JSON.stringify(value)).not.toMatch(/privateKey|c2VjcmV0/)
        }
    })

    test('exposes only typed errors for an unreachable runtime', async () => {
        globalThis.fetch = (async () => {
            throw new Error('connect ECONNREFUSED')
        }) as unknown as typeof fetch
        await expect(adapter().list()).rejects.not.toBeInstanceOf(NotFoundError)
        await expect(adapter().list()).rejects.toThrow(/Cannot reach Floci-GCP/)
    })
})
