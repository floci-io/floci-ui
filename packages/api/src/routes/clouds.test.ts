import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {azureDatabaseSchema} from '../cloud-spi/databaseSchema'
import {awsStorageSchema, azureStorageSchema} from '../cloud-spi/storageSchema'
import {azureSecretsSchema} from '../cloud-spi/secretsSchema'
import type {CloudResource, CloudServiceAdapter, CosmosContainer, CosmosItem, CosmosQueryResult, CreateResourceInput} from '../cloud-spi/types'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import {createCloudRoutes} from './clouds'

function mockAdapter(cloud: 'aws' | 'azure', overrides: Partial<CloudServiceAdapter> = {}): CloudServiceAdapter {
    return {
        cloud,
        service: 'storage',
        schema: cloud === 'aws' ? awsStorageSchema : azureStorageSchema,
        list: async () => [],
        get: async () => null,
        create: async (_input: CreateResourceInput): Promise<CloudResource> => ({
            id: 'created',
            name: 'created',
            cloud,
            service: 'storage',
            type: cloud === 'aws' ? 'bucket' : 'container',
            region: null,
            createdAt: null,
            metadata: {},
        }),
        delete: async () => {},
        listObjects: async (resourceId: string, prefix = '') => ({
            prefix,
            objects: [{
                key: `${resourceId}/object.txt`,
                name: 'object.txt',
                type: 'object',
                size: 12,
                lastModified: null,
                metadata: {},
            }],
        }),
        ...overrides,
    }
}

function appWithRoutes(adapters: CloudServiceAdapter[] = [mockAdapter('aws'), mockAdapter('azure')]) {
    const app = new Hono()
    const registry = new CloudAdapterRegistry(adapters)
    app.route('/api/clouds', createCloudRoutes(new CloudProxyService(registry)))
    return app
}

