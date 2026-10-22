import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {createApiApp} from './app'
import server from './index'

const KMS_ENCRYPT_URL = 'http://localhost/api/clouds/aws/services/kms/resources/key-1/encrypt'
const AZURE_KMS_DECRYPT_URL = 'http://localhost/api/clouds/azure/services/kms/resources/key-1/decrypt'
const OCI_KMS_SIGN_URL = 'http://localhost/api/clouds/oci/services/kms/resources/key-1/sign'
const OCI_KMS_VERIFY_URL = 'http://localhost/api/clouds/oci/services/kms/resources/key-1/verify'
const OCI_KMS_ROTATE_URL = 'http://localhost/api/clouds/oci/services/kms/resources/key-1/rotate'
const OCI_KMS_CANCEL_URL = 'http://localhost/api/clouds/oci/services/kms/resources/key-1/cancel-deletion'
const AZURE_KEY_RECOVER_URL = 'http://localhost/api/clouds/azure/services/kms/resources/app-key/recover'
const AZURE_KEY_PURGE_URL = 'http://localhost/api/clouds/azure/services/kms/resources/app-key/purge-deleted'
const AZURE_SECRET_RECOVER_URL = 'http://localhost/api/clouds/azure/services/secrets/resources/db-password/recover'
const AZURE_SECRET_PURGE_URL = 'http://localhost/api/clouds/azure/services/secrets/resources/db-password/purge-deleted'
const AZURE_CERTIFICATE_RECOVER_URL = 'http://localhost/api/clouds/azure/services/certificates/resources/app-tls/recover'
const AZURE_CERTIFICATE_PURGE_URL = 'http://localhost/api/clouds/azure/services/certificates/resources/app-tls/purge-deleted'
const KMS_SCHEMA_URL = 'http://localhost/api/clouds/aws/services/kms/schema'
const TRUSTED_ORIGIN = 'http://localhost:4500'
const UNTRUSTED_ORIGIN = 'https://example.invalid'

