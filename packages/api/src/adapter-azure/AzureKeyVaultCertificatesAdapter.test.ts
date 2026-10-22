import {describe, expect, test} from 'bun:test'
import {AzureKeyVaultCertificatesAdapter} from './AzureKeyVaultCertificatesAdapter'
import {ValidationError, httpStatusToCloudError} from '../cloud-spi/errors'
import type {AzureRuntimeClient, AzureRuntimeFetchOptions} from '../azure'

interface RecordedCall {
    path: string
    init: RequestInit
    options: AzureRuntimeFetchOptions
}

const BASE = '/devstoreaccount1-keyvault'
const V = 'api-version=7.4'

describe('AzureKeyVaultCertificatesAdapter', () => {
    test('lists active certificates across pages and filters by name', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/certificates?${V}`]: {
                value: [listedCertificate('app-tls')],
                nextLink: `https://devstoreaccount1.vault.azure.net/certificates?${V}&next=page-2`,
            },
            [`${BASE}/certificates?${V}&next=page-2`]: {value: [listedCertificate('billing-tls')], nextLink: null},
        }, calls))

        const certificates = await adapter.list({search: 'billing'})

        expect(certificates.map((cert) => [cert.id, cert.status, cert.type, cert.service])).toEqual([
            ['billing-tls', 'enabled', 'certificate', 'certificates'],
        ])
        expect(calls.map((call) => call.path)).toEqual([`${BASE}/certificates?${V}`, `${BASE}/certificates?${V}&next=page-2`])
        expect(calls.every((call) => call.options.includeStorageApiVersion === false)).toBe(true)
    })

    test('lists and inspects certificates named like the collections', async () => {
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/certificates?${V}`]: {value: [listedCertificate('certificates')]},
            [`${BASE}/certificates/certificates?${V}`]: certificateBundle('certificates', 'bbb', 1779307260),
            [`${BASE}/certificates/certificates/versions?${V}`]: {value: [listedCertificate('certificates', 'bbb', 1779307260)]},
            [`${BASE}/deletedcertificates?${V}`]: {value: [{...listedCertificate('deletedcertificates'), recoveryId: 'x'}]},
        }))

        const [active] = await adapter.list({})
        const [deleted] = await adapter.list({filters: {state: 'deleted'}})
        const inspected = await adapter.get('certificates')

        expect([active.id, deleted.id, inspected?.id]).toEqual(['certificates', 'deletedcertificates', 'certificates'])
        expect(inspected?.version).toBe('bbb')
    })

    test('lists deleted certificates from the deleted namespace and rejects an unknown state', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/deletedcertificates?${V}`]: {
                value: [{...listedCertificate('old-tls'), recoveryId: 'x', deletedDate: 1779307300, scheduledPurgeDate: 1779912100}],
            },
        }, calls))

        const [certificate] = await adapter.list({filters: {state: 'deleted'}})

        expect(certificate.status).toBe('deleted')
        expect(certificate.metadata.deletedAt).toBe('2026-05-20T20:01:40.000Z')
        expect(certificate.metadata.scheduledPurgeAt).toBe('2026-05-27T20:01:40.000Z')
        await expect(adapter.list({filters: {state: 'bogus'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(1)
    })

    test('inspects a certificate with its policy and versions newest first', async () => {
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/certificates/app-tls?${V}`]: certificateBundle('app-tls', 'bbb', 1779307260),
            [`${BASE}/certificates/app-tls/versions?${V}`]: {
                value: [listedCertificate('app-tls', 'aaa', 1779307200), listedCertificate('app-tls', 'bbb', 1779307260)],
            },
        }))

        const certificate = await adapter.get('app-tls')

        expect(certificate?.version).toBe('bbb')
        expect(certificate?.metadata).toMatchObject({
            subject: 'CN=app.local',
            dnsNames: ['app.local'],
            keyShapeLabel: 'RSA 2048',
            validityMonths: 12,
            secretFormat: 'application/x-pkcs12',
            issuer: 'Self',
            thumbprint: 'THUMB',
        })
        expect((certificate?.metadata.versions as Array<{version: string; current: boolean}>).map((entry) => [entry.version, entry.current]))
            .toEqual([['bbb', true], ['aaa', false]])
        expect(JSON.stringify(certificate)).not.toContain('PRIVATE')
    })

    test('inspects a deleted certificate when the active one is missing', async () => {
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/deletedcertificates/old-tls?${V}`]: {
                ...certificateBundle('old-tls', 'aaa', 1779307200),
                recoveryId: 'x',
                deletedDate: 1779307300,
            },
        }))

        const certificate = await adapter.get('old-tls')

        expect(certificate?.status).toBe('deleted')
        expect(await adapter.get('missing')).toBeNull()
    })

    test('creates a self-signed certificate from a policy and reads it back', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/certificates/app-tls/create?${V}`]: {status: 'completed'},
            [`${BASE}/certificates/app-tls?${V}`]: certificateBundle('app-tls', 'aaa', 1779307200),
            [`${BASE}/certificates/app-tls/versions?${V}`]: {value: [listedCertificate('app-tls', 'aaa', 1779307200)]},
        }, calls))

        const certificate = await adapter.create({
            values: {certificateName: 'app-tls', subject: 'CN=app.local', dnsNames: 'app.local, www.app.local', keyShape: 'EC_P384', validityMonths: '24', contentType: 'PEM'},
        })

        expect(certificate.id).toBe('app-tls')
        const body = JSON.parse(String(calls[0].init.body))
        expect(body.policy).toEqual({
            issuer: {name: 'Self'},
            key_props: {kty: 'EC', crv: 'P-384', exportable: true, reuse_key: false},
            secret_props: {contentType: 'application/x-pem-file'},
            x509_props: {subject: 'CN=app.local', validity_months: 24, sans: {dns_names: ['app.local', 'www.app.local']}},
        })
    })

    test('defaults the subject to the certificate name and omits empty SANs', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/certificates/app-tls/create?${V}`]: {status: 'completed'},
            [`${BASE}/certificates/app-tls?${V}`]: certificateBundle('app-tls', 'aaa', 1779307200),
            [`${BASE}/certificates/app-tls/versions?${V}`]: {value: []},
        }, calls))

        await adapter.create({values: {certificateName: 'app-tls'}})

        const body = JSON.parse(String(calls[0].init.body))
        expect(body.policy.x509_props).toEqual({subject: 'CN=app-tls', validity_months: 12})
        expect(body.policy.key_props).toMatchObject({kty: 'RSA', key_size: 2048})
        expect(body.policy.secret_props.contentType).toBe('application/x-pkcs12')
    })

    test('rejects invalid create input before calling the runtime', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({}, calls))

        for (const values of [
            {},
            {certificateName: 'bad name'},
            {certificateName: 'ok', keyShape: 'RSA_1024'},
            {certificateName: 'ok', contentType: 'JKS'},
            {certificateName: 'ok', keyShape: 'toString'},
            {certificateName: 'ok', contentType: 'constructor'},
            {certificateName: 'ok', validityMonths: '5'},
        ]) {
            await expect(adapter.create({values})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('soft-deletes, recovers and purges through the matching namespaces', async () => {
        const calls: RecordedCall[] = []
        const adapter = new AzureKeyVaultCertificatesAdapter(testClient({
            [`${BASE}/certificates/app-tls?${V}`]: {},
            [`${BASE}/deletedcertificates/app-tls/recover?${V}`]: certificateBundle('app-tls', 'aaa', 1779307200),
            [`${BASE}/deletedcertificates/app-tls?${V}`]: {},
        }, calls))

        await adapter.delete('app-tls')
        const recovered = await adapter.recover('app-tls')
        await adapter.purgeDeleted('app-tls')

        expect(calls.map((call) => [call.init.method, call.path])).toEqual([
            ['DELETE', `${BASE}/certificates/app-tls?${V}`],
            ['POST', `${BASE}/deletedcertificates/app-tls/recover?${V}`],
            ['DELETE', `${BASE}/deletedcertificates/app-tls?${V}`],
        ])
        expect(recovered.status).toBe('enabled')
    })
})

const STATUS = Symbol('status')

function attributes(created: number) {
    return {enabled: true, created, updated: created, nbf: created, exp: created + 31536000, recoveryLevel: 'Purgeable', recoverableDays: 7}
}

function listedCertificate(name: string, version = 'aaa', created = 1779307200) {
    return {
        id: `https://devstoreaccount1.vault.azure.net/certificates/${name}/${version}`,
        x5t: 'THUMB',
        attributes: attributes(created),
    }
}

function certificateBundle(name: string, version: string, created: number) {
    const id = `https://devstoreaccount1.vault.azure.net`
    return {
        id: `${id}/certificates/${name}/${version}`,
        kid: `${id}/keys/${name}/${version}`,
        sid: `${id}/secrets/${name}/${version}`,
        x5t: 'THUMB',
        cer: 'PUBLIC',
        attributes: attributes(created),
        policy: {
            issuer: {name: 'Self'},
            key_props: {kty: 'RSA', key_size: 2048, exportable: true, reuse_key: false},
            secret_props: {contentType: 'application/x-pkcs12'},
            x509_props: {subject: 'CN=app.local', sans: {dns_names: ['app.local']}, validity_months: 12},
        },
    }
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
