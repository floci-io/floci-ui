import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {createCloudRoutes} from './clouds'
import {CloudProxyService} from '../service/CloudProxyService'
import type {CloudServiceAdapter, ExportedKeyMaterial} from '../cloud-spi/types'
import type {CloudProvider} from '../cloud-spi/types'
import type {RuntimeProbe} from '../service/runtimeProbe'

/**
 * Runtime probes make real HTTP calls to the emulator endpoints, so tests inject
 * stubs, otherwise the status assertions depend on whether something happens to
 * be listening.
 */
function stubProbes(): Record<CloudProvider, RuntimeProbe> {
    const reachable: RuntimeProbe = async () => {}
    return {aws: reachable, azure: reachable, gcp: reachable, oci: reachable}
}

/** The material a key leaves under, as the service answers it. */
const material: ExportedKeyMaterial = {
    keyMaterial: 'D0112K1AB00E0000',
    format: 'TR31_KEY_BLOCK',
    wrappingKeyArn: null,
    keyCheckValue: null,
}

/** An adapter for the payment cryptography service that records what it was asked. */
function paymentAdapter(overrides: Partial<CloudServiceAdapter> = {}): CloudServiceAdapter {
    return {
        cloud: 'aws',
        service: 'paymentcryptography',
        schema: () => ({
            cloud: 'aws',
            service: 'paymentcryptography',
            displayName: 'Payment Cryptography',
            fields: [],
            actions: ['list', 'create', 'delete', 'inspect'],
            filters: [],
            columns: [],
        }),
        list: async () => [],
        get: async () => null,
        create: async () => ({
            id: 'key/abc',
            name: 'abc',
            cloud: 'aws',
            service: 'paymentcryptography',
            type: 'key',
            region: 'us-east-1',
            createdAt: null,
            metadata: {},
        }),
        delete: async () => {},
        ...overrides,
    } as CloudServiceAdapter
}

function appWithRoutes(adapters: CloudServiceAdapter[]) {
    const app = new Hono()
    const registry = new CloudAdapterRegistry(adapters)
    app.route('/api/clouds', createCloudRoutes(new CloudProxyService(registry, stubProbes())))
    return app
}

