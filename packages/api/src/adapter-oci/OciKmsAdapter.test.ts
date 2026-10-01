import {afterEach, describe, expect, test} from 'bun:test'
import {OciKmsAdapter, vaultPlanePath} from './OciKmsAdapter'
import {OciRestRuntimeClient} from '../oci'
import {ConflictError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const COMPARTMENT_QS = `compartmentId=${encodeURIComponent(TENANCY)}`
const VAULT_ID = 'ocid1.vault.oc1.iad.vault1'
const VAULT2_ID = 'ocid1.vault.oc1.iad.vault2'
const KEY_ID = 'ocid1.key.oc1.iad.key1'
/** Floci-OCI advertises its container-internal base URL, not the mapped port. */
const ADVERTISED = 'http://localhost:4599'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciKmsAdapter {
    return new OciKmsAdapter(new OciRestRuntimeClient('http://localhost:4604', TENANCY, 'us-ashburn-1', 'floci-local'))
}

type Call = {url: string; method: string; body: unknown}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
            url: String(url),
            method: init?.method ?? 'GET',
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

function notFound(): Response {
    return json({code: 'NotAuthorizedOrNotFound', message: 'nope'}, {status: 404})
}

function vault(overrides: Record<string, unknown> = {}) {
    return {
        id: VAULT_ID,
        displayName: 'main',
        compartmentId: TENANCY,
        lifecycleState: 'ACTIVE',
        vaultType: 'DEFAULT',
        managementEndpoint: ADVERTISED,
        cryptoEndpoint: ADVERTISED,
        timeCreated: '2026-09-29T00:00:00Z',
        ...overrides,
    }
}

function key(overrides: Record<string, unknown> = {}) {
    return {
        id: KEY_ID,
        displayName: 'app-key',
        compartmentId: TENANCY,
        vaultId: VAULT_ID,
        lifecycleState: 'ENABLED',
        protectionMode: 'HSM',
        currentKeyVersion: 'ocid1.keyversion.oc1.iad.v1',
        keyShape: {algorithm: 'AES', length: 32},
        timeCreated: '2026-09-29T00:01:00Z',
        ...overrides,
    }
}

const BASE = 'http://localhost:4604/20180608'

/** A runtime with one vault and one key, answering the calls every key path makes. */
function runtime(options: {key?: Record<string, unknown>; vaults?: unknown[]; onCrypto?: (url: string) => Response} = {}) {
    return stubFetch((url) => {
        if (url.startsWith(`${BASE}/vaults?`)) return json(options.vaults ?? [vault()])
        if (url === `${BASE}/keys/${KEY_ID}`) return json(key(options.key))
        if (url.startsWith(`${BASE}/keys/`) && url.endsWith('/actions/scheduleDeletion')) {
            return json(key({...options.key, lifecycleState: 'PENDING_DELETION'}))
        }
        if (options.onCrypto && (url.endsWith('/encrypt') || url.endsWith('/decrypt'))) return options.onCrypto(url)
        return notFound()
    })
}

describe('vaultPlanePath', () => {
    test('drops the advertised host and keeps the API path', () => {
        expect(vaultPlanePath('http://localhost:4599', '/keys')).toBe('/20180608/keys')
        expect(vaultPlanePath('https://abc-management.kms.us-ashburn-1.oraclecloud.com', '/encrypt')).toBe('/20180608/encrypt')
    })

    test('keeps a path the endpoint carries and tolerates a missing or malformed endpoint', () => {
        expect(vaultPlanePath('http://gateway/kms/', '/keys')).toBe('/kms/20180608/keys')
        expect(vaultPlanePath(undefined, '/keys')).toBe('/20180608/keys')
        expect(vaultPlanePath('not a url', '/keys')).toBe('/20180608/keys')
    })
})

describe('OciKmsAdapter', () => {
    test('identifies itself as the OCI kms adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('kms')
        expect(instance.schema().displayName).toBe('OCI Vault')
        expect(instance.schema().capabilities?.resourceActions?.find((a) => a.name === 'delete')?.label).toBe('Schedule deletion')
    })

    describe('list', () => {
        test('lists vaults and their keys in the tenancy root compartment, reading each key in full', async () => {
            const calls = stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`)) return json([vault()])
                if (url.startsWith(`${BASE}/keys?`)) {
                    return json([{...key(), keyShape: undefined, currentKeyVersion: undefined, algorithm: 'AES'}])
                }
                if (url === `${BASE}/keys/${KEY_ID}`) return json(key())
                return notFound()
            })
            const resources = await adapter().list()

            expect(calls.map((c) => c.url)).toEqual([
                `${BASE}/vaults?${COMPARTMENT_QS}`,
                `${BASE}/keys?${COMPARTMENT_QS}`,
                `${BASE}/keys/${KEY_ID}`,
            ])
            expect(resources.map((r) => [r.type, r.name, r.status])).toEqual([
                ['vault', 'main', 'ACTIVE'],
                ['key', 'app-key', 'ENABLED'],
            ])
            expect(resources[0]).toMatchObject({id: VAULT_ID, cloud: 'oci', service: 'kms', region: 'us-ashburn-1'})
            expect(resources[1]?.metadata).toMatchObject({
                vaultId: VAULT_ID,
                vaultName: 'main',
                algorithm: 'AES',
                keyShapeLabel: 'AES-256',
                keyUsage: 'ENCRYPT_DECRYPT',
                keySpec: 'SYMMETRIC_DEFAULT',
                currentKeyVersion: 'ocid1.keyversion.oc1.iad.v1',
                enabled: true,
            })
        })

        test('keeps the summary row when a key disappears before GetKey', async () => {
            stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`)) return json([vault()])
                if (url.startsWith(`${BASE}/keys?`)) return json([{...key(), keyShape: undefined, algorithm: 'RSA'}])
                return notFound()
            })
            const [, keyRow] = await adapter().list()
            expect(keyRow?.metadata).toMatchObject({algorithm: 'RSA', keyShapeLabel: 'RSA', keyUsage: 'ENCRYPT_DECRYPT'})
        })

        test('asks each distinct management plane once and deduplicates keys', async () => {
            const calls = stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`)) {
                    return json([vault(), vault({id: VAULT2_ID, displayName: 'second'})])
                }
                if (url.startsWith(`${BASE}/keys?`)) {
                    return json([key(), key({id: 'ocid1.key.oc1.iad.key2', vaultId: VAULT2_ID, displayName: 'other'})])
                }
                return notFound()
            })
            const resources = await adapter().list()

            expect(calls.filter((c) => c.url.includes('/keys?'))).toHaveLength(1)
            const keys = resources.filter((r) => r.type === 'key')
            expect(keys.map((r) => [r.name, r.metadata.vaultName])).toEqual([
                ['app-key', 'main'],
                ['other', 'second'],
            ])
        })

        test('makes no key call when the compartment has no vault', async () => {
            const calls = stubFetch(() => json([]))
            await expect(adapter().list()).resolves.toEqual([])
            expect(calls).toHaveLength(1)
        })

        test('follows opc-next-page for vaults', async () => {
            const calls = stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`) && !url.includes('page=')) {
                    return new Response(JSON.stringify([vault()]), {headers: {'opc-next-page': 'p2'}})
                }
                if (url.includes('page=p2')) return json([vault({id: VAULT2_ID, displayName: 'second'})])
                return json([])
            })
            const resources = await adapter().list()
            expect(resources.map((r) => r.name)).toEqual(['main', 'second'])
            expect(calls[1]?.url).toBe(`${BASE}/vaults?${COMPARTMENT_QS}&page=p2`)
        })

        test('surfaces PENDING_DELETION and the deletion date', async () => {
            stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`)) {
                    return json([vault({lifecycleState: 'PENDING_DELETION', timeOfDeletion: '2026-10-29T00:00:00Z'})])
                }
                const pending = key({lifecycleState: 'PENDING_DELETION', timeOfDeletion: '2026-10-06T00:00:00Z'})
                return url.includes('/keys?') ? json([pending]) : json(pending)
            })
            const [vaultRow, keyRow] = await adapter().list()
            expect(vaultRow?.status).toBe('PENDING_DELETION')
            expect(vaultRow?.metadata.timeOfDeletion).toBe('2026-10-29T00:00:00Z')
            expect(keyRow?.status).toBe('PENDING_DELETION')
            expect(keyRow?.metadata.enabled).toBe(false)
        })

        test('reads a pending vault in full because VaultSummary omits its deletion date', async () => {
            const calls = stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`)) return json([vault({lifecycleState: 'PENDING_DELETION'}), vault({id: VAULT2_ID})])
                if (url === `${BASE}/vaults/${VAULT_ID}`) {
                    return json(vault({lifecycleState: 'PENDING_DELETION', timeOfDeletion: '2026-10-29T00:00:00Z'}))
                }
                return json([])
            })
            const [pending, active] = await adapter().list()
            expect(pending?.metadata.timeOfDeletion).toBe('2026-10-29T00:00:00Z')
            expect(active?.metadata.timeOfDeletion).toBeNull()
            expect(calls.filter((c) => c.url.startsWith(`${BASE}/vaults/`))).toHaveLength(1)
        })

        test('filters by name or OCID', async () => {
            stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`)) return json([vault()])
                return url.includes('/keys?') ? json([key()]) : json(key())
            })
            expect((await adapter().list({search: 'APP'})).map((r) => r.name)).toEqual(['app-key'])
            expect((await adapter().list({search: 'vault1'})).map((r) => r.name)).toEqual(['main'])
        })
    })

    describe('get', () => {
        test('gets a vault by OCID', async () => {
            const calls = stubFetch(() => json(vault()))
            const resource = await adapter().get(VAULT_ID)
            expect(calls[0]?.url).toBe(`${BASE}/vaults/${VAULT_ID}`)
            expect(resource).toMatchObject({type: 'vault', name: 'main'})
            expect(resource?.metadata.managementEndpoint).toBe(ADVERTISED)
        })

        test('returns null for a missing vault', async () => {
            stubFetch(() => notFound())
            await expect(adapter().get(VAULT_ID)).resolves.toBeNull()
        })

        test('gets a key through its vault management plane with the full key shape', async () => {
            const calls = runtime({key: {keyShape: {algorithm: 'RSA', length: 256}}})
            const resource = await adapter().get(KEY_ID)

            expect(calls.map((c) => c.url)).toEqual([`${BASE}/vaults?${COMPARTMENT_QS}`, `${BASE}/keys/${KEY_ID}`])
            expect(resource?.metadata).toMatchObject({
                vaultName: 'main',
                keyShapeLabel: 'RSA-2048',
                keySpec: 'RSA_2048',
                keyUsage: 'ENCRYPT_DECRYPT',
                currentKeyVersion: 'ocid1.keyversion.oc1.iad.v1',
            })
        })

        test('labels ECDSA keys as sign-only', async () => {
            runtime({key: {keyShape: {algorithm: 'ECDSA', length: 32, curveId: 'NIST_P256'}}})
            const resource = await adapter().get(KEY_ID)
            expect(resource?.metadata).toMatchObject({keyShapeLabel: 'ECDSA P256', keyUsage: 'SIGN_VERIFY'})
            expect(resource?.metadata.keySpec).toBeUndefined()
        })

        test('returns null for a key no vault knows', async () => {
            runtime()
            await expect(adapter().get('ocid1.key.oc1.iad.missing')).resolves.toBeNull()
        })
    })

    describe('create', () => {
        test('creates a vault in the root compartment', async () => {
            const calls = stubFetch(() => json(vault({displayName: 'fresh', vaultType: 'VIRTUAL_PRIVATE'})))
            const resource = await adapter().create({values: {resourceType: 'vault', displayName: 'fresh', vaultType: 'VIRTUAL_PRIVATE'}})

            expect(calls[0]).toMatchObject({url: `${BASE}/vaults`, method: 'POST'})
            expect(calls[0]?.body).toEqual({compartmentId: TENANCY, displayName: 'fresh', vaultType: 'VIRTUAL_PRIVATE'})
            expect(resource).toMatchObject({type: 'vault', name: 'fresh'})
        })

        test('defaults the vault type to DEFAULT', async () => {
            const calls = stubFetch(() => json(vault()))
            await adapter().create({values: {resourceType: 'vault', displayName: 'main'}})
            expect((calls[0]?.body as {vaultType: string}).vaultType).toBe('DEFAULT')
        })

        test('reports a key the runtime placed in another vault', async () => {
            stubFetch((url) => {
                if (url === `${BASE}/vaults/${VAULT_ID}`) return json(vault())
                if (url === `${BASE}/keys`) return json(key({vaultId: VAULT2_ID}))
                return notFound()
            })
            const error = await adapter()
                .create({values: {resourceType: 'key', displayName: 'app-key', vaultId: VAULT_ID}})
                .catch((e: unknown) => e)

            expect(error).toBeInstanceOf(ConflictError)
            expect((error as Error).message).toContain(VAULT2_ID)
        })

        test('creates a key on the chosen vault management plane', async () => {
            const calls = stubFetch((url) => {
                if (url === `${BASE}/vaults/${VAULT_ID}`) return json(vault())
                if (url === `${BASE}/keys`) return json(key({displayName: 'signer', keyShape: {algorithm: 'ECDSA', length: 48, curveId: 'NIST_P384'}}))
                return notFound()
            })
            const resource = await adapter().create({
                values: {resourceType: 'key', displayName: 'signer', vaultId: VAULT_ID, keyShape: 'ECDSA_P384', protectionMode: 'SOFTWARE'},
            })

            expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
                `GET ${BASE}/vaults/${VAULT_ID}`,
                `POST ${BASE}/keys`,
            ])
            expect(calls[1]?.body).toEqual({
                compartmentId: TENANCY,
                displayName: 'signer',
                keyShape: {algorithm: 'ECDSA', length: 48, curveId: 'NIST_P384'},
                protectionMode: 'SOFTWARE',
            })
            expect(resource).toMatchObject({type: 'key', name: 'signer'})
            expect(resource.metadata.vaultName).toBe('main')
        })

        test('defaults to an AES-256 HSM key in the only active vault', async () => {
            const calls = stubFetch((url) => {
                if (url.startsWith(`${BASE}/vaults?`)) {
                    return json([vault(), vault({id: VAULT2_ID, lifecycleState: 'PENDING_DELETION'})])
                }
                if (url === `${BASE}/keys`) return json(key())
                return notFound()
            })
            await adapter().create({values: {displayName: 'app-key'}})
            expect(calls[1]?.body).toEqual({
                compartmentId: TENANCY,
                displayName: 'app-key',
                keyShape: {algorithm: 'AES', length: 32},
                protectionMode: 'HSM',
            })
        })

        test('asks for a vault when the compartment has none', async () => {
            const calls = stubFetch(() => json([]))
            await expect(adapter().create({values: {resourceType: 'key', displayName: 'k'}})).rejects.toThrow(/Create a vault first/)
            expect(calls.some((c) => c.method === 'POST')).toBe(false)
        })

        test('asks to choose when several vaults are active', async () => {
            stubFetch(() => json([vault(), vault({id: VAULT2_ID})]))
            await expect(adapter().create({values: {displayName: 'k'}})).rejects.toThrow(/set vaultId/)
        })

        test('refuses a vault pending deletion', async () => {
            stubFetch(() => json(vault({lifecycleState: 'PENDING_DELETION'})))
            await expect(adapter().create({values: {displayName: 'k', vaultId: VAULT_ID}})).rejects.toBeInstanceOf(ConflictError)
        })

        test('rejects an unknown vault, a non-vault OCID, and bad values before creating', async () => {
            const calls = stubFetch(() => notFound())
            await expect(adapter().create({values: {displayName: 'k', vaultId: VAULT_ID}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().create({values: {displayName: 'k', vaultId: KEY_ID}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().create({values: {displayName: '  '}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().create({values: {displayName: 'x'.repeat(256)}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().create({values: {displayName: 'k', keyShape: 'DES'}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().create({values: {resourceType: 'secret', displayName: 'k'}})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().create({values: {resourceType: 'vault', displayName: 'v', vaultType: 'EXTERNAL'}})).rejects.toBeInstanceOf(ValidationError)
            expect(calls.some((c) => c.method === 'POST')).toBe(false)
        })
    })

    describe('delete', () => {
        test('schedules vault deletion instead of deleting', async () => {
            const calls = stubFetch((url) => json(vault(url.endsWith('/scheduleDeletion') ? {lifecycleState: 'PENDING_DELETION'} : {})))
            await adapter().delete(VAULT_ID)
            expect(calls).toEqual([
                {url: `${BASE}/vaults/${VAULT_ID}`, method: 'GET', body: undefined},
                {url: `${BASE}/vaults/${VAULT_ID}/actions/scheduleDeletion`, method: 'POST', body: {}},
            ])
        })

        test('refuses to schedule a vault or key that is already pending deletion', async () => {
            const vaultCalls = stubFetch(() => json(vault({lifecycleState: 'PENDING_DELETION', timeOfDeletion: '2026-10-30T00:00:00Z'})))
            await expect(adapter().delete(VAULT_ID)).rejects.toThrow(/already scheduled for deletion for 2026-10-30/)
            expect(vaultCalls.some((c) => c.method === 'POST')).toBe(false)

            const keyCalls = runtime({key: {lifecycleState: 'PENDING_DELETION'}})
            await expect(adapter().delete(KEY_ID)).rejects.toBeInstanceOf(ConflictError)
            expect(keyCalls.some((c) => c.method === 'POST')).toBe(false)
        })

        test('reports a missing vault as not found', async () => {
            stubFetch(() => notFound())
            await expect(adapter().delete(VAULT_ID)).rejects.toBeInstanceOf(NotFoundError)
        })

        test('schedules key deletion on its vault management plane', async () => {
            const calls = runtime()
            await adapter().delete(KEY_ID)
            expect(calls.at(-1)).toEqual({url: `${BASE}/keys/${KEY_ID}/actions/scheduleDeletion`, method: 'POST', body: {}})
            expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
        })

        test('reports a missing key as not found', async () => {
            runtime()
            await expect(adapter().delete('ocid1.key.oc1.iad.missing')).rejects.toBeInstanceOf(NotFoundError)
        })
    })

    describe('encrypt and decrypt', () => {
        const plaintext = new TextEncoder().encode('hello')

        test('encrypts on the vault crypto plane with AES_256_GCM', async () => {
            const calls = runtime({
                onCrypto: () => json({ciphertext: Buffer.from('sealed').toString('base64'), keyId: KEY_ID, keyVersionId: 'v1'}),
            })
            const result = await adapter().encrypt(KEY_ID, {
                plaintext,
                encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
                encryptionContext: {tenant: 'a'},
            })

            expect(calls.at(-1)).toEqual({
                url: `${BASE}/encrypt`,
                method: 'POST',
                body: {
                    keyId: KEY_ID,
                    plaintext: Buffer.from('hello').toString('base64'),
                    encryptionAlgorithm: 'AES_256_GCM',
                    associatedData: {tenant: 'a'},
                },
            })
            expect(new TextDecoder().decode(result.ciphertextBlob)).toBe('sealed')
            expect(result).toMatchObject({keyId: KEY_ID, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})
        })

        test('decrypts and maps the returned algorithm back', async () => {
            const calls = runtime({
                key: {keyShape: {algorithm: 'RSA', length: 256}},
                onCrypto: () => json({plaintext: Buffer.from('hello').toString('base64'), keyId: KEY_ID, encryptionAlgorithm: 'RSA_OAEP_SHA_256'}),
            })
            const result = await adapter().decrypt(KEY_ID, {
                ciphertextBlob: new Uint8Array([1, 2, 3]),
                encryptionAlgorithm: 'RSAES_OAEP_SHA_256',
            })

            expect(calls.at(-1)?.body).toEqual({
                keyId: KEY_ID,
                ciphertext: Buffer.from([1, 2, 3]).toString('base64'),
                encryptionAlgorithm: 'RSA_OAEP_SHA_256',
            })
            expect(new TextDecoder().decode(result.plaintext)).toBe('hello')
            expect(result.encryptionAlgorithm).toBe('RSAES_OAEP_SHA_256')
        })

        test('rejects mismatched algorithms, sign-only keys and RSA context before calling crypto', async () => {
            const aes = runtime()
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'RSAES_OAEP_SHA_1'})).rejects.toBeInstanceOf(ValidationError)
            expect(aes.some((c) => c.url.endsWith('/encrypt'))).toBe(false)

            runtime({key: {keyShape: {algorithm: 'RSA', length: 256}}})
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ValidationError)
            await expect(
                adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'RSAES_OAEP_SHA_1', encryptionContext: {a: 'b'}}),
            ).rejects.toThrow(/encryptionContext/)

            runtime({key: {keyShape: {algorithm: 'ECDSA', length: 32, curveId: 'NIST_P256'}}})
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toThrow(/ECDSA keys cannot/)
        })

        test('refuses a key that is not ENABLED', async () => {
            runtime({key: {lifecycleState: 'PENDING_DELETION'}})
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ConflictError)
        })

        test('validates plaintext and ciphertext size', async () => {
            runtime()
            await expect(adapter().encrypt(KEY_ID, {plaintext: new Uint8Array(), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().encrypt(KEY_ID, {plaintext: new Uint8Array(4097), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().decrypt(KEY_ID, {ciphertextBlob: new Uint8Array(), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ValidationError)
        })

        test('rejects a vault OCID as the crypto key', async () => {
            const calls = stubFetch(() => notFound())
            await expect(adapter().encrypt(VAULT_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ValidationError)
            expect(calls).toHaveLength(0)
        })

        test('treats a response without ciphertext or with an unknown algorithm as a runtime error', async () => {
            runtime({onCrypto: () => json({keyId: KEY_ID})})
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(RuntimeError)

            runtime({onCrypto: () => json({plaintext: 'aGk=', encryptionAlgorithm: 'AES_128_CBC'})})
            await expect(
                adapter().decrypt(KEY_ID, {ciphertextBlob: new Uint8Array([1]), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'}),
            ).rejects.toBeInstanceOf(RuntimeError)
        })

        test('maps a runtime conflict to a typed error', async () => {
            runtime({onCrypto: () => json({code: 'Conflict', message: 'Key is DISABLED'}, {status: 409})})
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(ConflictError)
        })
    })
})
