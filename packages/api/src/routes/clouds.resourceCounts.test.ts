import {describe, expect, test} from 'bun:test'
import {createCloudRoutes} from './clouds'
import {CloudProxyService} from '../service/CloudProxyService'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import type {CloudProvider, CloudResource, CloudServiceType, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

function schema(cloud: CloudProvider, service: CloudServiceType): ServiceSchema {
    return {
        cloud,
        service,
        displayName: String(service),
        fields: [],
        actions: ['list'],
        capabilities: {resourceActions: [{name: 'list', label: 'List', enabled: true, status: 'available'}]},
        filters: [],
        columns: [{name: 'id', label: 'ID'}],
    }
}

function resource(id: string, service: CloudServiceType): CloudResource {
    return {
        id, name: id, cloud: 'aws', service, type: service, region: 'us-east-1',
        createdAt: '2026-01-01T00:00:00Z', status: 'active', metadata: {},
    }
}

class CountAdapter {
    readonly cloud: CloudProvider = 'aws'
    constructor(readonly service: CloudServiceType, private readonly items: CloudResource[] = [], private readonly countImpl?: () => Promise<number>) {}
    schema() { return schema(this.cloud, this.service) }
    async list(_query?: ResourceQuery) { return this.items }
    async get() { return null }
    async create() { return resource('x', this.service) }
    async delete() {}
    async count() {
        if (this.countImpl) return this.countImpl()
        return this.items.length
    }
}

class NoCountAdapter {
    readonly cloud: CloudProvider = 'aws'
    listCalls = 0
    constructor(readonly service: CloudServiceType, private readonly items: CloudResource[] = []) {}
    schema() { return schema(this.cloud, this.service) }
    async list(_query?: ResourceQuery) { this.listCalls++; return this.items }
    async get() { return null }
    async create() { return resource('x', this.service) }
    async delete() {}
}

class ErrorAdapter {
    readonly cloud: CloudProvider = 'aws'
    constructor(readonly service: CloudServiceType) {}
    schema() { return schema(this.cloud, this.service) }
    async list(_query?: ResourceQuery): Promise<CloudResource[]> { throw new Error('boom') }
    async get() { return null }
    async create() { return resource('x', this.service) }
    async delete() {}
}

class UnavailableAdapter extends CountAdapter {
    descriptorOverride() {
        return {availability: 'coming_soon' as const, reason: 'Not ready'}
    }
}

function appWith(registry: CloudAdapterRegistry) {
    return createCloudRoutes(new CloudProxyService(registry))
}

describe('GET /clouds/:cloud/resource-counts', () => {
    test('returns counts for available services and skips unavailable overrides', async () => {
        const registry = new CloudAdapterRegistry([
            new CountAdapter('storage', [resource('b1', 'storage'), resource('b2', 'storage')]) as any,
            new UnavailableAdapter('database', [resource('db1', 'database')]) as any,
        ])
        const app = appWith(registry)

        const response = await app.request('/aws/resource-counts')
        expect(response.status).toBe(200)
        const body = await response.json() as Array<{cloud: string; service: string; count?: number; error?: string}>
        expect(body).toContainEqual({cloud: 'aws', service: 'storage', count: 2})
        expect(body.find((item) => item.service === 'database')).toBeUndefined()
    })

    test('isolates per-service errors', async () => {
        const registry = new CloudAdapterRegistry([
            new CountAdapter('storage', [resource('b1', 'storage')]) as any,
            new ErrorAdapter('database') as any,
        ])
        const app = appWith(registry)

        const response = await app.request('/aws/resource-counts')
        expect(response.status).toBe(200)
        const body = await response.json() as Array<{cloud: string; service: string; count?: number; error?: string}>
        expect(body).toContainEqual({cloud: 'aws', service: 'storage', count: 1})
        const db = body.find((item) => item.service === 'database')
        expect(db?.error).toContain('boom')
        expect(db?.count).toBeUndefined()
    })

    test('falls back to list().length when adapter has no count()', async () => {
        const adapter = new NoCountAdapter('storage', [resource('b1', 'storage'), resource('b2', 'storage')])
        const registry = new CloudAdapterRegistry([adapter as any])
        const app = appWith(registry)

        const response = await app.request('/aws/resource-counts')
        expect(response.status).toBe(200)
        const body = await response.json() as Array<{cloud: string; service: string; count?: number; error?: string}>
        expect(body).toContainEqual({cloud: 'aws', service: 'storage', count: 2})
        expect(adapter.listCalls).toBe(1)
    })

    test('uses account-scoped service resolver', async () => {
        const seen: Array<string | null | undefined> = []
        const registry = new CloudAdapterRegistry([new CountAdapter('storage', [resource('b1', 'storage')]) as any])
        const app = createCloudRoutes(undefined, (accountId) => {
            seen.push(accountId)
            return new CloudProxyService(registry)
        })

        const response = await app.request('/aws/resource-counts', {
            headers: {'x-floci-account-id': '000000000001'},
        })
        expect(response.status).toBe(200)
        expect(seen).toEqual(['000000000001'])
    })

    test('returns 404 for unknown cloud', async () => {
        const app = appWith(new CloudAdapterRegistry())
        const response = await app.request('/nope/resource-counts')
        expect(response.status).toBe(404)
    })

    test('counts only requested services when services query is provided', async () => {
        let storageCounts = 0
        let databaseCounts = 0
        const registry = new CloudAdapterRegistry([
            new CountAdapter('storage', [resource('b1', 'storage')], async () => { storageCounts++; return 1 }) as any,
            new CountAdapter('database', [resource('db1', 'database')], async () => { databaseCounts++; return 1 }) as any,
        ])
        const app = appWith(registry)

        const response = await app.request('/aws/resource-counts?services=storage')
        expect(response.status).toBe(200)
        const body = await response.json() as Array<{cloud: string; service: string; count?: number; error?: string}>
        expect(body).toEqual([{cloud: 'aws', service: 'storage', count: 1}])
        expect(storageCounts).toBe(1)
        expect(databaseCounts).toBe(0)
    })
})