describe('the payment cryptography routes', () => {
    test('the usage route passes the body to the adapter', async () => {
        const seen: Array<Record<string, unknown>> = []
        const app = appWithRoutes([
            paymentAdapter({
                setUsage: async (_id: string, input: Record<string, unknown>) => {
                    seen.push(input)
                },
            } as Partial<CloudServiceAdapter>),
        ])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/usage',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: 'true'}),
            },
        )

        expect(res.status).toBe(200)
        expect(seen[0]).toEqual({enabled: 'true'})
    })

    test('a body that is not an object is refused', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                setUsage: async () => {},
            } as Partial<CloudServiceAdapter>),
        ])

        for (const body of ['null', '[]', '42']) {
            const res = await app.request(
                '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/usage',
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body,
                },
            )

            // A body of null is a fault of the caller, and it is refused here
            // rather than reaching the adapter as a fault of the server.
            expect(res.status).toBe(400)
        }
    })

    test('the policy route passes the body to the adapter', async () => {
        const seen: Array<Record<string, unknown>> = []
        const app = appWithRoutes([
            paymentAdapter({
                setPolicy: async (_id: string, input: Record<string, unknown>) => {
                    seen.push(input)
                },
            } as Partial<CloudServiceAdapter>),
        ])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/policy',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({policy: '{"Version":"2012-10-17"}'}),
            },
        )

        expect(res.status).toBe(200)
        expect(seen[0]).toEqual({policy: '{"Version":"2012-10-17"}'})
    })

    test('a body that is not an object is refused by the policy route', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                setPolicy: async () => {},
            } as Partial<CloudServiceAdapter>),
        ])

        for (const body of ['null', '[]', '42']) {
            const res = await app.request(
                '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/policy',
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body,
                },
            )

            expect(res.status).toBe(400)
        }
    })

    test('the replication route passes the body to the adapter', async () => {
        const seen: Array<Record<string, unknown>> = []
        const app = appWithRoutes([
            paymentAdapter({
                setReplication: async (_id: string, input: Record<string, unknown>) => {
                    seen.push(input)
                },
            } as Partial<CloudServiceAdapter>),
        ])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/replication',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({replicationRegions: ['us-east-2']}),
            },
        )

        expect(res.status).toBe(200)
        expect(seen[0]).toEqual({replicationRegions: ['us-east-2']})
    })

    test('a body that is not an object is refused by the replication route', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                setReplication: async () => {},
            } as Partial<CloudServiceAdapter>),
        ])

        for (const body of ['null', '[]', '42']) {
            const res = await app.request(
                '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/replication',
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body,
                },
            )

            expect(res.status).toBe(400)
        }
    })

    test('the export route passes the body to the adapter', async () => {
        const seen: Array<{wrappingKeyArn: string}> = []
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async (_id: string, input: {wrappingKeyArn: string}) => {
                    seen.push(input)
                    return material
                },
            } as Partial<CloudServiceAdapter>),
        ])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({wrappingKeyArn: 'key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc'}),
            },
        )

        expect(res.status).toBe(200)
        expect(seen[0]).toEqual({
            wrappingKeyArn: 'key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc',
        })
    })

    test('a body that is not an object is refused by the export route', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async () => material,
            } as Partial<CloudServiceAdapter>),
        ])

        for (const body of ['null', '[]', '42']) {
            const res = await app.request(
                '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body,
                },
            )

            expect(res.status).toBe(400)
        }
    })

    test('a body that does not name a wrapping key is refused', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async () => material,
            } as Partial<CloudServiceAdapter>),
        ])

        for (const body of ['{}', '{"wrappingKeyArn": 42}', '{"wrappingKeyArn": null}', '{"wrappingKeyArn": "  "}']) {
            const res = await app.request(
                '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body,
                },
            )

            // The body is checked rather than cast, so a value that is not a
            // string never reaches the adapter as one, and the refusal is the
            // route's own.
            expect(res.status).toBe(400)
            expect((await res.json()).message).toBe('wrappingKeyArn must be a non-empty string')
        }
    })

    test('an export that produced no material says so', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async () => ({...material, keyMaterial: ''}),
            } as Partial<CloudServiceAdapter>),
        ])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({wrappingKeyArn: 'key/def'}),
            },
        )

        // An export that produced nothing is not an export, so it is not
        // answered with an empty block and a success.
        expect(res.status).toBe(502)
    })

    test('the material is not stored, and neither is the error about it', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async () => {
                    throw new Error('the service said no')
                },
            } as Partial<CloudServiceAdapter>),
        ])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({wrappingKeyArn: 'key/def'}),
            },
        )

        // The material a key leaves under is the most secret thing this API
        // answers with, so neither it nor the error about it may be stored.
        expect(res.headers.get('cache-control')).toBe('no-store')

        const answered = appWithRoutes([
            paymentAdapter({
                exportKey: async () => material,
            } as Partial<CloudServiceAdapter>),
        ])
        const ok = await answered.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({wrappingKeyArn: 'key/def'}),
            },
        )

        expect(ok.headers.get('cache-control')).toBe('no-store')
    })

    test('the export route answers with the material the adapter returned', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async () => material,
            } as Partial<CloudServiceAdapter>),
        ])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({wrappingKeyArn: 'key/def'}),
            },
        )

        // The console reads these four members, so the shape the route answers
        // with is pinned here.
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(material)
    })

    test('the routes reach the service with the id the request named', async () => {
        const seen: string[] = []
        const app = appWithRoutes([
            paymentAdapter({
                setUsage: async (id: string) => {
                    seen.push(id)
                },
                setPolicy: async (id: string) => {
                    seen.push(id)
                },
                setReplication: async (id: string) => {
                    seen.push(id)
                },
                exportKey: async (id: string) => {
                    seen.push(id)
                    return material
                },
            } as Partial<CloudServiceAdapter>),
        ])

        for (const path of ['usage', 'policy', 'replication', 'export']) {
            await app.request(
                `/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/${path}`,
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({enabled: 'true', policy: '{}', wrappingKeyArn: 'key/def'}),
                },
            )
        }

        expect(seen).toEqual(['key/abc', 'key/abc', 'key/abc', 'key/abc'])
    })

    test('an unknown cloud or service is refused', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                setUsage: async () => {},
                setPolicy: async () => {},
                setReplication: async () => {},
                exportKey: async () => material,
            } as Partial<CloudServiceAdapter>),
        ])

        for (const path of ['usage', 'policy', 'replication', 'export']) {
            for (const target of ['acme/services/paymentcryptography', 'aws/services/nosuchservice']) {
                const res = await app.request(
                    `/api/clouds/${target}/resources/key%2Fabc/${path}`,
                    {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({enabled: 'true', policy: '{}', wrappingKeyArn: 'key/def'}),
                    },
                )

                expect(res.status).toBe(404)
            }
        }
    })

    test('a service that is not the payment cryptography one is refused', async () => {
        // The routes are generic, so a service that happens to have a method of
        // the same name would be driven with a body shaped for a payment key.
        let writes = 0
        const app = appWithRoutes([
            {
                ...paymentAdapter(),
                service: 'kms',
                setUsage: async () => {
                    writes += 1
                },
                setPolicy: async () => {
                    writes += 1
                },
                setReplication: async () => {
                    writes += 1
                },
                exportKey: async () => {
                    writes += 1
                    return material
                },
            } as CloudServiceAdapter,
        ])

        for (const path of ['usage', 'policy', 'replication', 'export']) {
            const res = await app.request(
                `/api/clouds/aws/services/kms/resources/key%2Fabc/${path}`,
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({enabled: 'true', policy: '{}', wrappingKeyArn: 'key/abc'}),
                },
            )

            expect(res.status).toBe(501)
        }
        expect(writes).toBe(0)
    })
})
