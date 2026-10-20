import {describe, expect, test} from 'bun:test'
import {AzureKeyVaultAdapter} from './AzureKeyVaultAdapter'
import {NotFoundError, httpStatusToCloudError} from '../cloud-spi/errors'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'

interface RecordedCall {
    path: string
    init: RequestInit
    options: AzureRuntimeFetchOptions
}

describe('AzureKeyVaultAdapter', () => {
    test('lists and filters Key Vault secrets without exposing values', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets?api-version=7.4': {
                value: [listedSecretRecord('api-token')],
                nextLink: 'https://devstoreaccount1.vault.azure.net/secrets?api-version=7.4&next=page-2',
            },
            '/devstoreaccount1-keyvault/secrets?api-version=7.4&next=page-2': {
                value: [listedSecretRecord('database-password', {env: 'test'})],
                nextLink: null,
            },
        }, calls))

        await expect(adapter.list({search: 'database'})).resolves.toEqual([{
            id: 'database-password',
            name: 'database-password',
            cloud: 'azure',
            service: 'secrets',
            type: 'secret',
            region: null,
            createdAt: '2026-05-20T20:00:00.000Z',
            status: 'enabled',
            version: null,
            metadata: {
                provider: 'azure',
                secretsService: 'key-vault',
                vaultAccount: 'devstoreaccount1',
                contentType: 'text/plain',
                enabled: true,
                updatedAt: '2026-05-20T20:00:01.000Z',
                expiresAt: null,
                notBefore: null,
                recoveryLevel: 'Purgeable',
                recoverableDays: 7,
                tags: [{key: 'env', value: 'test'}],
            },
        }])
        expect(calls.map((call) => call.path)).toEqual([
            '/devstoreaccount1-keyvault/secrets?api-version=7.4',
            '/devstoreaccount1-keyvault/secrets?api-version=7.4&next=page-2',
        ])
        expect(calls.every((call) => call.options.includeStorageApiVersion === false)).toBe(true)
    })

    test('stops paging when the runtime echoes the current page as its nextLink', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets?api-version=7.4': {
                value: [listedSecretRecord('api-token')],
                nextLink: 'https://devstoreaccount1.vault.azure.net/secrets?api-version=7.4',
            },
        }, calls))

        await expect(adapter.list()).resolves.toHaveLength(1)
        expect(calls).toHaveLength(1)
    })

    test('gets a secret and omits its value from normalized metadata', async () => {
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/database-password?api-version=7.4': {
                ...secretRecord('database-password', 'v1'),
                value: 'super-secret',
            },
        }))

        const resource = await adapter.get('database-password')

        expect(resource).toMatchObject({id: 'database-password', version: 'v1'})
        expect(resource?.metadata).not.toHaveProperty('value')
    })

    test('creates secrets through the Azure Key Vault data-plane contract', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/api-key?api-version=7.4': {
                ...secretRecord('api-key', 'created-version'),
                value: 'abc123',
                contentType: 'application/json',
            },
        }, calls))

        const created = await adapter.create({values: {
            secretName: 'api-key',
            secretValue: 'abc123',
            contentType: 'application/json',
        }})

        expect(created).toMatchObject({id: 'api-key', version: 'created-version'})
        expect(calls).toHaveLength(1)
        expect(calls[0].path).toBe('/devstoreaccount1-keyvault/secrets/api-key?api-version=7.4')
        expect(calls[0].init.method).toBe('PUT')
        expect(calls[0].init.headers).toMatchObject({
            authorization: 'Bearer floci-ui',
            'content-type': 'application/json',
        })
        expect(calls[0].options.includeStorageApiVersion).toBe(false)
        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            value: 'abc123',
            contentType: 'application/json',
        })
    })

    test('deletes secrets using soft-delete endpoint', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/api-key?api-version=7.4': {},
        }, calls))

        await adapter.delete('api-key')

        expect(calls).toHaveLength(1)
        expect(calls[0].init.method).toBe('DELETE')
        expect(calls[0].init.headers).toMatchObject({authorization: 'Bearer floci-ui'})
        expect(calls[0].options.includeStorageApiVersion).toBe(false)
        expect(calls[0].options.emptyOnNotFound).toBeUndefined()
    })

    test('surfaces a delete of a secret that does not exist', async () => {
        const adapter = new AzureKeyVaultAdapter({
            endpoint: 'http://localhost:4577',
            accountName: 'devstoreaccount1',
            async fetch(path: string) {
                throw new Error(`Azure runtime request failed: HTTP 404 ${path}`)
            },
        })

        await expect(adapter.delete('missing')).rejects.toThrow('HTTP 404')
    })

    test('normalizes missing secrets to null and missing lists to empty', async () => {
        const adapter = new AzureKeyVaultAdapter(testClient({}))

        await expect(adapter.get('missing')).resolves.toBeNull()
        await expect(adapter.list()).resolves.toEqual([])
    })

    test('lists soft-deleted secrets from the deleted namespace without their values', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/deletedsecrets?api-version=7.4': {
                value: [{
                    ...listedSecretRecord('old-token'),
                    value: 'must-not-leak',
                    recoveryId: 'https://devstoreaccount1.vault.azure.net/deletedsecrets/old-token',
                    deletedDate: 1779307300,
                    scheduledPurgeDate: 1779912100,
                }],
                nextLink: null,
            },
        }, calls))

        const [secret] = await adapter.list({filters: {state: 'deleted'}})

        expect(calls.map((call) => call.path)).toEqual(['/devstoreaccount1-keyvault/deletedsecrets?api-version=7.4'])
        expect(secret).toMatchObject({id: 'old-token', status: 'deleted'})
        expect(secret.metadata).toMatchObject({
            deletedAt: '2026-05-20T20:01:40.000Z',
            scheduledPurgeAt: '2026-05-27T20:01:40.000Z',
        })
        expect(JSON.stringify(secret)).not.toContain('must-not-leak')
    })

    test('lists active secrets by default and rejects an unknown state before calling the runtime', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets?api-version=7.4': {value: [], nextLink: null},
        }, calls))

        await adapter.list({filters: {state: 'active'}})
        expect(calls.map((call) => call.path)).toEqual(['/devstoreaccount1-keyvault/secrets?api-version=7.4'])

        calls.length = 0
        await expect(adapter.list({filters: {state: 'purged'}})).rejects.toThrow('state must be one of: active, deleted')
        expect(calls).toHaveLength(0)
    })

    test('lists the versions of a secret newest first and marks the current one', async () => {
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/db-password?api-version=7.4': {
                ...secretRecord('db-password', 'bbb', {}, 1779307300),
                value: 'must-not-leak',
            },
            '/devstoreaccount1-keyvault/secrets/db-password/versions?api-version=7.4': {
                value: [secretRecord('db-password', 'aaa', {}, 1779307200), secretRecord('db-password', 'bbb', {}, 1779307300)],
                nextLink: null,
            },
        }))

        const resource = await adapter.get('db-password')

        expect(resource?.metadata.versions).toEqual([
            expect.objectContaining({version: 'bbb', current: true, createdAt: '2026-05-20T20:01:40.000Z'}),
            expect.objectContaining({version: 'aaa', current: false, enabled: true}),
        ])
        expect(JSON.stringify(resource)).not.toContain('must-not-leak')
    })

    test('reads a disabled secret from its versions because the runtime answers 403 on read', async () => {
        const disabled = secretRecord('db-password', 'bbb', {}, 1779307300)
        disabled.attributes.enabled = false
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/db-password?api-version=7.4': status(403, {
                error: {code: 'Forbidden', message: 'The secret db-password is disabled.'},
            }),
            '/devstoreaccount1-keyvault/secrets/db-password/versions?api-version=7.4': {
                value: [secretRecord('db-password', 'aaa', {}, 1779307200), disabled],
                nextLink: null,
            },
        }))

        const resource = await adapter.get('db-password')

        expect(resource).toMatchObject({id: 'db-password', status: 'disabled'})
        expect(resource?.metadata.enabled).toBe(false)
        expect(resource?.metadata.versions).toEqual([
            expect.objectContaining({version: 'bbb', enabled: false, current: null}),
            expect.objectContaining({version: 'aaa', enabled: true, current: null}),
        ])
    })

    test('falls back to the deleted namespace and never exposes the value of a deleted secret', async () => {
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/deletedsecrets/db-password?api-version=7.4': {
                ...secretRecord('db-password', 'bbb'),
                value: 'must-not-leak',
                deletedDate: 1779307300,
                scheduledPurgeDate: 1779912100,
            },
        }))

        const resource = await adapter.get('db-password')

        expect(resource).toMatchObject({id: 'db-password', status: 'deleted'})
        expect(JSON.stringify(resource)).not.toContain('must-not-leak')
    })

    test('updates the properties of the latest version without creating a new one', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/db-password?api-version=7.4': secretRecord('db-password', 'bbb'),
            '/devstoreaccount1-keyvault/secrets/db-password/bbb?api-version=7.4': {
                ...secretRecord('db-password', 'bbb'),
                contentType: 'application/json',
            },
        }, calls))

        const updated = await adapter.update('db-password', {values: {contentType: 'application/json', enabled: 'false'}})

        expect(updated.metadata.contentType).toBe('application/json')
        const patch = calls.find((call) => call.init.method === 'PATCH')
        expect(patch?.path).toBe('/devstoreaccount1-keyvault/secrets/db-password/bbb?api-version=7.4')
        expect(JSON.parse(String(patch?.init.body))).toEqual({
            contentType: 'application/json',
            attributes: {enabled: false},
        })
    })

    test('updates a named version without resolving the latest one', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/db-password/aaa?api-version=7.4': secretRecord('db-password', 'aaa'),
        }, calls))

        await adapter.update('db-password', {values: {enabled: true, version: 'aaa'}})

        expect(calls.map((call) => call.init.method)).toEqual(['PATCH'])
    })

    test('resolves the latest version of a disabled secret only when it is unambiguous', async () => {
        const first = secretRecord('db-password', 'aaa', {}, 1779307200)
        const second = secretRecord('db-password', 'bbb', {}, 1779307300)
        first.attributes.enabled = false
        second.attributes.enabled = false
        const forbidden = status(403, {error: {code: 'Forbidden', message: 'disabled'}})
        const calls: RecordedCall[] = []
        const unambiguous = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/db-password?api-version=7.4': forbidden,
            '/devstoreaccount1-keyvault/secrets/db-password/versions?api-version=7.4': {value: [first, second], nextLink: null},
            '/devstoreaccount1-keyvault/secrets/db-password/bbb?api-version=7.4': second,
        }, calls))

        await unambiguous.update('db-password', {values: {enabled: 'true'}})
        expect(calls.at(-1)?.path).toBe('/devstoreaccount1-keyvault/secrets/db-password/bbb?api-version=7.4')

        const sameSecond = secretRecord('db-password', 'ccc', {}, 1779307300)
        sameSecond.attributes.enabled = false
        const ambiguous = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/secrets/db-password?api-version=7.4': forbidden,
            '/devstoreaccount1-keyvault/secrets/db-password/versions?api-version=7.4': {value: [second, sameSecond], nextLink: null},
        }))

        await expect(ambiguous.update('db-password', {values: {enabled: 'true'}})).rejects.toThrow('provide its version ID')
    })

    test('validates update input before calling the runtime', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({}, calls))

        await expect(adapter.update('db-password', {values: {}})).rejects.toThrow('Provide a content type or an enabled value')
        await expect(adapter.update('db-password', {values: {enabled: 'maybe'}})).rejects.toThrow('enabled must be true or false')
        await expect(adapter.update('db-password', {values: {enabled: true, version: '../x'}})).rejects.toThrow('hexadecimal version ID')
        expect(calls).toHaveLength(0)
    })

    test('reports an update of a secret that does not exist as not found', async () => {
        const adapter = new AzureKeyVaultAdapter(testClient({}))

        await expect(adapter.update('missing', {values: {enabled: true}})).rejects.toBeInstanceOf(NotFoundError)
    })

    test('recovers a deleted secret and purges a deleted secret through the deleted namespace', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({
            '/devstoreaccount1-keyvault/deletedsecrets/db-password/recover?api-version=7.4': {
                ...secretRecord('db-password', 'bbb'),
                value: 'must-not-leak',
            },
            '/devstoreaccount1-keyvault/deletedsecrets/old-token?api-version=7.4': {},
        }, calls))

        const recovered = await adapter.recover('db-password')
        await adapter.purgeDeleted('old-token')

        expect(recovered).toMatchObject({id: 'db-password', status: 'enabled'})
        expect(JSON.stringify(recovered)).not.toContain('must-not-leak')
        expect(calls.map((call) => `${call.init.method} ${call.path}`)).toEqual([
            'POST /devstoreaccount1-keyvault/deletedsecrets/db-password/recover?api-version=7.4',
            'DELETE /devstoreaccount1-keyvault/deletedsecrets/old-token?api-version=7.4',
        ])
    })

    test('validates required inputs before calling the runtime', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultAdapter(testClient({}, calls))

        await expect(adapter.create({values: {secretName: 'not valid', secretValue: 'value'}}))
            .rejects.toThrow('Use a valid Key Vault secret name')
        await expect(adapter.create({values: {secretName: 'valid-name', secretValue: ''}}))
            .rejects.toThrow('secretValue is required')
        expect(calls).toHaveLength(0)
    })

    test('exposes Azure Key Vault CRUD capabilities in its schema', () => {
        const schema = new AzureKeyVaultAdapter(testClient({})).schema()

        expect(schema.service).toBe('secrets')
        expect(schema.actions).toEqual(['list', 'create', 'update', 'delete', 'inspect'])
        expect(schema.fields.find((field) => field.name === 'secretValue')?.type).toBe('password')
        expect(schema.filters.find((filter) => filter.name === 'state')?.options?.map((option) => option.value)).toEqual(['active', 'deleted'])
        expect(schema.capabilities?.resourceActions?.filter((action) => action.status === 'available').map((action) => action.name))
            .toEqual(['list', 'create', 'update', 'delete', 'recover', 'purgeDeleted', 'inspect'])
        const namePattern = schema.fields.find((field) => field.name === 'secretName')?.validation?.pattern
        expect(() => new RegExp(namePattern ?? '', 'v')).not.toThrow()
    })
})

