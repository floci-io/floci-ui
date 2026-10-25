import {afterEach, describe, expect, test} from 'bun:test'
import {GcpKmsAdapter} from './GcpKmsAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {NotFoundError, NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const RINGS = '/v1/projects/floci-local/locations/us-central1/keyRings'
const PARENT = 'projects/floci-local/locations/us-central1/keyRings'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpKmsAdapter {
    return new GcpKmsAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

type Call = {path: string; method: string; body: unknown}

function stubFetch(handler: (path: string, init?: RequestInit) => Response) {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const path = String(url).replace(ENDPOINT, '')
        calls.push({path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined})
        return handler(path, init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
}

function notFound(): Response {
    return json({error: {code: 404, message: 'CryptoKey not found', status: 'NOT_FOUND'}}, 404)
}

/** Shapes captured from the floci-gcp nightly image. */
function keyRing(name: string) {
    return {name: `${PARENT}/${name}`, createTime: '2026-10-25T20:30:47.323742251Z'}
}

function version(state = 'ENABLED', n = 1) {
    return {
        name: `${PARENT}/kr1/cryptoKeys/k1/cryptoKeyVersions/${n}`,
        state,
        protectionLevel: 'SOFTWARE',
        algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
        createTime: '2026-10-25T20:30:47.361998418Z',
    }
}

function cryptoKey(name = 'k1', ring = 'kr1', overrides: Record<string, unknown> = {}) {
    return {
        name: `${PARENT}/${ring}/cryptoKeys/${name}`,
        purpose: 'ENCRYPT_DECRYPT',
        createTime: '2026-10-25T20:30:47.361972960Z',
        versionTemplate: {protectionLevel: 'SOFTWARE', algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION'},
        primary: version(),
        ...overrides,
    }
}

describe('GcpKmsAdapter', () => {
    test('lists key rings and their keys as one table', async () => {
        stubFetch((path) => {
            if (path === RINGS) return json({keyRings: [keyRing('kr1'), keyRing('kr2')]})
            if (path === `${RINGS}/kr1/cryptoKeys`) return json({cryptoKeys: [cryptoKey()]})
            if (path === `${RINGS}/kr2/cryptoKeys`) return json({})
            return notFound()
        })

        const resources = await adapter().list()

        expect(resources.map((r) => [r.id, r.type, r.status])).toEqual([
            ['kr1', 'keyRing', null],
            ['kr2', 'keyRing', null],
            ['kr1/k1', 'key', 'ENABLED'],
        ])
        expect(resources[2]).toMatchObject({
            name: 'k1',
            region: 'us-central1',
            metadata: {keyRing: 'kr1', purpose: 'ENCRYPT_DECRYPT', keyUsage: 'ENCRYPT_DECRYPT', keySpec: 'SYMMETRIC_DEFAULT', enabled: true},
        })
    })

    test('lists nothing when there are no key rings', async () => {
        stubFetch(() => json({}))
        expect(await adapter().list()).toEqual([])
    })

    test('follows nextPageToken instead of returning a partial list', async () => {
        const calls = stubFetch((path) => {
            if (path === RINGS) return json({keyRings: [keyRing('kr1')], nextPageToken: 'p2'})
            if (path === `${RINGS}?pageToken=p2`) return json({keyRings: [keyRing('kr2')]})
            return json({})
        })

        const resources = await adapter().list()

        expect(resources.map((r) => r.id)).toEqual(['kr1', 'kr2'])
        expect(calls.some((c) => c.path === `${RINGS}?pageToken=p2`)).toBe(true)
    })

    test('fails the whole list when one ring cannot be read', async () => {
        stubFetch((path) => {
            if (path === RINGS) return json({keyRings: [keyRing('kr1'), keyRing('kr2')]})
            if (path === `${RINGS}/kr1/cryptoKeys`) return json({cryptoKeys: [cryptoKey()]})
            return json({error: {code: 500, message: 'boom'}}, 500)
        })

        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('refuses a runtime that never stops paging', async () => {
        stubFetch(() => json({keyRings: [keyRing('kr1')], nextPageToken: 'again'}))
        await expect(adapter().list()).rejects.toThrow('partial list')
    })

    test('filters by search over name and id', async () => {
        stubFetch((path) => {
            if (path === RINGS) return json({keyRings: [keyRing('alpha'), keyRing('beta')]})
            return json({})
        })

        expect((await adapter().list({search: 'ALP'})).map((r) => r.id)).toEqual(['alpha'])
    })

    test('marks a key whose primary version is not enabled', async () => {
        stubFetch((path) => {
            if (path === RINGS) return json({keyRings: [keyRing('kr1')]})
            return json({cryptoKeys: [cryptoKey('k1', 'kr1', {primary: version('DESTROY_SCHEDULED')})]})
        })

        const key = (await adapter().list()).find((r) => r.type === 'key')

        expect(key?.status).toBe('DESTROY_SCHEDULED')
        expect(key?.metadata.enabled).toBe(false)
    })

    test('an asymmetric key has no crypto usage and no primary state', async () => {
        stubFetch((path) => {
            if (path === RINGS) return json({keyRings: [keyRing('kr1')]})
            return json({
                cryptoKeys: [
                    cryptoKey('sig', 'kr1', {
                        purpose: 'ASYMMETRIC_SIGN',
                        primary: undefined,
                        versionTemplate: {protectionLevel: 'SOFTWARE', algorithm: 'EC_SIGN_P256_SHA256'},
                    }),
                ],
            })
        })

        const key = (await adapter().list()).find((r) => r.type === 'key')

        expect(key?.status).toBeNull()
        expect(key?.metadata).toMatchObject({algorithm: 'EC_SIGN_P256_SHA256', enabled: false})
        expect(key?.metadata.keyUsage).toBeUndefined()
    })

    test('inspects a key ring', async () => {
        stubFetch(() => json(keyRing('kr1')))
        expect(await adapter().get('kr1')).toMatchObject({id: 'kr1', type: 'keyRing', createdAt: '2026-10-25T20:30:47.323742251Z'})
    })

    test('inspects a key together with its versions', async () => {
        stubFetch((path) => {
            if (path.endsWith('/cryptoKeyVersions')) {
                return json({cryptoKeyVersions: [version('ENABLED', 2), {...version('DESTROY_SCHEDULED', 1), destroyTime: '2026-10-26T00:00:00Z'}]})
            }
            return json(cryptoKey())
        })

        const key = await adapter().get('kr1/k1')

        expect(key?.metadata.versions).toEqual([
            {version: '2', state: 'ENABLED', algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION', createdAt: '2026-10-25T20:30:47.361998418Z', destroyTime: null},
            {version: '1', state: 'DESTROY_SCHEDULED', algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION', createdAt: '2026-10-25T20:30:47.361998418Z', destroyTime: '2026-10-26T00:00:00Z'},
        ])
    })

    test('returns null for a ring or key that is not there', async () => {
        stubFetch(() => notFound())
        expect(await adapter().get('nope')).toBeNull()
        expect(await adapter().get('kr1/nope')).toBeNull()
        expect(await adapter().get('a/b/c')).toBeNull()
    })

    test('creates a key ring', async () => {
        const calls = stubFetch(() => json(keyRing('kr1')))

        const created = await adapter().create({values: {resourceType: 'keyRing', name: 'kr1'}})

        expect(created).toMatchObject({id: 'kr1', type: 'keyRing'})
        expect(calls[0]).toMatchObject({path: `${RINGS}?keyRingId=kr1`, method: 'POST'})
    })

    test('creates a symmetric key in an existing ring', async () => {
        const calls = stubFetch(() => json(cryptoKey()))

        const created = await adapter().create({values: {resourceType: 'key', name: 'k1', keyRing: 'kr1'}})

        expect(created).toMatchObject({id: 'kr1/k1', type: 'key', status: 'ENABLED'})
        expect(calls[0]).toEqual({
            path: `${RINGS}/kr1/cryptoKeys?cryptoKeyId=k1`,
            method: 'POST',
            body: {purpose: 'ENCRYPT_DECRYPT'},
        })
    })

    test('a key in a ring that does not exist is not found', async () => {
        stubFetch(() => json({error: {code: 404, message: 'KeyRing not found', status: 'NOT_FOUND'}}, 404))
        await expect(adapter().create({values: {resourceType: 'key', name: 'k1', keyRing: 'nope'}})).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    test('rejects invalid names before calling the runtime', async () => {
        const calls = stubFetch(() => json({}))

        for (const values of [
            {resourceType: 'keyRing', name: ''},
            {resourceType: 'keyRing', name: 'bad name'},
            {resourceType: 'keyRing', name: 'a'.repeat(64)},
            {resourceType: 'key', name: 'k1'},
            {resourceType: 'key', name: 'k1', keyRing: '../x'},
            {resourceType: 'vault', name: 'k1'},
        ]) {
            await expect(adapter().create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('cannot delete a key ring or a key', async () => {
        await expect(adapter().delete()).rejects.toBeInstanceOf(NotSupportedError)
    })

    describe('encrypt and decrypt', () => {
        const KEY_ID = 'kr1/k1'
        const plaintext = new TextEncoder().encode('secret')

        test('encrypts with the symmetric key', async () => {
            const calls = stubFetch(() => json({name: `${PARENT}/kr1/cryptoKeys/k1/cryptoKeyVersions/1`, ciphertext: 'AAAAAWfv'}))

            const result = await adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})

            expect(Buffer.from(result.ciphertextBlob).toString('base64')).toBe('AAAAAWfv')
            expect(result).toMatchObject({keyId: KEY_ID, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})
            expect(calls[0]).toEqual({
                path: `${RINGS}/kr1/cryptoKeys/k1:encrypt`,
                method: 'POST',
                body: {plaintext: Buffer.from('secret').toString('base64')},
            })
        })

        test('decrypts and returns the plaintext bytes', async () => {
            const calls = stubFetch(() => json({plaintext: Buffer.from('secret').toString('base64')}))

            const result = await adapter().decrypt(KEY_ID, {
                ciphertextBlob: new Uint8Array(Buffer.from('AAAAAWfv', 'base64')),
                encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
            })

            expect(new TextDecoder().decode(result.plaintext)).toBe('secret')
            expect(calls[0]).toMatchObject({path: `${RINGS}/kr1/cryptoKeys/k1:decrypt`, method: 'POST', body: {ciphertext: 'AAAAAWfv'}})
        })

        test('refuses what Cloud KMS cannot do with a symmetric key, without calling the runtime', async () => {
            const calls = stubFetch(() => json({}))

            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'RSAES_OAEP_SHA_256'})).rejects.toBeInstanceOf(
                ValidationError,
            )
            await expect(
                adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT', encryptionContext: {a: 'b'}}),
            ).rejects.toThrow('additional authenticated data')
            await expect(
                adapter().decrypt(KEY_ID, {ciphertextBlob: new Uint8Array(), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'}),
            ).rejects.toBeInstanceOf(ValidationError)
            await expect(adapter().encrypt(KEY_ID, {plaintext: new Uint8Array(), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(
                ValidationError,
            )
            expect(calls).toHaveLength(0)
        })

        test('a key id cannot address another path', async () => {
            const calls = stubFetch(() => json({}))

            for (const id of ['kr1', 'kr1/k1/extra', 'kr1/../x', '../k1']) {
                await expect(adapter().encrypt(id, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(
                    Error,
                )
            }
            expect(calls).toHaveLength(0)
        })

        test('an unknown key is not found', async () => {
            stubFetch(() => notFound())
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(
                NotFoundError,
            )
        })

        test('a key that is not enabled is refused by the runtime', async () => {
            stubFetch(() =>
                json({error: {code: 400, message: 'CryptoKeyVersion is not enabled (state=DISABLED)', status: 'FAILED_PRECONDITION'}}, 400),
            )
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(
                ValidationError,
            )
        })

        test('a response with no ciphertext or plaintext is a runtime failure', async () => {
            stubFetch(() => json({}))
            await expect(adapter().encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})).rejects.toBeInstanceOf(
                RuntimeError,
            )
            await expect(
                adapter().decrypt(KEY_ID, {ciphertextBlob: new Uint8Array([1]), encryptionAlgorithm: 'SYMMETRIC_DEFAULT'}),
            ).rejects.toBeInstanceOf(RuntimeError)
        })

        test('a failure never echoes the plaintext', async () => {
            stubFetch(() => json({error: {code: 500, message: 'internal'}}, 500))

            const failure = await adapter()
                .encrypt(KEY_ID, {plaintext, encryptionAlgorithm: 'SYMMETRIC_DEFAULT'})
                .catch((error: Error) => error)

            expect((failure as Error).message).not.toContain('secret')
            expect((failure as Error).message).not.toContain(Buffer.from('secret').toString('base64'))
        })
    })
})
