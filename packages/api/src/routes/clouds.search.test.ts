/**
 * Regression tests for issue #205:
 * "Search bar in top nav doesn't update the `search` query param"
 *
 * These tests verify that the `GET /clouds/:cloud/services/:service/resources`
 * route correctly reads the `search` URL query parameter and forwards it to
 * `CloudProxyService.listResources()` as `query.search`.
 */
import {describe, expect, test} from 'bun:test'
import {createCloudRoutes} from './clouds'
import {CloudProxyService} from '../service/CloudProxyService'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import type {CloudProvider, CloudResource, CloudServiceType, ResourceQuery} from '../cloud-spi/types'

const STUB_RESOURCE: CloudResource = {
    id: 'stub-bucket-1',
    cloud: 'aws',
    service: 'storage',
    name: 'stub-bucket-1',
    type: 'bucket',
    region: 'us-east-1',
    tags: {},
    raw: {},
}

class StubStorageAdapter {
    readonly cloud: CloudProvider = 'aws'
    readonly service: CloudServiceType = 'storage'
    capturedQuery: ResourceQuery | undefined

    schema() {
        return {
            cloud: 'aws' as CloudProvider,
            service: 'storage' as CloudServiceType,
            displayName: 'Storage',
            actions: ['list'] as const,
            columns: [{name: 'id', label: 'ID', path: 'id'}],
            availability: 'available' as const,
        }
    }

    async list(query: ResourceQuery): Promise<CloudResource[]> {
        this.capturedQuery = query
        const term = query.search?.toLowerCase()
        if (!term) return [STUB_RESOURCE]
        return STUB_RESOURCE.name.toLowerCase().includes(term) ? [STUB_RESOURCE] : []
    }
}

function buildApp(adapter: StubStorageAdapter) {
    const registry = {
        get: (cloud: CloudProvider, service: CloudServiceType) =>
            cloud === 'aws' && service === 'storage' ? adapter : undefined,
        servicesFor: () => [],
        clouds: () => [],
    } as unknown as CloudAdapterRegistry

    const service = new CloudProxyService(registry)
    return createCloudRoutes(service)
}

describe('GET /clouds/:cloud/services/:service/resources - search query param (#205)', () => {
    test('forwards the search param to listResources when provided', async () => {
        const adapter = new StubStorageAdapter()
        const app = buildApp(adapter)

        const response = await app.request('/aws/services/storage/resources?search=stub')

        expect(response.status).toBe(200)
        expect(adapter.capturedQuery?.search).toBe('stub')
    })

    test('passes undefined search when no param supplied', async () => {
        const adapter = new StubStorageAdapter()
        const app = buildApp(adapter)

        const response = await app.request('/aws/services/storage/resources')

        expect(response.status).toBe(200)
        expect(adapter.capturedQuery?.search).toBeUndefined()
    })

    test('filters resources by search term via adapter', async () => {
        const adapter = new StubStorageAdapter()
        const app = buildApp(adapter)

        const hitResponse = await app.request('/aws/services/storage/resources?search=stub')
        const hitBody = await hitResponse.json() as CloudResource[]
        expect(hitBody).toHaveLength(1)

        const missResponse = await app.request('/aws/services/storage/resources?search=dynamo')
        const missBody = await missResponse.json() as CloudResource[]
        expect(missBody).toHaveLength(0)
    })

    test('returns 404 for unknown cloud', async () => {
        const adapter = new StubStorageAdapter()
        const app = buildApp(adapter)

        const response = await app.request('/unknown-cloud/services/storage/resources?search=test')

        expect(response.status).toBe(404)
    })
})