// The list endpoint returns base identifiers; only a single-secret read carries a version.
function listedSecretRecord(name: string, tags: Record<string, string> = {}) {
    return secretRecord(name, null, tags)
}

function secretRecord(name: string, version: string | null, tags: Record<string, string> = {}, created = 1779307200) {
    return {
        id: `https://devstoreaccount1.vault.azure.net/secrets/${name}${version ? `/${version}` : ''}`,
        attributes: {
            enabled: true,
            created,
            updated: created + 1,
            exp: null,
            nbf: null,
            recoveryLevel: 'Purgeable',
            recoverableDays: 7,
        },
        contentType: 'text/plain',
        tags,
    }
}

const STATUS = Symbol('status')

function status(code: number, body: unknown) {
    return {[STATUS]: code, body}
}

// Mirrors AzureRestRuntimeClient: a path the runtime does not know is a 404, and a
// non-OK status throws unless the caller asked for the null or the raw response.
function testClient(
    responses: Record<string, unknown>,
    calls: RecordedCall[] = [],
): AzureRuntimeClient {
    return {
        endpoint: 'http://localhost:4577',
        accountName: 'devstoreaccount1',
        async fetch(path: string, init: RequestInit, options: AzureRuntimeFetchOptions = {}) {
            calls.push({path, init, options})
            const known = path in responses
            const entry = responses[path] as {[STATUS]?: number; body?: unknown} | undefined
            const code = known ? entry?.[STATUS] ?? 200 : 404
            const body = known && entry?.[STATUS] ? entry.body : known ? responses[path] : {error: {code: 'NotFound'}}
            if (options.emptyOnNotFound && code === 404) return null
            const res = new Response(JSON.stringify(body), {status: code, headers: {'content-type': 'application/json'}})
            if (!res.ok && !options.allowErrorStatus) {
                throw httpStatusToCloudError(code, `Azure runtime request failed: HTTP ${code} ${path}`)
            }
            return res
        },
    }
}
