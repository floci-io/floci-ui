import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {awsStorageSchema} from '../cloud-spi/storageSchema'
import type {CloudProvider, CloudResource, CloudServiceAdapter, CreateResourceInput} from '../cloud-spi/types'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import type {RuntimeProbe} from '../service/runtimeProbe'
import {createCloudRoutes} from './clouds'

function mockAdapter(overrides: Partial<CloudServiceAdapter> = {}): CloudServiceAdapter {
    return {
        cloud: 'aws',
        service: 'storage',
        schema: awsStorageSchema,
        list: async () => [],
        get: async () => null,
        create: async (_input: CreateResourceInput): Promise<CloudResource> => ({
            id: 'created',
            name: 'created',
            cloud: 'aws',
            service: 'storage',
            type: 'bucket',
            region: null,
            createdAt: null,
            metadata: {},
        }),
        delete: async () => {},
        ...overrides,
    }
}

/**
 * Runtime probes make real HTTP calls to the emulator endpoints, so the tests inject
 * stubs, the same way the other route tests do.
 */
function appWithRoutes(adapters: CloudServiceAdapter[]) {
    const app = new Hono()
    const registry = new CloudAdapterRegistry(adapters)
    const reachable: RuntimeProbe = async () => {}
    const probes: Record<CloudProvider, RuntimeProbe> = {
        aws: reachable,
        azure: reachable,
        gcp: reachable,
        oci: reachable,
    }
    app.route('/api/clouds', createCloudRoutes(new CloudProxyService(registry, probes)))
    return app
}

describe('the tags route', () => {
    test('sends the tags to the adapter, with a null value for a removed one', async () => {
        const seen: Array<[string, Record<string, string | null>]> = []
        const app = appWithRoutes([
            mockAdapter({
                updateTags: async (id: string, tags: Record<string, string | null>) => {
                    seen.push([id, tags])
                },
            }),
        ])

        const res = await app.request('/api/clouds/aws/services/storage/resources/bucket-1/tags', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({env: 'prod', owner: null}),
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: true})
        expect(seen).toEqual([['bucket-1', {env: 'prod', owner: null}]])
    })

    test('refuses a service whose adapter cannot edit tags', async () => {
        const app = appWithRoutes([mockAdapter()])

        const res = await app.request('/api/clouds/aws/services/storage/resources/bucket-1/tags', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({env: 'prod'}),
        })

        expect(res.status).toBe(501)
        expect((await res.json()).code).toBe('operation_not_supported')
    })

    test('refuses a body that is not an object of tag changes', async () => {
        const app = appWithRoutes([mockAdapter({updateTags: async () => {}})])

        for (const body of [['env'], 'env', 42, {env: 42}]) {
            const res = await app.request('/api/clouds/aws/services/storage/resources/bucket-1/tags', {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body),
            })

            expect(res.status).toBe(400)
        }
    })

    test('a tag named __proto__ is a tag of its own', async () => {
        const seen: Array<Record<string, string | null>> = []
        const app = appWithRoutes([
            mockAdapter({
                updateTags: async (_id: string, tags: Record<string, string | null>) => {
                    seen.push(tags)
                },
            }),
        ])

        const res = await app.request('/api/clouds/aws/services/storage/resources/bucket-1/tags', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            // An own property: a literal would set the prototype instead.
            body: JSON.stringify(Object.fromEntries([['__proto__', 'value']])),
        })

        expect(res.status).toBe(200)
        expect(Object.prototype.hasOwnProperty.call(seen[0], '__proto__')).toBe(true)
        expect(seen[0]['__proto__']).toBe('value')
    })

    test('refuses a service that is not one of them', async () => {
        const app = appWithRoutes([mockAdapter()])

        const res = await app.request('/api/clouds/aws/services/nothing/resources/bucket-1/tags', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({env: 'prod'}),
        })

        expect(res.status).toBe(404)
    })
})
