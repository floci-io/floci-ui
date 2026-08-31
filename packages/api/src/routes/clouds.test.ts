import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {NotImplementedByRuntimeError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'
import {azureDatabaseSchema} from '../cloud-spi/databaseSchema'
import {azureNoSqlSchema} from '../cloud-spi/noSqlSchema'
import {awsDynamoDbSchema} from '../cloud-spi/dynamodbSchema'
import {awsEksSchema} from '../cloud-spi/eksSchema'
import {awsStorageSchema, azureStorageSchema, gcpStorageSchema} from '../cloud-spi/storageSchema'
import {awsSesEmailSchema} from '../cloud-spi/emailSchema'
import type {CloudProvider, CloudResource, CloudServiceAdapter, CosmosContainer, CosmosItem, CosmosQueryResult, CreateResourceInput, NoSqlItem} from '../cloud-spi/types'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import type {RuntimeProbe} from '../service/runtimeProbe'
import {createCloudRoutes} from './clouds'

function mockAdapter(cloud: CloudProvider, overrides: Partial<CloudServiceAdapter> = {}): CloudServiceAdapter {
    return {
        cloud,
        service: 'storage',
        schema: cloud === 'aws' ? awsStorageSchema : cloud === 'gcp' ? gcpStorageSchema : azureStorageSchema,
        list: async () => [],
        get: async () => null,
        create: async (_input: CreateResourceInput): Promise<CloudResource> => ({
            id: 'created',
            name: 'created',
            cloud,
            service: 'storage',
            type: cloud === 'azure' ? 'container' : 'bucket',
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

/**
 * Runtime probes make real HTTP calls to the emulator endpoints, so tests inject
 * stubs — otherwise status assertions depend on whether a container happens to
 * be listening, which passes locally and fails in CI.
 */
function stubProbes(overrides: Partial<Record<CloudProvider, RuntimeProbe>> = {}): Record<CloudProvider, RuntimeProbe> {
    const reachable: RuntimeProbe = async () => {}
    return {aws: reachable, azure: reachable, gcp: reachable, ...overrides}
}

function unreachable(message: string): RuntimeProbe {
    return async () => {
        throw new RuntimeUnavailableError(message)
    }
}

function appWithRoutes(
    adapters: CloudServiceAdapter[] = [mockAdapter('aws'), mockAdapter('azure')],
    probes: Record<CloudProvider, RuntimeProbe> = stubProbes(),
) {
    const app = new Hono()
    const registry = new CloudAdapterRegistry(adapters)
    app.route('/api/clouds', createCloudRoutes(new CloudProxyService(registry, probes)))
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
        // Cosmos moved to the nosql category; database now covers Azure SQL and PostgreSQL.
        expect(body.displayName).toBe('Azure Databases')
    })

    test('returns Azure Cosmos NoSQL schema when the adapter is registered', async () => {
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'nosql',
            schema: azureNoSqlSchema,
        })])
        const res = await app.request('/api/clouds/azure/services/nosql/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.service).toBe('nosql')
        expect(body.displayName).toBe('Azure Cosmos DB NoSQL')
    })

    test('returns AWS DynamoDB schema for the nosql service', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'nosql',
            schema: awsDynamoDbSchema,
        })])
        const res = await app.request('/api/clouds/aws/services/nosql/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('aws')
        expect(body.service).toBe('nosql')
        expect(body.displayName).toBe('DynamoDB')
    })

    test('returns GCP storage schema when the adapter is registered', async () => {
        const app = appWithRoutes([mockAdapter('gcp', {service: 'storage', schema: gcpStorageSchema})])
        const res = await app.request('/api/clouds/gcp/services/storage/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('gcp')
        expect(body.service).toBe('storage')
        expect(body.fields[0].name).toBe('bucketName')
    })

    // Previously a static schema was served for any known service even with no
    // adapter behind it, so the UI rendered a table that then 501'd on every call.
    test('does not serve a schema for a service with no registered adapter', async () => {
        const app = appWithRoutes([mockAdapter('aws')])

        for (const path of [
            '/api/clouds/azure/services/k8s/schema',
            '/api/clouds/gcp/services/k8s/schema',
            '/api/clouds/gcp/services/database/schema',
            '/api/clouds/azure/services/compute/schema',
        ]) {
            const res = await app.request(path)
            expect(res.status).toBe(404)
            expect((await res.json()).error).toBe('Schema not available')
        }
    })

    test('rejects a service slug that is not in the catalog', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/queue/schema')

        expect(res.status).toBe(404)
        expect((await res.json()).error).toBe('Unknown cloud or service')
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
        const app = appWithRoutes(
            [mockAdapter('aws'), mockAdapter('azure')],
            stubProbes({gcp: unreachable('Cannot reach Floci-GCP at http://localhost:4588')}),
        )
        const res = await app.request('/api/clouds/gcp/status')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('gcp')
        expect(body.adapterRegistered).toBe(false)
        expect(body.runtime).toBe('unavailable')
        expect(body.endpoint).toBe('http://localhost:4588')
        expect(body.error).toContain('Cannot reach Floci-GCP')
    })

    test('cloud status reflects the runtime probe, not one adapter listing', async () => {
        // Previously a cloud whose storage adapter could list reported "reachable"
        // no matter what state the runtime was actually in.
        const app = appWithRoutes(
            [mockAdapter('aws')],
            stubProbes({aws: unreachable('Cannot reach Floci core at http://localhost:4566')}),
        )
        const body = await (await app.request('/api/clouds/aws/status')).json()

        expect(body.runtime).toBe('unavailable')
        expect(body.adapterRegistered).toBe(true)
    })

    test('lists storage objects through the cloud adapter', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/resources/demo/objects')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.objects).toHaveLength(1)
        expect(body.objects[0].name).toBe('object.txt')
    })

    test('lists Cosmos containers through the cloud NoSQL adapter', async () => {
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'nosql',
            schema: azureNoSqlSchema,
            listCosmosContainers: async (databaseId: string): Promise<CosmosContainer[]> => [{
                id: 'items',
                name: 'items',
                databaseId,
                partitionKeyPath: '/id',
                createdAt: null,
                metadata: {},
            }],
        })])

        const res = await app.request('/api/clouds/azure/services/nosql/resources/appdb/containers')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body[0].databaseId).toBe('appdb')
        expect(body[0].name).toBe('items')
    })

    test('lists DynamoDB records through the nosql adapter', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'nosql',
            schema: awsDynamoDbSchema,
            listNoSqlItems: async (resourceId: string): Promise<NoSqlItem[]> => [{
                id: '{"pk":"item-1"}',
                key: {pk: 'item-1'},
                document: {pk: 'item-1', name: 'First item', table: resourceId},
            }],
        })])

        const res = await app.request('/api/clouds/aws/services/nosql/resources/orders/items')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body[0].key).toEqual({pk: 'item-1'})
        expect(body[0].document.table).toBe('orders')
    })

    test('clears the SES mailbox through the email adapter', async () => {
        let cleared = false
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'email',
            schema: awsSesEmailSchema,
            clearEmailInbox: async () => {
                cleared = true
            },
        })])

        const res = await app.request('/api/clouds/aws/services/email/inbox', {method: 'DELETE'})

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: true})
        expect(cleared).toBeTrue()
    })

    test('creates and deletes Cosmos databases through the cloud NoSQL adapter', async () => {
        const deleted: string[] = []
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'nosql',
            schema: azureNoSqlSchema,
            create: async (input: CreateResourceInput): Promise<CloudResource> => ({
                id: String(input.values.databaseName),
                name: String(input.values.databaseName),
                cloud: 'azure',
                service: 'nosql',
                type: 'cosmos-database',
                region: null,
                createdAt: null,
                metadata: {},
            }),
            delete: async (id: string) => {
                deleted.push(id)
            },
        })])

        const createRes = await app.request('/api/clouds/azure/services/nosql/resources', {
            method: 'POST',
            body: JSON.stringify({databaseName: 'appdb'}),
        })
        const created = await createRes.json()
        const deleteRes = await app.request('/api/clouds/azure/services/nosql/resources/appdb', {method: 'DELETE'})

        expect(createRes.status).toBe(201)
        expect(created.type).toBe('cosmos-database')
        expect(created.name).toBe('appdb')
        expect(deleteRes.status).toBe(200)
        expect(deleted).toEqual(['appdb'])
    })

    test('creates and deletes Cosmos containers through the cloud NoSQL adapter', async () => {
        const deleted: Array<{databaseId: string; containerId: string}> = []
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'nosql',
            schema: azureNoSqlSchema,
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

        const createRes = await app.request('/api/clouds/azure/services/nosql/resources/appdb/containers', {
            method: 'POST',
            body: JSON.stringify({containerName: 'items', partitionKeyPath: '/category'}),
        })
        const created = await createRes.json()
        const deleteRes = await app.request('/api/clouds/azure/services/nosql/resources/appdb/containers/items', {method: 'DELETE'})

        expect(createRes.status).toBe(201)
        expect(created.databaseId).toBe('appdb')
        expect(created.partitionKeyPath).toBe('/category')
        expect(deleteRes.status).toBe(200)
        expect(deleted).toEqual([{databaseId: 'appdb', containerId: 'items'}])
    })

    test('upserts, deletes, and queries Cosmos items through the cloud NoSQL adapter', async () => {
        const deleted: Array<{databaseId: string; containerId: string; itemId: string; partitionKey?: string | null}> = []
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'nosql',
            schema: azureNoSqlSchema,
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

        const upsertRes = await app.request('/api/clouds/azure/services/nosql/resources/appdb/containers/items/items', {
            method: 'POST',
            body: JSON.stringify({id: 'item-1', category: 'demo'}),
        })
        const upserted = await upsertRes.json()
        const queryRes = await app.request('/api/clouds/azure/services/nosql/resources/appdb/containers/items/query', {
            method: 'POST',
            body: JSON.stringify({query: 'SELECT * FROM c'}),
        })
        const queryBody = await queryRes.json()
        const deleteRes = await app.request('/api/clouds/azure/services/nosql/resources/appdb/containers/items/items/item-1?partitionKey=demo', {method: 'DELETE'})

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
                    throw new RuntimeUnavailableError('Cannot reach Floci-AZ at http://localhost:4577: connection refused')
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
                    throw new NotImplementedByRuntimeError('Azure Blob request failed: HTTP 501')
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

    test('reports a missing adapter as unsupported rather than a runtime failure', async () => {
        const res = await appWithRoutes([mockAdapter('aws')]).request('/api/clouds/azure/services/storage/resources')
        const body = await res.json()

        expect(res.status).toBe(501)
        expect(body.code).toBe('operation_not_supported')
        expect(body.detail).toContain('No adapter registered for azure/storage')
    })

    test('maps a validation error to 400 with the adapter message intact', async () => {
        const app = appWithRoutes([
            mockAdapter('aws', {
                create: async () => {
                    throw new ValidationError('bucketName is required')
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources', {
            method: 'POST',
            body: JSON.stringify({}),
        })
        const body = await res.json()

        expect(res.status).toBe(400)
        expect(body.code).toBe('invalid_request')
        expect(body.message).toBe('bucketName is required')
    })

    // Before typed errors these AWS SDK failures all collapsed into a blanket 502.
    const sdkCases: Array<{name: string; status: number; code: string}> = [
        {name: 'BucketAlreadyOwnedByYou', status: 409, code: 'resource_conflict'},
        {name: 'AccessDenied', status: 403, code: 'access_denied'},
        {name: 'ValidationException', status: 400, code: 'invalid_request'},
        {name: 'ThrottlingException', status: 429, code: 'rate_limited'},
        {name: 'NoSuchBucket', status: 404, code: 'resource_not_found'},
    ]

    for (const sdkCase of sdkCases) {
        test(`maps the AWS SDK ${sdkCase.name} error to ${sdkCase.status}`, async () => {
            const app = appWithRoutes([
                mockAdapter('aws', {
                    create: async () => {
                        const err = new Error(`${sdkCase.name} raised by the runtime`)
                        err.name = sdkCase.name
                        Object.assign(err, {$metadata: {httpStatusCode: 500}, $fault: 'client'})
                        throw err
                    },
                }),
            ])
            const res = await app.request('/api/clouds/aws/services/storage/resources', {
                method: 'POST',
                body: JSON.stringify({name: 'demo'}),
            })
            const body = await res.json()

            expect(res.status).toBe(sdkCase.status)
            expect(body.code).toBe(sdkCase.code)
            expect(body.detail ?? body.message).toContain(sdkCase.name)
        })
    }
})

describe('service descriptors', () => {
    test('every descriptor carries nav metadata for every cloud', async () => {
        for (const cloud of ['aws', 'azure', 'gcp']) {
            const res = await appWithRoutes().request(`/api/clouds/${cloud}/services`)
            const body = await res.json()

            expect(res.status).toBe(200)
            expect(body.length).toBeGreaterThan(0)
            for (const descriptor of body) {
                expect(descriptor.cloud).toBe(cloud)
                expect(typeof descriptor.route).toBe('string')
                expect(descriptor.route.length).toBeGreaterThan(0)
                expect(typeof descriptor.iconKey).toBe('string')
                expect(typeof descriptor.group).toBe('string')
                expect(typeof descriptor.order).toBe('number')
                expect(descriptor.displayName.length).toBeGreaterThan(0)
            }
        }
    })

    test('every unavailable service explains itself', async () => {
        for (const cloud of ['aws', 'azure', 'gcp']) {
            const body = await (await appWithRoutes().request(`/api/clouds/${cloud}/services`)).json()
            const unexplained = body.filter(
                (d: {availability: string; reason?: string}) => d.availability === 'coming_soon' && !d.reason,
            )
            expect(unexplained).toEqual([])
        }
    })

    test('availability follows adapter registration rather than a hardcoded list', async () => {
        const withK8s = await (await appWithRoutes([
            mockAdapter('gcp', {service: 'k8s'}),
        ]).request('/api/clouds/gcp/services')).json()
        const withoutK8s = await (await appWithRoutes([mockAdapter('aws')]).request('/api/clouds/gcp/services')).json()

        const find = (body: Array<{service: string; reason?: string}>, service: string) =>
            body.find((d) => d.service === service)

        expect(find(withK8s, 'k8s')).toMatchObject({availability: 'available'})
        expect(find(withoutK8s, 'k8s')).toMatchObject({availability: 'coming_soon'})
        expect(find(withoutK8s, 'k8s')?.reason).toContain('GCP')
    })

    test('an adapter can report coming_soon when its runtime does not implement it', async () => {
        // floci-az answers 501 for /functions, so a registered adapter must still
        // be able to tell the truth about the runtime behind it.
        const app = appWithRoutes([
            mockAdapter('azure', {
                service: 'serverless',
                descriptorOverride: () => ({
                    availability: 'coming_soon',
                    reason: 'The Floci-AZ runtime returns 501 NotImplemented for the Azure Functions endpoint.',
                }),
            }),
        ])
        const body = await (await app.request('/api/clouds/azure/services')).json()
        const serverless = body.find((d: {service: string}) => d.service === 'serverless')

        expect(serverless.availability).toBe('coming_soon')
        expect(serverless.reason).toContain('501')
    })

    test('keeps the Secrets Manager page route while taking availability from the adapter', async () => {
        // Availability now comes from adapter registration like every other service,
        // but the absolute route is kept so the card still links to the standalone
        // page instead of Cloud Explorer. Without an adapter it reads coming_soon.
        const withAdapter = appWithRoutes([mockAdapter('aws'), mockAdapter('aws', {service: 'secrets'})])
        const aws = await (await withAdapter.request('/api/clouds/aws/services')).json()
        const bare = await (await appWithRoutes().request('/api/clouds/aws/services')).json()
        const gcp = await (await appWithRoutes().request('/api/clouds/gcp/services')).json()
        const secretsFor = (body: Array<{service: string}>) => body.find((d) => d.service === 'secrets')

        expect(secretsFor(aws)).toMatchObject({availability: 'available', route: '/secretsmanager'})
        expect(secretsFor(bare)).toMatchObject({availability: 'coming_soon'})
        expect(secretsFor(gcp)).toMatchObject({availability: 'coming_soon'})
    })
})

describe('per-service status', () => {
    test('reports a reachable service with a latency measurement', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/status')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body).toMatchObject({
            cloud: 'aws',
            service: 'storage',
            adapterRegistered: true,
            runtime: 'reachable',
            error: null,
            errorCode: null,
        })
        expect(body.latencyMs).toBeGreaterThanOrEqual(0)
    })

    test('reports coming_soon for a service with no adapter', async () => {
        const res = await appWithRoutes([mockAdapter('aws')]).request('/api/clouds/gcp/services/storage/status')
        const body = await res.json()

        expect(body).toMatchObject({runtime: 'coming_soon', adapterRegistered: false, latencyMs: null})
    })

    test('distinguishes a runtime that does not implement a service from one that is down', async () => {
        // This is the whole point of errorCode: floci-az serves blob storage but
        // answers 501 for functions, and the UI must not call that "offline".
        const app = appWithRoutes([
            mockAdapter('azure', {
                service: 'serverless',
                list: async () => {
                    throw new NotImplementedByRuntimeError('HTTP 501 /functions')
                },
            }),
            mockAdapter('gcp', {
                list: async () => {
                    throw new RuntimeUnavailableError('Cannot reach Floci-GCP')
                },
            }),
        ])

        const notImplemented = await (await app.request('/api/clouds/azure/services/serverless/status')).json()
        expect(notImplemented.runtime).toBe('unavailable')
        expect(notImplemented.errorCode).toBe('operation_not_implemented')

        const down = await (await app.request('/api/clouds/gcp/services/storage/status')).json()
        expect(down.errorCode).toBe('runtime_unavailable')
    })

    test('prefers an adapter health() override to list()', async () => {
        let listCalls = 0
        let healthCalls = 0
        const app = appWithRoutes([
            mockAdapter('aws', {
                list: async () => {
                    listCalls += 1
                    return []
                },
                health: async () => {
                    healthCalls += 1
                },
            }),
        ])

        await app.request('/api/clouds/aws/services/storage/status')
        expect(healthCalls).toBe(1)
        expect(listCalls).toBe(0)
    })

    test('omits per-service detail from the cloud status by default', async () => {
        const body = await (await appWithRoutes().request('/api/clouds/aws/status')).json()
        expect(body.services).toBeUndefined()
    })

    test('includes per-service detail only when asked', async () => {
        const body = await (await appWithRoutes().request('/api/clouds/aws/status?services=all')).json()

        expect(Array.isArray(body.services)).toBe(true)
        expect(body.services[0]).toMatchObject({cloud: 'aws', service: 'storage'})
    })

    test('caches probes so a polling sidebar does not fan out per request', async () => {
        let probes = 0
        const app = appWithRoutes([
            mockAdapter('aws', {
                list: async () => {
                    probes += 1
                    return []
                },
            }),
        ])

        for (let i = 0; i < 5; i += 1) {
            await app.request('/api/clouds/aws/services/storage/status')
        }
        expect(probes).toBe(1)
    })

    test('rejects an unknown service slug', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/queue/status')
        expect(res.status).toBe(404)
    })

    test('routes nested EKS nodegroup and Fargate actions through the cloud adapter', async () => {
        const calls: string[] = []
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'k8s',
            schema: awsEksSchema,
            listKubernetesNodegroups: async (clusterId) => [{
                id: 'workers', name: 'workers', clusterId, arn: null, status: 'ACTIVE', version: null,
                releaseVersion: null, createdAt: null, modifiedAt: null, capacityType: null,
                instanceTypes: ['t3.medium'], subnets: ['subnet-a'], nodeRole: null,
                scalingConfig: null, labels: {}, tags: {},
            }],
            createKubernetesNodegroup: async (clusterId, input) => {
                calls.push(`create-nodegroup:${clusterId}:${input.name}`)
                return {
                    id: input.name, name: input.name, clusterId, arn: null, status: null, version: null,
                    releaseVersion: null, createdAt: null, modifiedAt: null, capacityType: null,
                    instanceTypes: [], subnets: input.subnets, nodeRole: input.nodeRole,
                    scalingConfig: null, labels: {}, tags: {},
                }
            },
            deleteKubernetesNodegroup: async (clusterId, nodegroupId) => {
                calls.push(`delete-nodegroup:${clusterId}:${nodegroupId}`)
            },
            listKubernetesFargateProfiles: async (clusterId) => [{
                id: 'default', name: 'default', clusterId, arn: null, status: 'ACTIVE', createdAt: null,
                podExecutionRoleArn: null, subnets: [], selectors: [], tags: {},
            }],
            createKubernetesFargateProfile: async (clusterId, input) => {
                calls.push(`create-fargate:${clusterId}:${input.name}`)
                return {
                    id: input.name, name: input.name, clusterId, arn: null, status: null, createdAt: null,
                    podExecutionRoleArn: input.podExecutionRoleArn, subnets: input.subnets ?? [], selectors: [], tags: {},
                }
            },
            deleteKubernetesFargateProfile: async (clusterId, profileId) => {
                calls.push(`delete-fargate:${clusterId}:${profileId}`)
            },
        })])

        expect((await app.request('/api/clouds/aws/services/k8s/resources/demo/nodegroups')).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/k8s/resources/demo/nodegroups', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'workers', nodeRole: 'role', subnets: ['subnet-a']}),
        })).status).toBe(201)
        expect((await app.request('/api/clouds/aws/services/k8s/resources/demo/nodegroups/workers', {method: 'DELETE'})).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/k8s/resources/demo/fargate-profiles')).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/k8s/resources/demo/fargate-profiles', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'default', podExecutionRoleArn: 'role', selectors: [{namespace: 'default'}]}),
        })).status).toBe(201)
        expect((await app.request('/api/clouds/aws/services/k8s/resources/demo/fargate-profiles/default', {method: 'DELETE'})).status).toBe(200)

        expect(calls).toEqual([
            'create-nodegroup:demo:workers',
            'delete-nodegroup:demo:workers',
            'create-fargate:demo:default',
            'delete-fargate:demo:default',
        ])
    })
})