describe('credentialed route CORS', () => {
    test('allows a trusted KMS crypto preflight', async () => {
        const res = await server.fetch(new Request(KMS_ENCRYPT_URL, {
            method: 'OPTIONS',
            headers: {
                origin: TRUSTED_ORIGIN,
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'content-type',
            },
        }))

        expect(res.headers.get('access-control-allow-origin')).toBe(TRUSTED_ORIGIN)
        expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    })

    test('does not allow an untrusted or null KMS crypto origin', async () => {
        for (const url of [KMS_ENCRYPT_URL, AZURE_KMS_DECRYPT_URL, OCI_KMS_SIGN_URL, OCI_KMS_VERIFY_URL]) {
            for (const origin of [UNTRUSTED_ORIGIN, 'null']) {
                const res = await server.fetch(new Request(url, {
                    method: 'OPTIONS',
                    headers: {origin, 'access-control-request-method': 'POST'},
                }))
                expect(res.headers.get('access-control-allow-origin')).toBeNull()
            }
        }
    })

    test('restricts OCI signing and verification on real requests', async () => {
        for (const url of [OCI_KMS_SIGN_URL, OCI_KMS_VERIFY_URL]) {
            for (const origin of [TRUSTED_ORIGIN, UNTRUSTED_ORIGIN]) {
                const res = await server.fetch(new Request(url, {
                    method: 'POST',
                    headers: {origin, 'content-type': 'application/json'},
                    body: JSON.stringify({}),
                }))
                expect(res.headers.get('access-control-allow-origin')).toBe(
                    origin === TRUSTED_ORIGIN ? TRUSTED_ORIGIN : null,
                )
            }
        }
    })

    test('blocks untrusted browser origins before bodyless key mutations run', async () => {
        const routes = new Hono()
        let mutations = 0
        routes.post('/:cloud/services/kms/resources/:id/rotate', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        routes.post('/:cloud/services/kms/resources/:id/cancel-deletion', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        routes.post('/:cloud/services/kms/resources/:id/recover', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        routes.post('/:cloud/services/kms/resources/:id/purge-deleted', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        routes.post('/:cloud/services/secrets/resources/:id/recover', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        routes.post('/:cloud/services/secrets/resources/:id/purge-deleted', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        routes.post('/:cloud/services/certificates/resources/:id/recover', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        routes.post('/:cloud/services/certificates/resources/:id/purge-deleted', (c) => {
            mutations += 1
            return c.json({ok: true})
        })
        const app = createApiApp(routes)

        for (const url of [OCI_KMS_ROTATE_URL, OCI_KMS_CANCEL_URL, AZURE_KEY_RECOVER_URL, AZURE_KEY_PURGE_URL, AZURE_SECRET_RECOVER_URL, AZURE_SECRET_PURGE_URL, AZURE_CERTIFICATE_RECOVER_URL, AZURE_CERTIFICATE_PURGE_URL]) {
            const preflight = await app.fetch(new Request(url, {
                method: 'OPTIONS',
                headers: {origin: UNTRUSTED_ORIGIN, 'access-control-request-method': 'POST'},
            }))
            expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

            for (const origin of [UNTRUSTED_ORIGIN, 'null']) {
                const response = await app.fetch(new Request(url, {method: 'POST', headers: {origin}}))
                expect(response.status).toBe(403)
            }
            const trusted = await app.fetch(new Request(url, {method: 'POST', headers: {origin: TRUSTED_ORIGIN}}))
            expect(trusted.status).toBe(200)
            expect(trusted.headers.get('access-control-allow-origin')).toBe(TRUSTED_ORIGIN)
            const sameOrigin = await app.fetch(new Request(url, {method: 'POST', headers: {origin: 'http://localhost'}}))
            expect(sameOrigin.status).toBe(200)
        }
        expect(mutations).toBe(16)
    })

    test('applies the allow-list to a real KMS crypto request', async () => {
        const body = JSON.stringify({})
        const trusted = await server.fetch(new Request(KMS_ENCRYPT_URL, {
            method: 'POST',
            headers: {origin: TRUSTED_ORIGIN, 'content-type': 'application/json'},
            body,
        }))
        const untrusted = await server.fetch(new Request(KMS_ENCRYPT_URL, {
            method: 'POST',
            headers: {origin: UNTRUSTED_ORIGIN, 'content-type': 'application/json'},
            body,
        }))

        expect(trusted.status).toBe(400)
        expect(trusted.headers.get('access-control-allow-origin')).toBe(TRUSTED_ORIGIN)
        expect(untrusted.status).toBe(400)
        expect(untrusted.headers.get('access-control-allow-origin')).toBeNull()
    })

    test('keeps same-origin requests usable and unrelated routes permissive', async () => {
        const sameOrigin = await server.fetch(new Request(KMS_ENCRYPT_URL, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({}),
        }))
        const unrelated = await server.fetch(new Request('http://localhost/api/clouds', {
            headers: {origin: UNTRUSTED_ORIGIN},
        }))

        expect(sameOrigin.status).toBe(400)
        expect(sameOrigin.headers.get('access-control-allow-origin')).toBeNull()
        expect(unrelated.status).toBe(200)
        expect(unrelated.headers.get('access-control-allow-origin')).toBe('*')
    })

    test('keeps existing non-crypto KMS routes permissive', async () => {
        const schema = await server.fetch(new Request(KMS_SCHEMA_URL, {
            headers: {origin: UNTRUSTED_ORIGIN},
        }))

        expect(schema.status).toBe(200)
        expect(schema.headers.get('access-control-allow-origin')).toBe('*')
    })
})

describe('production server wiring', () => {
    test('hands the Bun server to routes that extend their request timeout', async () => {
        // A storage adapter without emptyBucket answers 501 once the route got its
        // server binding; without the binding the route refuses with a 500.
        const res = await server.fetch(
            new Request('http://localhost/api/clouds/azure/services/storage/resources/logs/empty', {method: 'POST'}),
            {timeout() {}},
        )

        expect(res.status).toBe(501)
    })
})
