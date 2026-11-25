import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {createCloudRoutes} from './clouds'
import {CloudProxyService} from '../service/CloudProxyService'
import type {CloudServiceAdapter} from '../cloud-spi/types'
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

    test('the export route passes the body to the adapter', async () => {
        const seen: Array<{id: string; input: {wrappingKeyArn: string}}> = []
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async (id: string, input: {wrappingKeyArn: string}) => {
                    seen.push({id, input})
                    return {
                        keyMaterial: 'D0112K1AB00E0000',
                        format: 'TR31_KEY_BLOCK',
                        wrappingKeyArn: null,
                        keyCheckValue: null,
                    }
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

        expect(res.status).toBe(200)
        expect(seen[0]).toEqual({id: 'key/abc', input: {wrappingKeyArn: 'key/def'}})
    })

    test('a service that does not export keys says so', async () => {
        const app = appWithRoutes([paymentAdapter()])

        const res = await app.request(
            '/api/clouds/aws/services/paymentcryptography/resources/key%2Fabc/export',
            {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({wrappingKeyArn: 'key/def'}),
            },
        )

        // The adapter does not do this, so the console is told so rather than
        // being handed an answer from somewhere else.
        expect(res.status).toBe(501)
    })

    test('a body that does not name a wrapping key is refused', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async () => ({
                    keyMaterial: 'D0112K1AB00E0000',
                    format: 'TR31_KEY_BLOCK',
                    wrappingKeyArn: null,
                    keyCheckValue: null,
                }),
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
            // string never reaches the adapter as one.
            expect(res.status).toBe(400)
        }
    })

    test('an export that produced no material says so', async () => {
        const app = appWithRoutes([
            paymentAdapter({
                exportKey: async () => ({
                    keyMaterial: '',
                    format: null,
                    wrappingKeyArn: null,
                    keyCheckValue: null,
                }),
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
})
