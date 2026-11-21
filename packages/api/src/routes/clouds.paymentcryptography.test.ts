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
})