describe('cloud schema routes', () => {
    test('returns AWS storage schema', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('aws')
        expect(body.service).toBe('storage')
        expect(body.fields[0].name).toBe('bucketName')
    })

    test('returns Azure storage schema', async () => {
        const res = await appWithRoutes().request('/api/clouds/azure/services/storage/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('azure')
        expect(body.service).toBe('storage')
        expect(body.fields[0].name).toBe('containerName')
    })

    test('returns Azure database schema when the adapter is registered', async () => {
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'database',
            schema: azureDatabaseSchema,
        })])
        const res = await app.request('/api/clouds/azure/services/database/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('azure')
        expect(body.service).toBe('database')
        expect(body.displayName).toBe('Cosmos DB')
    })

    test('returns GCP storage schema', async () => {
        const res = await appWithRoutes().request('/api/clouds/gcp/services/storage/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('gcp')
        expect(body.service).toBe('storage')
        expect(body.fields[0].name).toBe('bucketName')
    })

    test('returns provider k8s schemas without registered adapters', async () => {
        const azureRes = await appWithRoutes().request('/api/clouds/azure/services/k8s/schema')
        const azureBody = await azureRes.json()
        const gcpRes = await appWithRoutes().request('/api/clouds/gcp/services/k8s/schema')
        const gcpBody = await gcpRes.json()

        expect(azureRes.status).toBe(200)
        expect(azureBody.displayName).toBe('Azure AKS')
        expect(gcpRes.status).toBe(200)
        expect(gcpBody.displayName).toBe('Google GKE')
    })

    test('returns provider database schemas without registered adapters', async () => {
        const azureRes = await appWithRoutes().request('/api/clouds/azure/services/database/schema')
        const azureBody = await azureRes.json()
        const gcpRes = await appWithRoutes().request('/api/clouds/gcp/services/database/schema')
        const gcpBody = await gcpRes.json()

        expect(azureRes.status).toBe(200)
        expect(azureBody.displayName).toBe('Cosmos DB')
        expect(gcpRes.status).toBe(200)
        expect(gcpBody.displayName).toBe('Cloud SQL')
    })

    test('returns Azure Key Vault schema without a registered adapter', async () => {
        const res = await appWithRoutes().request('/api/clouds/azure/services/secrets/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.displayName).toBe('Azure Key Vault')
        expect(body.fields.map((field: {name: string}) => field.name)).toEqual([
            'secretName',
            'secretValue',
            'contentType',
        ])
    })

    test('marks Azure Key Vault available when its adapter is registered', async () => {
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'secrets',
            schema: azureSecretsSchema,
        })])
        const res = await app.request('/api/clouds/azure/services')
        const body = await res.json()
        const secrets = body.find((service: {service: string}) => service.service === 'secrets')

        expect(res.status).toBe(200)
        expect(secrets).toMatchObject({
            displayName: 'Key Vault',
            availability: 'available',
        })
    })

    test('returns AWS cloud status', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/status')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('aws')
        expect(body.adapterRegistered).toBe(true)
        expect(body.runtime).toBe('reachable')
    })

    test('returns GCP runtime status without a registered adapter', async () => {
        const res = await appWithRoutes().request('/api/clouds/gcp/status')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('gcp')
        expect(body.adapterRegistered).toBe(false)
        expect(body.runtime).toBe('unavailable')
        expect(body.endpoint).toBe('http://localhost:4588')
    })

    test('lists storage objects through the cloud adapter', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/resources/demo/objects')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.objects).toHaveLength(1)
        expect(body.objects[0].name).toBe('object.txt')
    })

    test('lists Cosmos containers through the cloud database adapter', async () => {
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'database',
            schema: azureDatabaseSchema,
            listCosmosContainers: async (databaseId: string): Promise<CosmosContainer[]> => [{
                id: 'items',
                name: 'items',
                databaseId,
                partitionKeyPath: '/id',
                createdAt: null,
                metadata: {},
            }],
        })])

        const res = await app.request('/api/clouds/azure/services/database/resources/appdb/containers')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body[0].databaseId).toBe('appdb')
        expect(body[0].name).toBe('items')
    })

    test('creates and deletes Cosmos databases through the cloud database adapter', async () => {
        const deleted: string[] = []
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'database',
            schema: azureDatabaseSchema,
            create: async (input: CreateResourceInput): Promise<CloudResource> => ({
                id: String(input.values.databaseName),
                name: String(input.values.databaseName),
                cloud: 'azure',
                service: 'database',
                type: 'cosmos-database',
                region: null,
                createdAt: null,
                metadata: {},
            }),
            delete: async (id: string) => {
                deleted.push(id)
            },
        })])

        const createRes = await app.request('/api/clouds/azure/services/database/resources', {
            method: 'POST',
            body: JSON.stringify({databaseName: 'appdb'}),
        })
        const created = await createRes.json()
        const deleteRes = await app.request('/api/clouds/azure/services/database/resources/appdb', {method: 'DELETE'})

        expect(createRes.status).toBe(201)
        expect(created.type).toBe('cosmos-database')
        expect(created.name).toBe('appdb')
        expect(deleteRes.status).toBe(200)
        expect(deleted).toEqual(['appdb'])
    })

    test('creates and deletes Cosmos containers through the cloud database adapter', async () => {
        const deleted: Array<{databaseId: string; containerId: string}> = []
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'database',
            schema: azureDatabaseSchema,
            createCosmosContainer: async (databaseId: string, input: CreateResourceInput): Promise<CosmosContainer> => ({
                id: String(input.values.containerName),
                name: String(input.values.containerName),
                databaseId,
                partitionKeyPath: String(input.values.partitionKeyPath),
                createdAt: null,
                metadata: {},
            }),
            deleteCosmosContainer: async (databaseId: string, containerId: string) => {
                deleted.push({databaseId, containerId})
            },
        })])

        const createRes = await app.request('/api/clouds/azure/services/database/resources/appdb/containers', {
            method: 'POST',
            body: JSON.stringify({containerName: 'items', partitionKeyPath: '/category'}),
        })
        const created = await createRes.json()
        const deleteRes = await app.request('/api/clouds/azure/services/database/resources/appdb/containers/items', {method: 'DELETE'})

        expect(createRes.status).toBe(201)
        expect(created.databaseId).toBe('appdb')
        expect(created.partitionKeyPath).toBe('/category')
        expect(deleteRes.status).toBe(200)
        expect(deleted).toEqual([{databaseId: 'appdb', containerId: 'items'}])
    })

    test('upserts, deletes, and queries Cosmos items through the cloud database adapter', async () => {
        const deleted: Array<{databaseId: string; containerId: string; itemId: string; partitionKey?: string | null}> = []
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'database',
            schema: azureDatabaseSchema,
            upsertCosmosItem: async (databaseId: string, containerId: string, document: Record<string, unknown>): Promise<CosmosItem> => ({
                id: String(document.id),
                databaseId,
                containerId,
                partitionKey: String(document.category),
                etag: 'etag',
                timestamp: null,
                document,
            }),
            deleteCosmosItem: async (databaseId: string, containerId: string, itemId: string, partitionKey?: string | null) => {
                deleted.push({databaseId, containerId, itemId, partitionKey})
            },
            queryCosmosItems: async (_databaseId: string, _containerId: string, query: string): Promise<CosmosQueryResult> => ({
                items: [{id: 'item-1', query}],
                count: 1,
            }),
        })])

        const upsertRes = await app.request('/api/clouds/azure/services/database/resources/appdb/containers/items/items', {
            method: 'POST',
            body: JSON.stringify({id: 'item-1', category: 'demo'}),
        })
        const upserted = await upsertRes.json()
        const queryRes = await app.request('/api/clouds/azure/services/database/resources/appdb/containers/items/query', {
            method: 'POST',
            body: JSON.stringify({query: 'SELECT * FROM c'}),
        })
        const queryBody = await queryRes.json()
        const deleteRes = await app.request('/api/clouds/azure/services/database/resources/appdb/containers/items/items/item-1?partitionKey=demo', {method: 'DELETE'})

        expect(upsertRes.status).toBe(201)
        expect(upserted.partitionKey).toBe('demo')
        expect(queryRes.status).toBe(200)
        expect(queryBody.count).toBe(1)
        expect(deleteRes.status).toBe(200)
        expect(deleted).toEqual([{databaseId: 'appdb', containerId: 'items', itemId: 'item-1', partitionKey: 'demo'}])
    })

    test('normalizes runtime unavailable errors', async () => {
        const app = appWithRoutes([
            mockAdapter('aws', {
                list: async () => {
                    throw new Error('Cannot reach Floci-AZ at http://localhost:4577: connection refused')
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources')
        const body = await res.json()

        expect(res.status).toBe(503)
        expect(body.code).toBe('runtime_unavailable')
        expect(body.message).toBe('Runtime unavailable')
        expect(body.detail).toContain('connection refused')
    })

    test('normalizes not implemented runtime errors', async () => {
        const app = appWithRoutes([
            mockAdapter('azure', {
                create: async () => {
                    throw new Error('Azure Blob request failed: HTTP 501')
                },
            }),
        ])
        const res = await app.request('/api/clouds/azure/services/storage/resources', {
            method: 'POST',
            body: JSON.stringify({containerName: 'demo'}),
        })
        const body = await res.json()

        expect(res.status).toBe(501)
        expect(body.code).toBe('operation_not_implemented')
        expect(body.message).toBe('Operation is not implemented by the selected runtime')
    })
})
