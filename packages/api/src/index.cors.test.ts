import {describe, expect, test} from 'bun:test'
import server from './index'

const KMS_ENCRYPT_URL = 'http://localhost/api/clouds/aws/services/kms/resources/key-1/encrypt'
const AZURE_KMS_DECRYPT_URL = 'http://localhost/api/clouds/azure/services/kms/resources/key-1/decrypt'
const TRUSTED_ORIGIN = 'http://localhost:3000'
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
        for (const url of [KMS_ENCRYPT_URL, AZURE_KMS_DECRYPT_URL]) {
            for (const origin of [UNTRUSTED_ORIGIN, 'null']) {
                const res = await server.fetch(new Request(url, {
                    method: 'OPTIONS',
                    headers: {origin, 'access-control-request-method': 'POST'},
                }))
                expect(res.headers.get('access-control-allow-origin')).toBeNull()
            }
        }
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
})
