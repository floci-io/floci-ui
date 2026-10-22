import {describe, expect, test} from 'bun:test'
import {AzureKeyVaultKeysAdapter} from './AzureKeyVaultKeysAdapter'
import {NotFoundError, ValidationError, httpStatusToCloudError} from '../cloud-spi/errors'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'

interface RecordedCall {
    path: string
    init: RequestInit
    options: AzureRuntimeFetchOptions
}

const BASE = '/devstoreaccount1-keyvault'
const V = 'api-version=7.4'
const PLAINTEXT = new TextEncoder().encode('hello world')

describe('AzureKeyVaultKeysAdapter', () => {
    test('lists active keys across pages and filters by name', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys?${V}`]: {
                value: [listedKey('app-rsa')],
                nextLink: `https://devstoreaccount1.vault.azure.net/keys?${V}&next=page-2`,
            },
            [`${BASE}/keys?${V}&next=page-2`]: {value: [listedKey('billing-aes')], nextLink: null},
        }, calls))

        const keys = await adapter.list({search: 'billing'})

        expect(keys.map((key) => [key.id, key.status, key.type, key.service])).toEqual([['billing-aes', 'enabled', 'key', 'kms']])
        expect(calls.map((call) => call.path)).toEqual([`${BASE}/keys?${V}`, `${BASE}/keys?${V}&next=page-2`])
        expect(calls.every((call) => call.options.includeStorageApiVersion === false)).toBe(true)
    })

    test('lists and inspects a key whose name equals the collection name', async () => {
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys?${V}`]: {value: [listedKey('keys')]},
            [`${BASE}/keys/keys?${V}`]: keyBundle('keys', 'v1', {kty: 'RSA', key_size: 2048}),
            [`${BASE}/keys/keys/versions?${V}`]: {value: [listedKey('keys', 'v1')]},
        }))

        const [listed] = await adapter.list({})
        const inspected = await adapter.get('keys')

        expect(listed.id).toBe('keys')
        expect(inspected?.id).toBe('keys')
        expect(inspected?.version).toBe('v1')
    })

    test('lists deleted keys from the deleted namespace and rejects an unknown state', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/deletedkeys?${V}`]: {
                value: [{...listedKey('old-key'), recoveryId: 'x', deletedDate: 1779307300, scheduledPurgeDate: 1779912100}],
            },
        }, calls))

        const [key] = await adapter.list({filters: {state: 'deleted'}})

        expect(key.status).toBe('deleted')
        expect(key.metadata.deletedAt).toBe('2026-05-20T20:01:40.000Z')
        expect(key.metadata.scheduledPurgeAt).toBe('2026-05-27T20:01:40.000Z')
        await expect(adapter.list({filters: {state: 'bogus'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(1)
    })

    test('inspects a key with its versions newest first and never surfaces key material', async () => {
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/app-rsa?${V}`]: keyBundle('app-rsa', 'bbb', {kty: 'RSA', key_size: 3072, n: 'PUBLIC', e: 'AQAB'}, 1779307260),
            [`${BASE}/keys/app-rsa/versions?${V}`]: {
                value: [
                    {...listedKey('app-rsa', 'aaa'), attributes: {...attributes(1779307200)}},
                    {...listedKey('app-rsa', 'bbb'), attributes: {...attributes(1779307260)}},
                ],
            },
        }))

        const key = await adapter.get('app-rsa')

        expect(key?.version).toBe('bbb')
        expect(key?.metadata).toMatchObject({
            keyType: 'RSA',
            keyShapeLabel: 'RSA 3072',
            keyUsage: 'ENCRYPT_DECRYPT',
            keySpec: 'RSA_3072',
            enabled: true,
        })
        expect((key?.metadata.versions as {version: string; current: boolean}[]).map((v) => [v.version, v.current])).toEqual([
            ['bbb', true],
            ['aaa', false],
        ])
        expect(JSON.stringify(key)).not.toContain('PUBLIC')
    })

    test('describes AES and EC keys in the console crypto vocabulary', async () => {
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/aes?${V}`]: keyBundle('aes', 'v1', {kty: 'oct', key_size: 256}),
            [`${BASE}/keys/aes/versions?${V}`]: {value: []},
            [`${BASE}/keys/ec?${V}`]: keyBundle('ec', 'v1', {kty: 'EC', crv: 'P-384'}),
            [`${BASE}/keys/ec/versions?${V}`]: {value: []},
        }))

        expect((await adapter.get('aes'))?.metadata).toMatchObject({keyUsage: 'ENCRYPT_DECRYPT', keySpec: 'SYMMETRIC_DEFAULT', keyShapeLabel: 'AES 256'})
        expect((await adapter.get('ec'))?.metadata).toMatchObject({keyUsage: 'SIGN_VERIFY', keySpec: 'ECC_NIST_P384', keyShapeLabel: 'EC P-384'})
    })

    test('falls back to the deleted namespace and returns null for a key that never existed', async () => {
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/deletedkeys/old-key?${V}`]: {...keyBundle('old-key', 'v1', {kty: 'oct', key_size: 128}), deletedDate: 1779307300},
        }))

        expect((await adapter.get('old-key'))?.status).toBe('deleted')
        await expect(adapter.get('never')).resolves.toBeNull()
    })

    test('creates keys with the shape the Key Vault contract expects', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/rsa-key/create?${V}`]: keyBundle('rsa-key', 'v1', {kty: 'RSA', key_size: 4096}),
            [`${BASE}/keys/ec-key/create?${V}`]: keyBundle('ec-key', 'v1', {kty: 'EC', crv: 'P-256'}),
            [`${BASE}/keys/aes-key/create?${V}`]: keyBundle('aes-key', 'v1', {kty: 'oct', key_size: 192}),
        }, calls))

        await adapter.create({values: {keyName: 'rsa-key', keyShape: 'RSA_4096'}})
        await adapter.create({values: {keyName: 'ec-key', keyShape: 'EC_P256'}})
        await adapter.create({values: {keyName: 'aes-key', keyShape: 'AES_192'}})

        expect(calls.map((call) => JSON.parse(String(call.init.body)))).toEqual([
            {kty: 'RSA', key_size: 4096},
            {kty: 'EC', crv: 'P-256'},
            {kty: 'oct', key_size: 192},
        ])
        expect(calls.every((call) => call.init.method === 'POST')).toBe(true)
    })

    test('defaults a create without a shape to RSA 2048 and validates input before calling the runtime', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/plain/create?${V}`]: keyBundle('plain', 'v1', {kty: 'RSA', key_size: 2048}),
        }, calls))

        await adapter.create({values: {keyName: 'plain'}})
        expect(JSON.parse(String(calls[0].init.body))).toEqual({kty: 'RSA', key_size: 2048})

        calls.length = 0
        await expect(adapter.create({values: {}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {keyName: 'bad_name'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {keyName: 'k', keyShape: 'RSA_1024'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {keyName: 'k', keyShape: 'toString'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('soft-deletes, recovers, purges and rotates through the Key Vault endpoints', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/app-rsa?${V}`]: keyBundle('app-rsa', 'v1', {kty: 'RSA', key_size: 2048}),
            [`${BASE}/deletedkeys/app-rsa/recover?${V}`]: keyBundle('app-rsa', 'v1', {kty: 'RSA', key_size: 2048}),
            [`${BASE}/deletedkeys/app-rsa?${V}`]: status(204, null),
            [`${BASE}/keys/app-rsa/rotate?${V}`]: keyBundle('app-rsa', 'v2', {kty: 'RSA', key_size: 2048}),
        }, calls))

        await adapter.delete('app-rsa')
        expect((await adapter.recover('app-rsa')).status).toBe('enabled')
        await adapter.purgeDeleted('app-rsa')
        expect((await adapter.rotate('app-rsa')).version).toBe('v2')

        expect(calls.map((call) => `${call.init.method} ${call.path}`)).toEqual([
            `DELETE ${BASE}/keys/app-rsa?${V}`,
            `POST ${BASE}/deletedkeys/app-rsa/recover?${V}`,
            `DELETE ${BASE}/deletedkeys/app-rsa?${V}`,
            `POST ${BASE}/keys/app-rsa/rotate?${V}`,
        ])
    })

    test('surfaces a rotate or recover of a key that does not exist as not found', async () => {
        const adapter = new AzureKeyVaultKeysAdapter(testClient({}))

        await expect(adapter.rotate('nope')).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter.recover('nope')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('encrypts with RSA-OAEP and maps both console algorithms to their Key Vault names', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/app-rsa?${V}`]: keyBundle('app-rsa', 'v1', {kty: 'RSA', key_size: 2048}),
            [`${BASE}/keys/app-rsa/encrypt?${V}`]: {kid: 'k', value: Buffer.from('cipher').toString('base64url')},
        }, calls))

        const sha1 = await adapter.encrypt('app-rsa', {plaintext: PLAINTEXT, encryptionAlgorithm: 'RSAES_OAEP_SHA_1'})
        await adapter.encrypt('app-rsa', {plaintext: PLAINTEXT, encryptionAlgorithm: 'RSAES_OAEP_SHA_256'})

        expect(Buffer.from(sha1.ciphertextBlob).toString()).toBe('cipher')
        const sent = calls.filter((call) => call.path.endsWith(`/encrypt?${V}`)).map((call) => JSON.parse(String(call.init.body)))
        expect(sent.map((body) => body.alg)).toEqual(['RSA-OAEP', 'RSA-OAEP-256'])
        expect(sent[0].value).toBe(Buffer.from(PLAINTEXT).toString('base64url'))
    })

    test('packs the AES-GCM nonce and tag into one blob and unpacks them on decrypt', async () => {
        const calls: RecordedCall[] = []
        const iv = Buffer.alloc(12, 1)
        const tag = Buffer.alloc(16, 2)
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/aes?${V}`]: keyBundle('aes', 'v1', {kty: 'oct', key_size: 128}),
            [`${BASE}/keys/aes/encrypt?${V}`]: {
                value: Buffer.from('xyz').toString('base64url'),
                iv: iv.toString('base64url'),
                tag: tag.toString('base64url'),
            },
            [`${BASE}/keys/aes/decrypt?${V}`]: {value: Buffer.from(PLAINTEXT).toString('base64url')},
        }, calls))

        const encrypted = await adapter.encrypt('aes', {plaintext: PLAINTEXT, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})
        expect(Buffer.from(encrypted.ciphertextBlob)).toEqual(Buffer.concat([iv, Buffer.from('xyz'), tag]))
        expect(JSON.parse(String(calls.find((call) => call.path.endsWith(`/encrypt?${V}`))?.init.body)).alg).toBe('A128GCM')

        const decrypted = await adapter.decrypt('aes', {ciphertextBlob: encrypted.ciphertextBlob, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})
        expect(Buffer.from(decrypted.plaintext).toString()).toBe('hello world')
        expect(JSON.parse(String(calls.find((call) => call.path.endsWith(`/decrypt?${V}`))?.init.body))).toEqual({
            alg: 'A128GCM',
            iv: iv.toString('base64url'),
            value: Buffer.from('xyz').toString('base64url'),
            tag: tag.toString('base64url'),
        })
    })

    test('decrypts ciphertext from an older version after the key was rotated', async () => {
        const calls: RecordedCall[] = []
        const plain = Buffer.from(PLAINTEXT).toString('base64url')
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/app-rsa?${V}`]: keyBundle('app-rsa', 'v3', {kty: 'RSA', key_size: 2048}),
            [`${BASE}/keys/app-rsa/decrypt?${V}`]: status(400, {error: {code: 'BadParameter'}}),
            [`${BASE}/keys/app-rsa/versions?${V}`]: {
                value: [
                    {...listedKey('app-rsa', 'v1'), attributes: attributes(1779307200)},
                    {...listedKey('app-rsa', 'v3'), attributes: attributes(1779307400)},
                    {...listedKey('app-rsa', 'v2'), attributes: attributes(1779307300)},
                ],
            },
            [`${BASE}/keys/app-rsa/v2/decrypt?${V}`]: status(400, {error: {code: 'BadParameter'}}),
            [`${BASE}/keys/app-rsa/v1/decrypt?${V}`]: {value: plain},
        }, calls))

        const decrypted = await adapter.decrypt('app-rsa', {ciphertextBlob: Buffer.from('cipher'), encryptionAlgorithm: 'RSAES_OAEP_SHA_1'})

        expect(Buffer.from(decrypted.plaintext).toString()).toBe('hello world')
        expect(calls.filter((call) => call.path.includes('/decrypt?')).map((call) => call.path)).toEqual([
            `${BASE}/keys/app-rsa/decrypt?${V}`,
            `${BASE}/keys/app-rsa/v2/decrypt?${V}`,
            `${BASE}/keys/app-rsa/v1/decrypt?${V}`,
        ])
    })

    test('keeps the first decrypt error when no version can decrypt the ciphertext', async () => {
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/app-rsa?${V}`]: keyBundle('app-rsa', 'v2', {kty: 'RSA', key_size: 2048}),
            [`${BASE}/keys/app-rsa/decrypt?${V}`]: status(400, {error: {code: 'BadParameter'}}),
            [`${BASE}/keys/app-rsa/versions?${V}`]: {value: [listedKey('app-rsa', 'v1'), listedKey('app-rsa', 'v2')]},
            [`${BASE}/keys/app-rsa/v1/decrypt?${V}`]: status(400, {error: {code: 'BadParameter'}}),
        }))

        await expect(adapter.decrypt('app-rsa', {ciphertextBlob: Buffer.from('nope'), encryptionAlgorithm: 'RSAES_OAEP_SHA_1'}))
            .rejects.toBeInstanceOf(ValidationError)
    })

    test('refuses a crypto request the key cannot satisfy before calling the runtime', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultKeysAdapter(testClient({
            [`${BASE}/keys/app-rsa?${V}`]: keyBundle('app-rsa', 'v1', {kty: 'RSA', key_size: 2048}),
            [`${BASE}/keys/aes?${V}`]: keyBundle('aes', 'v1', {kty: 'oct', key_size: 256}),
            [`${BASE}/keys/ec?${V}`]: keyBundle('ec', 'v1', {kty: 'EC', crv: 'P-256'}),
            [`${BASE}/keys/off?${V}`]: {...keyBundle('off', 'v1', {kty: 'oct', key_size: 256}), attributes: {...attributes(1779307200), enabled: false}},
        }, calls))
        const call = (id: string, algorithm: 'SYMMETRIC_DEFAULT' | 'RSAES_OAEP_SHA_1', extra: object = {}) =>
            adapter.encrypt(id, {plaintext: PLAINTEXT, encryptionAlgorithm: algorithm, ...extra})

        await expect(call('app-rsa', 'SYMMETRIC_DEFAULT')).rejects.toBeInstanceOf(ValidationError)
        await expect(call('aes', 'RSAES_OAEP_SHA_1')).rejects.toBeInstanceOf(ValidationError)
        await expect(call('ec', 'RSAES_OAEP_SHA_1')).rejects.toBeInstanceOf(ValidationError)
        await expect(call('aes', 'SYMMETRIC_DEFAULT', {encryptionContext: {a: 'b'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(call('off', 'SYMMETRIC_DEFAULT')).rejects.toThrow('disabled')
        await expect(call('missing', 'SYMMETRIC_DEFAULT')).rejects.toBeInstanceOf(NotFoundError)
        await expect(adapter.encrypt('aes', {plaintext: new Uint8Array(), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.decrypt('aes', {ciphertextBlob: new Uint8Array(5), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((entry) => /\/(?:encrypt|decrypt)\?/.test(entry.path))).toBe(false)
    })

    test('declares only capabilities the adapter performs and a valid name pattern', () => {
        const schema = new AzureKeyVaultKeysAdapter(testClient({})).schema()

        expect(schema.service).toBe('kms')
        expect(schema.actions).toEqual(['list', 'create', 'delete', 'inspect'])
        expect(schema.filters.find((filter) => filter.name === 'state')?.options?.map((option) => option.value)).toEqual(['active', 'deleted'])
        expect(schema.capabilities?.resourceActions?.map((action) => action.name))
            .toEqual(['list', 'create', 'delete', 'recover', 'purgeDeleted', 'inspect', 'rotate', 'encrypt', 'decrypt'])
        const namePattern = schema.fields.find((field) => field.name === 'keyName')?.validation?.pattern
        expect(() => new RegExp(namePattern ?? '', 'v')).not.toThrow()
    })
})

function attributes(created: number) {
    return {enabled: true, created, updated: created + 1, recoveryLevel: 'Purgeable', recoverableDays: 7}
}

// List entries carry the identifier at the top level; a single-key read nests it in `key`.
function listedKey(name: string, version?: string) {
    return {
        kid: `https://devstoreaccount1.vault.azure.net/keys/${name}${version ? `/${version}` : ''}`,
        attributes: attributes(1779307200),
        tags: {},
    }
}

function keyBundle(name: string, version: string, key: Record<string, unknown>, created = 1779307200) {
    return {
        key: {...key, kid: `https://devstoreaccount1.vault.azure.net/keys/${name}/${version}`},
        attributes: attributes(created),
        tags: {},
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
            const res = new Response(code === 204 ? null : JSON.stringify(body), {status: code, headers: {'content-type': 'application/json'}})
            if (!res.ok && !options.allowErrorStatus) {
                throw httpStatusToCloudError(code, `Azure runtime request failed: HTTP ${code} ${path}`)
            }
            return res
        },
    }
}
