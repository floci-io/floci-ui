import {afterEach, describe, expect, test} from 'bun:test'
import {OciSecretsAdapter, encodeSecretContent} from './OciSecretsAdapter'
import {OciRestRuntimeClient} from '../oci'
import {ConflictError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const SECRETS = `${ENDPOINT}/20180608/secrets`
const VAULT = 'ocid1.vault.oc1.iad.vault1'
const KEY = 'ocid1.key.oc1.iad.key1'
const SECRET = 'ocid1.vaultsecret.oc1.iad.secret1'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciSecretsAdapter {
    return new OciSecretsAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

type Call = {url: string; init?: RequestInit}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

function notFound(): Response {
    return json({code: 'NotAuthorizedOrNotFound', message: 'not found'}, {status: 404})
}

const activeVault = {id: VAULT, displayName: 'demo', lifecycleState: 'ACTIVE'}
const aesKey = {id: KEY, vaultId: VAULT, lifecycleState: 'ENABLED', keyShape: {algorithm: 'AES', length: 32}}

/** A runtime with one ACTIVE vault and one ENABLED AES key that accepts CreateSecret. */
function happyRuntime(overrides: {vault?: unknown; key?: unknown} = {}) {
    return stubFetch((url, init) => {
        if (url.startsWith(`${ENDPOINT}/20180608/vaults/`)) {
            return overrides.vault === null ? notFound() : json(overrides.vault ?? activeVault)
        }
        if (url.startsWith(`${ENDPOINT}/20180608/keys/`)) {
            return overrides.key === null ? notFound() : json(overrides.key ?? aesKey)
        }
        if (url === SECRETS && init?.method === 'POST') {
            const body = JSON.parse(String(init.body)) as Record<string, unknown>
            return json({
                id: SECRET,
                secretName: body.secretName,
                compartmentId: body.compartmentId,
                vaultId: body.vaultId,
                keyId: body.keyId,
                lifecycleState: 'ACTIVE',
                timeCreated: '2026-09-29T00:00:00Z',
                currentVersionNumber: 1,
            })
        }
        return notFound()
    })
}

function createInput(values: Record<string, unknown> = {}) {
    return {values: {secretName: 'db-password', vaultId: VAULT, keyId: KEY, secretValue: 's3cr3t', ...values}}
}

function postedBody(calls: Call[]): Record<string, unknown> {
    const call = calls.find((entry) => entry.url === SECRETS && entry.init?.method === 'POST')
    if (!call) throw new Error('CreateSecret was not called')
    return JSON.parse(String(call.init?.body)) as Record<string, unknown>
}

describe('OciSecretsAdapter', () => {
    test('identifies itself as the OCI secrets adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('secrets')
        expect(instance.schema().displayName).toBe('OCI Vault Secrets')
    })

    test('labels delete honestly as scheduled deletion', () => {
        const capability = adapter().schema().capabilities?.resourceActions?.find((entry) => entry.name === 'delete')
        expect(capability?.label).toBe('Schedule secret deletion')
    })

    test('lists secrets in the tenancy root compartment', async () => {
        const calls = stubFetch(() => json([
            {
                id: SECRET,
                secretName: 'db-password',
                compartmentId: TENANCY,
                vaultId: VAULT,
                keyId: KEY,
                lifecycleState: 'ACTIVE',
                timeCreated: '2026-09-29T00:00:00Z',
                currentVersionNumber: 2,
            },
        ]))
        const [resource] = await adapter().list()

        expect(calls[0]?.url).toBe(`${SECRETS}?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(resource).toMatchObject({
            id: SECRET,
            name: 'db-password',
            cloud: 'oci',
            service: 'secrets',
            type: 'secret',
            region: 'us-ashburn-1',
            createdAt: '2026-09-29T00:00:00Z',
            status: 'ACTIVE',
            version: '2',
        })
        expect(resource?.metadata).toMatchObject({vaultId: VAULT, keyId: KEY, compartmentId: TENANCY, timeOfDeletion: null})
    })

    test('follows opc-next-page when listing', async () => {
        const calls = stubFetch((url) => url.includes('page=p2')
            ? json([{id: 'b', secretName: 'b'}])
            : json([{id: 'a', secretName: 'a'}], {status: 200, headers: {'opc-next-page': 'p2'}}))

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.name)).toEqual(['a', 'b'])
        expect(calls[1]?.url).toContain('page=p2')
    })

    test('surfaces PENDING_DELETION and its deletion time', async () => {
        stubFetch(() => json([{
            id: SECRET,
            secretName: 'old',
            lifecycleState: 'PENDING_DELETION',
            timeOfDeletion: '2026-10-29T00:00:00Z',
        }]))
        const [resource] = await adapter().list()

        expect(resource?.status).toBe('PENDING_DELETION')
        expect(resource?.metadata.timeOfDeletion).toBe('2026-10-29T00:00:00Z')
    })

    test('reports no version for a secret without content', async () => {
        stubFetch(() => json([{id: SECRET, secretName: 'empty', lifecycleState: 'ACTIVE'}]))
        const [resource] = await adapter().list()
        expect(resource?.version).toBeNull()
    })

    test('filters the list by search term', async () => {
        stubFetch(() => json([{id: '1', secretName: 'db-password'}, {id: '2', secretName: 'api-token'}]))
        const resources = await adapter().list({search: 'DB'})
        expect(resources.map((resource) => resource.name)).toEqual(['db-password'])
    })

    test('inspects a secret with its content-free version list', async () => {
        const calls = stubFetch((url) => url.endsWith('/versions')
            ? json([
                {secretId: SECRET, versionNumber: 1, stages: ['PREVIOUS'], contentType: 'BASE64', timeCreated: 't1'},
                {secretId: SECRET, versionNumber: 2, stages: ['CURRENT', 'LATEST'], contentType: 'BASE64', timeCreated: 't2'},
            ])
            : json({id: SECRET, secretName: 'db-password', lifecycleState: 'ACTIVE', currentVersionNumber: 2}))

        const resource = await adapter().get(SECRET)

        expect(calls.map((call) => call.url)).toEqual([
            `${SECRETS}/${encodeURIComponent(SECRET)}`,
            `${SECRETS}/${encodeURIComponent(SECRET)}/versions`,
        ])
        expect(resource?.version).toBe('2')
        expect(resource?.metadata.versions).toEqual([
            {versionNumber: 1, name: null, stages: ['PREVIOUS'], contentType: 'BASE64', timeCreated: 't1', timeOfDeletion: null},
            {versionNumber: 2, name: null, stages: ['CURRENT', 'LATEST'], contentType: 'BASE64', timeCreated: 't2', timeOfDeletion: null},
        ])
        expect(JSON.stringify(resource)).not.toContain('content"')
    })

    test('returns null when inspecting a missing secret', async () => {
        const calls = stubFetch(() => notFound())
        expect(await adapter().get(SECRET)).toBeNull()
        expect(calls).toHaveLength(1)
    })

    test('never calls the secret retrieval service', async () => {
        const calls = stubFetch((url) => url.endsWith('/versions') ? json([]) : json({id: SECRET, secretName: 'x'}))
        await adapter().get(SECRET)
        expect(calls.some((call) => call.url.includes('/20190301/'))).toBe(false)
    })

    test('creates a secret in the root compartment with base64 content', async () => {
        const calls = happyRuntime()
        const resource = await adapter().create(createInput({description: 'Primary DB'}))

        expect(postedBody(calls)).toEqual({
            compartmentId: TENANCY,
            vaultId: VAULT,
            keyId: KEY,
            secretName: 'db-password',
            description: 'Primary DB',
            secretContent: {contentType: 'BASE64', content: 'czNjcjN0'},
        })
        expect(resource).toMatchObject({id: SECRET, name: 'db-password', status: 'ACTIVE', version: '1'})
    })

    test('encodes UTF-8 and keeps whitespace so the value round-trips exactly', async () => {
        const value = '  pässwörd 🔐\nline two  '
        const calls = happyRuntime()
        await adapter().create(createInput({secretValue: value}))

        const content = (postedBody(calls).secretContent as {content: string}).content
        expect(content).toBe(encodeSecretContent(value))
        expect(Buffer.from(content, 'base64').toString('utf8')).toBe(value)
    })

    test('encodes known values the way OCI expects', () => {
        expect(encodeSecretContent('hello')).toBe('aGVsbG8=')
        expect(encodeSecretContent('{"a":1}')).toBe('eyJhIjoxfQ==')
        expect(encodeSecretContent('é')).toBe('w6k=')
    })

    test('omits an empty description', async () => {
        const calls = happyRuntime()
        await adapter().create(createInput({description: '  '}))
        expect('description' in postedBody(calls)).toBe(false)
    })

    test('validates the secret name', async () => {
        const calls = stubFetch(() => notFound())
        await expect(adapter().create(createInput({secretName: ''}))).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create(createInput({secretName: 'bad name!'}))).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('requires a secret value', async () => {
        stubFetch(() => notFound())
        await expect(adapter().create(createInput({secretValue: ''}))).rejects.toThrow('secretValue is required')
    })

    test('requires a key id', async () => {
        stubFetch(() => notFound())
        await expect(adapter().create(createInput({keyId: ''}))).rejects.toBeInstanceOf(ValidationError)
    })

    test('says so when no vault exists instead of inventing one', async () => {
        const calls = stubFetch(() => json([]))
        const error = await adapter().create(createInput({vaultId: ''})).catch((err: unknown) => err)

        expect(error).toBeInstanceOf(ValidationError)
        expect((error as Error).message).toContain('No ACTIVE vault exists')
        expect(calls[0]?.url).toBe(`${ENDPOINT}/20180608/vaults?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(calls.some((call) => call.init?.method === 'POST')).toBe(false)
    })

    test('lists the ACTIVE vaults when the vault id is missing', async () => {
        stubFetch(() => json([activeVault, {id: 'ocid1.vault.gone', lifecycleState: 'PENDING_DELETION'}]))
        const error = await adapter().create(createInput({vaultId: ''})).catch((err: unknown) => err)

        expect(error).toBeInstanceOf(ValidationError)
        expect((error as Error).message).toBe(`vaultId is required. ACTIVE vaults: demo (${VAULT}).`)
    })

    test('rejects an unknown vault with a 400, not a 500', async () => {
        const calls = happyRuntime({vault: null})
        const error = await adapter().create(createInput()).catch((err: unknown) => err)

        expect(error).toBeInstanceOf(ValidationError)
        expect((error as Error).message).toContain(`Vault ${VAULT} was not found`)
        expect(calls.some((call) => call.url === SECRETS)).toBe(false)
    })

    test('rejects a vault that is not ACTIVE', async () => {
        happyRuntime({vault: {...activeVault, lifecycleState: 'PENDING_DELETION'}})
        await expect(adapter().create(createInput())).rejects.toThrow('PENDING_DELETION')
    })

    test('rejects an unknown key', async () => {
        happyRuntime({key: null})
        await expect(adapter().create(createInput())).rejects.toThrow(`Key ${KEY} was not found`)
    })

    test('rejects a key from another vault', async () => {
        happyRuntime({key: {...aesKey, vaultId: 'ocid1.vault.other'}})
        await expect(adapter().create(createInput())).rejects.toThrow('belongs to vault ocid1.vault.other')
    })

    test('rejects a disabled key', async () => {
        happyRuntime({key: {...aesKey, lifecycleState: 'DISABLED'}})
        await expect(adapter().create(createInput())).rejects.toThrow('DISABLED')
    })

    test('rejects a non-AES key', async () => {
        happyRuntime({key: {...aesKey, keyShape: {algorithm: 'RSA'}}})
        await expect(adapter().create(createInput())).rejects.toThrow('need an AES key')
    })

    test('maps a duplicate name to a ConflictError', async () => {
        stubFetch((url, init) => {
            if (url.includes('/vaults/')) return json(activeVault)
            if (url.includes('/keys/')) return json(aesKey)
            if (init?.method === 'POST') return json({code: 'Conflict', message: 'exists'}, {status: 409})
            return notFound()
        })
        await expect(adapter().create(createInput())).rejects.toBeInstanceOf(ConflictError)
    })

    test('delete schedules deletion instead of sending DELETE', async () => {
        const calls = stubFetch((url) => url.endsWith('/scheduleDeletion')
            ? new Response(null, {status: 200})
            : json({id: SECRET, lifecycleState: 'ACTIVE'}))

        await adapter().delete(SECRET)

        expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
            ['GET', `${SECRETS}/${encodeURIComponent(SECRET)}`],
            ['POST', `${SECRETS}/${encodeURIComponent(SECRET)}/actions/scheduleDeletion`],
        ])
        expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false)
        expect(calls[1]?.init?.body).toBe('{}')
    })

    test('delete leaves an already-pending secret alone', async () => {
        const calls = stubFetch(() => json({id: SECRET, lifecycleState: 'PENDING_DELETION'}))
        await adapter().delete(SECRET)
        expect(calls).toHaveLength(1)
    })

    test('delete of a missing secret is a no-op', async () => {
        const calls = stubFetch(() => notFound())
        await adapter().delete(SECRET)
        expect(calls).toHaveLength(1)
    })

    test('maps an unreachable runtime to RuntimeUnavailableError', async () => {
        globalThis.fetch = (async () => {
            throw new TypeError('fetch failed')
        }) as unknown as typeof fetch
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeUnavailableError)
    })
})
