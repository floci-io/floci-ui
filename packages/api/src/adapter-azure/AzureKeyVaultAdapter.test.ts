import {describe, expect, test} from 'bun:test'
import {AzureKeyVaultAdapter} from './AzureKeyVaultAdapter'
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
        expect(schema.actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(schema.fields.find((field) => field.name === 'secretValue')?.type).toBe('password')
        const namePattern = schema.fields.find((field) => field.name === 'secretName')?.validation?.pattern
        expect(() => new RegExp(namePattern ?? '', 'v')).not.toThrow()
    })
})

// The list endpoint returns base identifiers; only a single-secret read carries a version.
function listedSecretRecord(name: string, tags: Record<string, string> = {}) {
    return secretRecord(name, null, tags)
}

function secretRecord(name: string, version: string | null, tags: Record<string, string> = {}) {
    return {
        id: `https://devstoreaccount1.vault.azure.net/secrets/${name}${version ? `/${version}` : ''}`,
        attributes: {
            enabled: true,
            created: 1779307200,
            updated: 1779307201,
            exp: null,
            nbf: null,
            recoveryLevel: 'Purgeable',
            recoverableDays: 7,
        },
        contentType: 'text/plain',
        tags,
    }
}

function testClient(
    responses: Record<string, unknown>,
    calls: RecordedCall[] = [],
): AzureRuntimeClient {
    return {
        endpoint: 'http://localhost:4577',
        accountName: 'devstoreaccount1',
        async fetch(path: string, init: RequestInit, options: AzureRuntimeFetchOptions = {}) {
            calls.push({path, init, options})
            if (!(path in responses)) {
                if (options.emptyOnNotFound) return null
                throw new Error(`Unexpected Key Vault path: ${path}`)
            }
            return new Response(JSON.stringify(responses[path]), {
                status: 200,
                headers: {'content-type': 'application/json'},
            })
        },
    }
}
