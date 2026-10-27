import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {httpStatusToCloudError, NotImplementedByRuntimeError, RuntimeError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'
import type {
    ChildCollection,
    ChildItem,
    CollectionPage,
    DocumentStoreAdapter,
    ItemStoreAdapter,
} from '../cloud-spi/childCollections'
import {awsDatabaseSchema, azureDatabaseSchema} from '../cloud-spi/databaseSchema'
import {awsLogsSchema, gcpLogsSchema} from '../cloud-spi/logsSchema'
import {awsMessagingSchema} from '../cloud-spi/messagingSchema'
import {awsKinesisSchema, ociStreamingSchema} from '../cloud-spi/kinesisSchema'
import {azureNoSqlSchema} from '../cloud-spi/noSqlSchema'
import {awsDynamoDbSchema} from '../cloud-spi/dynamodbSchema'
import {awsEksSchema} from '../cloud-spi/eksSchema'
import {awsKmsSchema, azureKmsSchema, ociKmsSchema} from '../cloud-spi/kmsSchema'
import {azureCertificatesSchema} from '../cloud-spi/certificatesSchema'
import {azureSecretsSchema} from '../cloud-spi/secretsSchema'
import {awsStorageSchema, azureStorageSchema, gcpStorageSchema} from '../cloud-spi/storageSchema'
import {awsSesEmailSchema} from '../cloud-spi/emailSchema'
import {awsAppConfigSchema} from '../cloud-spi/appConfigSchema'
import type {
    AppConfigConfigurationProfile,
    AppConfigDeployment,
    AppConfigDeploymentStrategy,
    AppConfigEnvironment,
    AppConfigHostedConfigurationVersion,
    CloudProvider,
    CloudResource,
    CloudServiceAdapter,
    CosmosContainer,
    CosmosItem,
    CosmosQueryResult,
    CreateDatabaseSnapshotInput,
    CreateResourceInput,
    DatabaseSnapshot,
    LogsInsightsQueryResult,
    QueueMessage,
} from '../cloud-spi/types'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import type {RuntimeProbe} from '../service/runtimeProbe'
import {DELETE_BATCH_TIMEOUT_MS} from '../adapter-aws/AwsStorageAdapter'
import {AwsSesAdapter} from '../adapter-aws/AwsSesAdapter'
import {createCloudRoutes, EMPTY_BUCKET_DEADLINE_MS, EMPTY_BUCKET_IDLE_TIMEOUT_SECONDS} from './clouds'

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
    return {aws: reachable, azure: reachable, gcp: reachable, oci: reachable, ...overrides}
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

const databaseSnapshot: DatabaseSnapshot = {
    id: 'orders-db-snapshot-1',
    name: 'orders-db-snapshot-1',
    instanceIdentifier: 'orders-db',
    status: 'available',
    engine: 'postgres',
    version: '16.4',
    createdAt: '2026-08-14T09:30:00.000Z',
    metadata: {snapshotType: 'manual'},
}

describe('database snapshot routes', () => {
    test('lists snapshots with the exact optional instance filter', async () => {
        let delegatedIdentifier: string | undefined
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'database',
            schema: awsDatabaseSchema,
            listDatabaseSnapshots: async (instanceIdentifier) => {
                delegatedIdentifier = instanceIdentifier
                return [databaseSnapshot]
            },
        })])

        const res = await app.request(
            '/api/clouds/aws/services/database/snapshots?instanceIdentifier=orders-db',
        )

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([databaseSnapshot])
        expect(delegatedIdentifier).toBe('orders-db')
    })

    test('creates a snapshot with the raw two-field input', async () => {
        let delegatedInput: CreateDatabaseSnapshotInput | undefined
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'database',
            schema: awsDatabaseSchema,
            createDatabaseSnapshot: async (input) => {
                delegatedInput = input
                return databaseSnapshot
            },
        })])
        const input = {
            instanceIdentifier: 'orders-db',
            snapshotIdentifier: 'orders-db-snapshot-1',
        }

        const res = await app.request('/api/clouds/aws/services/database/snapshots', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(input),
        })

        expect(res.status).toBe(201)
        expect(await res.json()).toEqual(databaseSnapshot)
        expect(delegatedInput).toEqual(input)
    })

    test('returns 501 when the database adapter lacks either snapshot method', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'database',
            schema: awsDatabaseSchema,
        })])

        const listRes = await app.request('/api/clouds/aws/services/database/snapshots')
        const createRes = await app.request('/api/clouds/aws/services/database/snapshots', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                instanceIdentifier: 'orders-db',
                snapshotIdentifier: 'orders-db-snapshot-1',
            }),
        })

        expect(listRes.status).toBe(501)
        expect((await listRes.json()).code).toBe('operation_not_supported')
        expect(createRes.status).toBe(501)
        expect((await createRes.json()).code).toBe('operation_not_supported')
    })

    test('maps adapter snapshot validation errors to 400', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'database',
            schema: awsDatabaseSchema,
            createDatabaseSnapshot: async () => {
                throw new ValidationError('snapshotIdentifier is required')
            },
        })])

        const res = await app.request('/api/clouds/aws/services/database/snapshots', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({instanceIdentifier: 'orders-db', snapshotIdentifier: ''}),
        })
        expect(res.status).toBe(400)
        const body = await res.json()

        expect(body).toMatchObject({
            code: 'invalid_request',
            message: 'snapshotIdentifier is required',
        })
    })

    test('maps AWS UnsupportedOperation snapshot errors through the shared mapper', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'database',
            schema: awsDatabaseSchema,
            listDatabaseSnapshots: async () => {
                throw Object.assign(new Error('RDS snapshots are unavailable'), {
                    name: 'UnsupportedOperation',
                    $fault: 'client',
                    $metadata: {httpStatusCode: 500},
                })
            },
        })])

        const res = await app.request('/api/clouds/aws/services/database/snapshots')
        expect(res.status).toBe(501)
        const body = await res.json()

        expect(body.code).toBe('operation_not_implemented')
        expect(body.detail).toBe('RDS snapshots are unavailable')
    })

    test('lists orderable instance classes with engine filter', async () => {
        let delegatedEngine: string | undefined
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'database',
            schema: awsDatabaseSchema,
            listDatabaseOrderableInstanceClasses: async (engine) => {
                delegatedEngine = engine
                return ['db.t3.micro', 'db.m8g.large']
            },
        })])

        const res = await app.request(
            '/api/clouds/aws/services/database/orderable-classes?engine=postgres',
        )

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(['db.t3.micro', 'db.m8g.large'])
        expect(delegatedEngine).toBe('postgres')
    })
})

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
            expect(await res.json()).toEqual({
                error: 'Resource not found',
                code: 'resource_not_found',
                message: 'Resource not found',
                detail: 'Schema not available',
            })
        }
    })

    test('rejects a service slug that is not in the catalog', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/not-a-service/schema')

        expect(res.status).toBe(404)
        expect((await res.json()).detail).toBe('Unknown cloud or service')
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

    // DynamoDB used to have its own nosql item routes; they are gone, so the
    // generic flat-item routes must answer for it.
    test('lists DynamoDB records through the flat item store', async () => {
        let seen: unknown
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'nosql',
            schema: awsDynamoDbSchema,
            items: {
                listItems: async (resourceId, page) => {
                    seen = {resourceId, page}
                    return {
                        items: [{id: '{"pk":"item-1"}', collectionId: null, timestamp: null, body: {pk: 'item-1'}, metadata: {key: {pk: 'item-1'}}}],
                        nextCursor: 'cursor-2',
                    }
                },
            },
        })])

        const res = await app.request('/api/clouds/aws/services/nosql/resources/orders/items?limit=50')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(seen).toEqual({resourceId: 'orders', page: {cursor: undefined, limit: 50}})
        expect(body.items[0].metadata.key).toEqual({pk: 'item-1'})
        expect(body.nextCursor).toBe('cursor-2')
    })

    test('puts a DynamoDB record through the flat item store', async () => {
        const calls: Array<{resourceId: string; body: Record<string, unknown>}> = []
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'nosql',
            schema: awsDynamoDbSchema,
            items: {
                listItems: async () => ({items: [], nextCursor: null}),
                putItem: async (resourceId, body) => {
                    calls.push({resourceId, body})
                    return {id: JSON.stringify({pk: body.pk}), collectionId: null, timestamp: null, body, metadata: {key: {pk: body.pk}}}
                },
            },
        })])

        const res = await app.request('/api/clouds/aws/services/nosql/resources/orders/items', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({pk: 'item-1', name: 'First item'}),
        })
        const body = await res.json()

        expect(res.status).toBe(201)
        expect(body.metadata.key).toEqual({pk: 'item-1'})
        expect(calls).toEqual([{resourceId: 'orders', body: {pk: 'item-1', name: 'First item'}}])
    })

    test('returns raw MIME email search results and previews through the real routes and adapter', async () => {
        const raw = Buffer.from([
            'From: sender@example.test',
            'To: recipient@example.test',
            'Subject: Raw email through the router',
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '', '<p>Rendered through the mailbox API.</p>',
        ].join('\r\n')).toString('base64')
        const adapter = new AwsSesAdapter('http://floci.test', async () => Response.json({
            messages: [{Id: 'raw-router-email', RawData: raw}],
        }))
        const app = appWithRoutes([adapter])

        const list = await app.request('/api/clouds/aws/services/email/resources?search=recipient%40example.test')
        const resources = await list.json()

        expect(list.status).toBe(200)
        expect(resources).toHaveLength(1)
        expect(resources[0]).toMatchObject({
            id: 'raw-router-email', name: 'Raw email through the router',
            metadata: {
                source: 'sender@example.test', toAddresses: ['recipient@example.test'],
                htmlBody: expect.stringContaining('<p>Rendered through the mailbox API.</p>'),
                rawData: raw,
            },
        })

        const detail = await app.request('/api/clouds/aws/services/email/resources/raw-router-email')
        expect(detail.status).toBe(200)
        expect(await detail.json()).toEqual(resources[0])
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

    test('routes GCP log entry queries to the generic item query handler', async () => {
        const logName = 'projects/floci-local/logs/app'
        const entries: CollectionPage<ChildItem> = {items: [], nextCursor: null}
        let received: unknown
        const app = appWithRoutes([mockAdapter('gcp', {
            service: 'logs',
            schema: gcpLogsSchema,
            items: {
                listItems: async () => entries,
                queryItems: async (resourceId, query, page) => {
                    received = {resourceId, query, page}
                    return entries
                },
            },
        })])

        const res = await app.request(`/api/clouds/gcp/services/logs/resources/${encodeURIComponent(logName)}/query`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({query: 'severity>=ERROR', cursor: 'next-page', limit: 25}),
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(entries)
        expect(received).toEqual({resourceId: logName, query: 'severity>=ERROR', page: {cursor: 'next-page', limit: 25}})
    })

    test('runs a Logs Insights query through the route', async () => {
        let received: {logGroupName?: string | string[]; queryString?: string; startTime?: number; endTime?: number; limit?: number} = {}
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'logs',
            schema: awsLogsSchema,
            queryLogs: async (logGroupName, input): Promise<LogsInsightsQueryResult> => {
                received = {logGroupName, ...input}
                return {queryId: 'q-1', status: 'Complete', rows: [{'@message': 'hello'}]}
            },
        })])

        const res = await app.request('/api/clouds/aws/services/logs/resources/%2Ffloci%2Fprobe/query', {
            method: 'POST',
            body: JSON.stringify({queryString: 'fields @message', startTime: 1000, endTime: 2000}),
        })
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body).toEqual({queryId: 'q-1', status: 'Complete', rows: [{'@message': 'hello'}]})
        expect(received).toEqual({logGroupName: '/floci/probe', queryString: 'fields @message', startTime: 1000, endTime: 2000, limit: undefined})
    })

    test('rejects a Logs Insights query with a non-string queryString before calling the adapter', async () => {
        let called = false
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'logs',
            schema: awsLogsSchema,
            queryLogs: async (): Promise<LogsInsightsQueryResult> => {
                called = true
                return {queryId: 'q-1', status: 'Complete', rows: []}
            },
        })])

        const res = await app.request('/api/clouds/aws/services/logs/resources/%2Ffloci%2Fprobe/query', {
            method: 'POST',
            body: JSON.stringify({queryString: 123, startTime: 1000, endTime: 2000}),
        })

        expect(res.status).toBe(400)
        expect(called).toBe(false)
    })

    test('rejects a Logs Insights query with a missing startTime before calling the adapter', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'logs',
            schema: awsLogsSchema,
            queryLogs: async (): Promise<LogsInsightsQueryResult> => ({queryId: 'q-1', status: 'Complete', rows: []}),
        })])

        const res = await app.request('/api/clouds/aws/services/logs/resources/%2Ffloci%2Fprobe/query', {
            method: 'POST',
            body: JSON.stringify({queryString: 'fields @message', endTime: 2000}),
        })

        expect(res.status).toBe(400)
    })

    test('runs a Logs Insights query across multiple log groups through the service-level route', async () => {
        let received: {logGroupNames?: string[]; queryString?: string; startTime?: number; endTime?: number; limit?: number} = {}
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'logs',
            schema: awsLogsSchema,
            queryLogs: async (logGroupNames, input): Promise<LogsInsightsQueryResult> => {
                received = {logGroupNames: logGroupNames as string[], ...input}
                return {queryId: 'q-multi', status: 'Complete', rows: [{'@message': 'hello'}]}
            },
        })])

        const res = await app.request('/api/clouds/aws/services/logs/query', {
            method: 'POST',
            body: JSON.stringify({
                logGroupNames: ['/floci/probe', '/floci/probe-two'],
                queryString: 'fields @message',
                startTime: 1000,
                endTime: 2000,
            }),
        })
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body).toEqual({queryId: 'q-multi', status: 'Complete', rows: [{'@message': 'hello'}]})
        expect(received).toEqual({
            logGroupNames: ['/floci/probe', '/floci/probe-two'],
            queryString: 'fields @message',
            startTime: 1000,
            endTime: 2000,
            limit: undefined,
        })
    })

    test('rejects a multi-group Logs Insights query with an empty logGroupNames array', async () => {
        let called = false
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'logs',
            schema: awsLogsSchema,
            queryLogs: async (): Promise<LogsInsightsQueryResult> => {
                called = true
                return {queryId: 'q-1', status: 'Complete', rows: []}
            },
        })])

        const res = await app.request('/api/clouds/aws/services/logs/query', {
            method: 'POST',
            body: JSON.stringify({logGroupNames: [], queryString: 'fields @message', startTime: 1000, endTime: 2000}),
        })

        expect(res.status).toBe(400)
        expect(called).toBe(false)
    })

    test('rejects a multi-group Logs Insights query over the log group limit', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'logs',
            schema: awsLogsSchema,
            queryLogs: async (): Promise<LogsInsightsQueryResult> => ({queryId: 'q-1', status: 'Complete', rows: []}),
        })])

        const res = await app.request('/api/clouds/aws/services/logs/query', {
            method: 'POST',
            body: JSON.stringify({
                logGroupNames: Array.from({length: 51}, (_, i) => `/floci/group-${i}`),
                queryString: 'fields @message',
                startTime: 1000,
                endTime: 2000,
            }),
        })

        expect(res.status).toBe(400)
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

    test('rejects non-object resource create bodies before calling the adapter', async () => {
        const adapter = mockAdapter('aws')
        let delegatedValues: Record<string, unknown> | undefined
        let calls = 0
        const app = appWithRoutes([mockAdapter('aws', {
            create: async (input) => {
                calls += 1
                delegatedValues = input.values
                return adapter.create(input)
            },
        })])
        const path = '/api/clouds/aws/services/storage/resources'

        for (const payload of ['null', '[]', '"text"', '42', 'true', '{']) {
            const res = await app.request(path, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: payload,
            })
            expect(res.status).toBe(400)
            expect((await res.json()).code).toBe('invalid_request')
        }
        expect(calls).toBe(0)

        const valid = await app.request(path, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({bucketName: 'orders'}),
        })
        expect(valid.status).toBe(201)
        expect(calls).toBe(1)
        expect(delegatedValues).toEqual({bucketName: 'orders'})
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

describe('KMS crypto routes', () => {
    test('signs and verifies with no-store responses and binary-safe payloads', async () => {
        let signedMessage: Uint8Array | undefined
        let verifiedSignature: Uint8Array | undefined
        const app = appWithRoutes([mockAdapter('oci', {
            service: 'kms', schema: ociKmsSchema,
            sign: async (id, input) => {
                signedMessage = input.message
                return {signature: new Uint8Array([1, 2, 3]), keyId: id, keyVersionId: 'version-1', signingAlgorithm: input.signingAlgorithm}
            },
            verify: async (_id, input) => {
                verifiedSignature = input.signature
                return {isSignatureValid: false}
            },
        })])
        const route = '/api/clouds/oci/services/kms/resources/key-1'
        const sign = await app.request(`${route}/sign`, {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({messageBase64: 'aGVsbG8=', signingAlgorithm: 'ECDSA_SHA_256'}),
        })
        expect(sign.status).toBe(200)
        expect(sign.headers.get('cache-control')).toBe('no-store')
        expect(new TextDecoder().decode(signedMessage)).toBe('hello')
        expect(await sign.json()).toEqual({signatureBase64: 'AQID', keyId: 'key-1', keyVersionId: 'version-1', signingAlgorithm: 'ECDSA_SHA_256'})

        const verify = await app.request(`${route}/verify`, {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({messageBase64: 'aGVsbG8=', signatureBase64: 'AQID', keyVersionId: 'version-1', signingAlgorithm: 'ECDSA_SHA_256'}),
        })
        expect(verify.status).toBe(200)
        expect(verify.headers.get('cache-control')).toBe('no-store')
        expect(verifiedSignature).toEqual(new Uint8Array([1, 2, 3]))
        expect(await verify.json()).toEqual({isSignatureValid: false})
    })

    test('rejects malformed signature data before the adapter sees it', async () => {
        let calls = 0
        const app = appWithRoutes([mockAdapter('oci', {
            service: 'kms', schema: ociKmsSchema,
            verify: async () => { calls += 1; return {isSignatureValid: true} },
        })])
        const response = await app.request('/api/clouds/oci/services/kms/resources/key-1/verify', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({messageBase64: 'AQ==', signatureBase64: 'not base64', keyVersionId: 'version-1', signingAlgorithm: 'ECDSA_SHA_256'}),
        })
        expect(response.status).toBe(400)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(calls).toBe(0)
    })

    test('does not echo OCI provider signing errors or the message', async () => {
        const secret = 'private signing payload'
        for (const status of [400, 503]) {
            const app = appWithRoutes([mockAdapter('oci', {
                service: 'kms', schema: ociKmsSchema,
                sign: async () => {
                    throw httpStatusToCloudError(status, `OCI runtime request failed: HTTP ${status} /20180608/sign - ${secret}`)
                },
            })])
            const response = await app.request('/api/clouds/oci/services/kms/resources/key-1/sign', {
                method: 'POST', headers: {'content-type': 'application/json'},
                body: JSON.stringify({messageBase64: Buffer.from(secret).toString('base64'), signingAlgorithm: 'ECDSA_SHA_256'}),
            })
            const text = await response.text()
            expect(response.status).toBe(status)
            expect(response.headers.get('cache-control')).toBe('no-store')
            expect(text).not.toContain(secret)
            expect(text).not.toContain(Buffer.from(secret).toString('base64'))
            expect(JSON.parse(text).detail).toBeUndefined()
        }
    })

    test('dispatches compute power verbs and answers with the instance read back', async () => {
        const called: string[] = []
        let status = 'RUNNING'
        const resource = (): CloudResource => ({id: 'us-central1-a/vm1', name: 'vm1', cloud: 'gcp', service: 'compute', type: 'instance', region: null, createdAt: null, status, metadata: {}})
        const app = appWithRoutes([mockAdapter('gcp', {
            service: 'compute',
            get: async () => resource(),
            start: async (id) => { called.push(`start:${id}`); status = 'RUNNING' },
            stop: async (id) => { called.push(`stop:${id}`); status = 'TERMINATED' },
            reboot: async (id) => { called.push(`reboot:${id}`) },
        })])
        const route = '/api/clouds/gcp/services/compute/resources/us-central1-a%2Fvm1'
        const stopped = await app.request(`${route}/stop`, {method: 'POST'})
        expect(stopped.status).toBe(200)
        expect(await stopped.json()).toMatchObject({status: 'TERMINATED'})
        expect((await app.request(`${route}/start`, {method: 'POST'})).status).toBe(200)
        expect((await app.request(`${route}/reboot`, {method: 'POST'})).status).toBe(200)
        expect(called).toEqual(['stop:us-central1-a/vm1', 'start:us-central1-a/vm1', 'reboot:us-central1-a/vm1'])
    })

    test('a compute adapter without a power verb answers 501', async () => {
        const app = appWithRoutes([mockAdapter('gcp', {service: 'compute'})])
        const response = await app.request('/api/clouds/gcp/services/compute/resources/vm1/start', {method: 'POST'})
        expect(response.status).toBe(501)
    })

    test('dispatches rotation and deletion cancellation to the selected key', async () => {
        const called: string[] = []
        const resource: CloudResource = {id: 'key-1', name: 'key-1', cloud: 'oci', service: 'kms', type: 'key', region: null, createdAt: null, metadata: {}}
        const app = appWithRoutes([mockAdapter('oci', {
            service: 'kms', schema: ociKmsSchema,
            rotate: async (id) => { called.push(`rotate:${id}`); return resource },
            cancelDeletion: async (id) => { called.push(`cancel:${id}`); return resource },
        })])
        const route = '/api/clouds/oci/services/kms/resources/key-1'
        expect((await app.request(`${route}/rotate`, {method: 'POST'})).status).toBe(200)
        expect((await app.request(`${route}/cancel-deletion`, {method: 'POST'})).status).toBe(200)
        expect(called).toEqual(['rotate:key-1', 'cancel:key-1'])
    })

    test('dispatches secret recovery and purge to the selected deleted secret', async () => {
        const called: string[] = []
        const resource: CloudResource = {id: 'db-password', name: 'db-password', cloud: 'azure', service: 'secrets', type: 'secret', region: null, createdAt: null, metadata: {}}
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'secrets', schema: azureSecretsSchema,
            recover: async (id) => { called.push(`recover:${id}`); return resource },
            purgeDeleted: async (id) => { called.push(`purge:${id}`) },
        })])
        const route = '/api/clouds/azure/services/secrets/resources/db-password'
        const recovered = await app.request(`${route}/recover`, {method: 'POST'})
        expect(recovered.status).toBe(200)
        expect(await recovered.json()).toMatchObject({id: 'db-password'})
        expect((await app.request(`${route}/purge-deleted`, {method: 'POST'})).status).toBe(200)
        expect(called).toEqual(['recover:db-password', 'purge:db-password'])
    })

    test('dispatches key recovery and purge to the selected deleted key', async () => {
        const called: string[] = []
        const resource: CloudResource = {id: 'app-key', name: 'app-key', cloud: 'azure', service: 'kms', type: 'key', region: null, createdAt: null, metadata: {}}
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'kms', schema: azureKmsSchema,
            recover: async (id) => { called.push(`recover:${id}`); return resource },
            purgeDeleted: async (id) => { called.push(`purge:${id}`) },
        })])
        const route = '/api/clouds/azure/services/kms/resources/app-key'
        const recovered = await app.request(`${route}/recover`, {method: 'POST'})
        expect(recovered.status).toBe(200)
        expect(await recovered.json()).toMatchObject({id: 'app-key'})
        expect((await app.request(`${route}/purge-deleted`, {method: 'POST'})).status).toBe(200)
        expect(called).toEqual(['recover:app-key', 'purge:app-key'])
    })

    test('dispatches certificate recovery and purge to the selected deleted certificate', async () => {
        const called: string[] = []
        const resource: CloudResource = {id: 'app-tls', name: 'app-tls', cloud: 'azure', service: 'certificates', type: 'certificate', region: null, createdAt: null, metadata: {}}
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'certificates', schema: azureCertificatesSchema,
            recover: async (id) => { called.push(`recover:${id}`); return resource },
            purgeDeleted: async (id) => { called.push(`purge:${id}`) },
        })])
        const route = '/api/clouds/azure/services/certificates/resources/app-tls'
        const recovered = await app.request(`${route}/recover`, {method: 'POST'})
        expect(recovered.status).toBe(200)
        expect(await recovered.json()).toMatchObject({id: 'app-tls'})
        expect((await app.request(`${route}/purge-deleted`, {method: 'POST'})).status).toBe(200)
        expect(called).toEqual(['recover:app-tls', 'purge:app-tls'])
    })

    test('reports certificate recovery as unsupported when the adapter has no recover', async () => {
        const app = appWithRoutes([mockAdapter('azure', {service: 'certificates', schema: azureCertificatesSchema})])
        const route = '/api/clouds/azure/services/certificates/resources/app-tls'

        expect((await app.request(`${route}/recover`, {method: 'POST'})).status).toBe(501)
        expect((await app.request(`${route}/purge-deleted`, {method: 'POST'})).status).toBe(501)
    })

    test('reports key recovery as unsupported when the adapter has no recover', async () => {
        const app = appWithRoutes([mockAdapter('azure', {service: 'kms', schema: azureKmsSchema})])
        const route = '/api/clouds/azure/services/kms/resources/app-key'

        expect((await app.request(`${route}/recover`, {method: 'POST'})).status).toBe(501)
        expect((await app.request(`${route}/purge-deleted`, {method: 'POST'})).status).toBe(501)
    })

    test('reports secret recovery as unsupported when the adapter has no recover', async () => {
        const app = appWithRoutes([mockAdapter('azure', {service: 'secrets', schema: azureSecretsSchema})])
        const route = '/api/clouds/azure/services/secrets/resources/db-password'

        expect((await app.request(`${route}/recover`, {method: 'POST'})).status).toBe(501)
        expect((await app.request(`${route}/purge-deleted`, {method: 'POST'})).status).toBe(501)
    })

    test('passes the deleted view state to the secrets list', async () => {
        let received: Record<string, string> | undefined
        const app = appWithRoutes([mockAdapter('azure', {
            service: 'secrets', schema: azureSecretsSchema,
            list: async (query) => { received = query?.filters; return [] },
        })])

        expect((await app.request('/api/clouds/azure/services/secrets/resources?state=deleted')).status).toBe(200)
        expect(received).toEqual({state: 'deleted'})
    })

    test('decodes plaintext and encodes the ciphertext response', async () => {
        let delegatedId = ''
        let delegatedPlaintext: Uint8Array | undefined
        let delegatedContext: Record<string, string> | undefined
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'kms',
            schema: awsKmsSchema,
            encrypt: async (id, input) => {
                delegatedId = id
                delegatedPlaintext = input.plaintext
                delegatedContext = input.encryptionContext
                return {
                    ciphertextBlob: new Uint8Array([1, 2, 3]),
                    keyId: id,
                    encryptionAlgorithm: input.encryptionAlgorithm,
                }
            },
        })])

        const res = await app.request('/api/clouds/aws/services/kms/resources/key-1/encrypt', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                plaintextBase64: Buffer.from('hello').toString('base64'),
                encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
                encryptionContext: {purpose: 'test'},
            }),
        })
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(delegatedId).toBe('key-1')
        expect(new TextDecoder().decode(delegatedPlaintext)).toBe('hello')
        expect(delegatedContext).toEqual({purpose: 'test'})
        expect(body).toEqual({
            ciphertextBlobBase64: 'AQID',
            keyId: 'key-1',
            encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
        })
        expect(res.headers.get('cache-control')).toBe('no-store')
    })

    test('decodes ciphertext and encodes the plaintext response', async () => {
        let delegatedCiphertext: Uint8Array | undefined
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'kms',
            schema: awsKmsSchema,
            decrypt: async (id, input) => {
                delegatedCiphertext = input.ciphertextBlob
                return {
                    plaintext: new TextEncoder().encode('round trip'),
                    keyId: id,
                    encryptionAlgorithm: input.encryptionAlgorithm,
                }
            },
        })])

        const res = await app.request('/api/clouds/aws/services/kms/resources/key-1/decrypt', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                ciphertextBlobBase64: 'AQID',
                encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
            }),
        })
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(delegatedCiphertext).toEqual(new Uint8Array([1, 2, 3]))
        expect(Buffer.from(body.plaintextBase64, 'base64').toString('utf8')).toBe('round trip')
        expect(res.headers.get('cache-control')).toBe('no-store')
    })

    test('rejects non-canonical base64 before calling the adapter', async () => {
        let calls = 0
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'kms',
            schema: awsKmsSchema,
            encrypt: async () => {
                calls += 1
                throw new Error('must not be called')
            },
        })])

        const res = await app.request('/api/clouds/aws/services/kms/resources/key-1/encrypt', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                plaintextBase64: 'not base64',
                encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
            }),
        })
        const body = await res.json()

        expect(res.status).toBe(400)
        expect(body.code).toBe('invalid_request')
        expect(body.message).toContain('canonical base64')
        expect(calls).toBe(0)
        expect(res.headers.get('cache-control')).toBe('no-store')
    })

    test('rejects malformed JSON as a caller error', async () => {
        const app = appWithRoutes([mockAdapter('aws', {service: 'kms', schema: awsKmsSchema})])
        const res = await app.request('/api/clouds/aws/services/kms/resources/key-1/decrypt', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{',
        })
        const body = await res.json()

        expect(res.status).toBe(400)
        expect(body.message).toBe('Request body must be valid JSON')
        expect(res.headers.get('cache-control')).toBe('no-store')
    })

    test('maps provider contract failures to 502 without echoing request data', async () => {
        const secretMarker = 'plaintext-that-must-not-be-returned'
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'kms',
            schema: awsKmsSchema,
            encrypt: async () => {
                throw new RuntimeError('KMS did not return ciphertext')
            },
        })])

        const res = await app.request('/api/clouds/aws/services/kms/resources/key-1/encrypt', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                plaintextBase64: Buffer.from(secretMarker).toString('base64'),
                encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
            }),
        })
        const responseText = await res.text()

        expect(res.status).toBe(502)
        expect(responseText).not.toContain(secretMarker)
        expect(responseText).not.toContain(Buffer.from(secretMarker).toString('base64'))
        expect(res.headers.get('cache-control')).toBe('no-store')
    })

    test('sanitizes provider validation text for crypto requests', async () => {
        const secretMarker = 'provider-echoed-sensitive-value'
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'kms',
            schema: awsKmsSchema,
            encrypt: async () => {
                throw Object.assign(new Error(secretMarker), {
                    name: 'ValidationException',
                    $fault: 'client',
                    $metadata: {httpStatusCode: 400},
                })
            },
        })])

        const res = await app.request('/api/clouds/aws/services/kms/resources/key-1/encrypt', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                plaintextBase64: 'AQ==',
                encryptionAlgorithm: 'SYMMETRIC_DEFAULT',
            }),
        })
        const responseText = await res.text()

        expect(res.status).toBe(400)
        expect(responseText).not.toContain(secretMarker)
        expect(responseText).toContain('KMS rejected the request')
        expect(res.headers.get('cache-control')).toBe('no-store')
    })
})

describe('service descriptors', () => {
    test('every descriptor carries nav metadata for every cloud', async () => {
        for (const cloud of ['aws', 'azure', 'gcp', 'oci']) {
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
                expect(descriptor.description.length).toBeGreaterThan(0)
            }
        }
    })

    test('returns the provider-specific service introduction', async () => {
        const aws = await (await appWithRoutes().request('/api/clouds/aws/services')).json()
        const gcp = await (await appWithRoutes().request('/api/clouds/gcp/services')).json()

        expect(aws.find((d: {service: string}) => d.service === 'messaging').description)
            .toBe('Queue messages between applications.')
        expect(gcp.find((d: {service: string}) => d.service === 'messaging').description)
            .toBe('Publish and subscribe to messages across applications.')
    })

    test('every unavailable service explains itself', async () => {
        for (const cloud of ['aws', 'azure', 'gcp', 'oci']) {
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

    test('routes AWS secrets to its bespoke page and GCP to the generic explorer', async () => {
        // Availability now comes from adapter registration like every other service,
        // but the absolute route is kept so the card still links to the standalone
        // page instead of Cloud Explorer. Without an adapter it reads coming_soon.
        const withAdapter = appWithRoutes([
            mockAdapter('aws'),
            mockAdapter('aws', {service: 'secrets'}),
            mockAdapter('gcp', {service: 'secrets'}),
        ])
        const aws = await (await withAdapter.request('/api/clouds/aws/services')).json()
        const bare = await (await appWithRoutes().request('/api/clouds/aws/services')).json()
        const gcp = await (await withAdapter.request('/api/clouds/gcp/services')).json()
        const secretsFor = (body: Array<{service: string}>) => body.find((d) => d.service === 'secrets')

        expect(secretsFor(aws)).toMatchObject({availability: 'available', route: '/secretsmanager'})
        expect(secretsFor(bare)).toMatchObject({availability: 'coming_soon'})
        expect(secretsFor(gcp)).toMatchObject({availability: 'available', route: 'secrets'})
    })
})

describe('AppConfig nested routes', () => {
    test('routes AppConfig operations through the adapter', async () => {
        const calls: string[] = []
        const environment: AppConfigEnvironment = {
            id: 'env-1',
            applicationId: 'app-1',
            name: 'dev',
            description: null,
            state: 'READY_FOR_DEPLOYMENT',
        }
        const profile: AppConfigConfigurationProfile = {
            id: 'profile-1',
            applicationId: 'app-1',
            name: 'settings',
            description: null,
            locationUri: 'hosted',
            type: 'AWS.Freeform',
        }
        const version: AppConfigHostedConfigurationVersion = {
            id: 'profile-1:1',
            applicationId: 'app-1',
            configurationProfileId: 'profile-1',
            versionNumber: 1,
            description: null,
            contentType: 'application/json',
            content: '{"enabled":true}',
        }
        const strategy: AppConfigDeploymentStrategy = {
            id: 'strategy-1',
            name: 'immediate',
            description: null,
            deploymentDurationInMinutes: 0,
            growthType: 'LINEAR',
            growthFactor: 100,
            finalBakeTimeInMinutes: 0,
            replicateTo: 'NONE',
        }
        const deployment: AppConfigDeployment = {
            applicationId: 'app-1',
            environmentId: 'env-1',
            deploymentNumber: 1,
            configurationProfileId: 'profile-1',
            configurationVersion: '1',
            deploymentStrategyId: 'strategy-1',
            state: 'COMPLETE',
            percentageComplete: 100,
            startedAt: null,
            completedAt: null,
            description: null,
        }
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'configuration',
            schema: awsAppConfigSchema,
            listAppConfigEnvironments: async (applicationId) => {
                calls.push(`list-environments:${applicationId}`)
                return [environment]
            },
            createAppConfigEnvironment: async (applicationId, input) => {
                calls.push(`create-environment:${applicationId}:${input.values.name}`)
                return environment
            },
            deleteAppConfigEnvironment: async (applicationId, environmentId) => {
                calls.push(`delete-environment:${applicationId}:${environmentId}`)
            },
            listAppConfigConfigurationProfiles: async (applicationId) => {
                calls.push(`list-profiles:${applicationId}`)
                return [profile]
            },
            createAppConfigConfigurationProfile: async (applicationId, input) => {
                calls.push(`create-profile:${applicationId}:${input.values.name}`)
                return profile
            },
            deleteAppConfigConfigurationProfile: async (applicationId, profileId) => {
                calls.push(`delete-profile:${applicationId}:${profileId}`)
            },
            listAppConfigHostedConfigurationVersions: async (applicationId, profileId) => {
                calls.push(`list-versions:${applicationId}:${profileId}`)
                return [version]
            },
            getAppConfigHostedConfigurationVersion: async (applicationId, profileId, versionNumber) => {
                calls.push(`get-version:${applicationId}:${profileId}:${versionNumber}`)
                return version
            },
            createAppConfigHostedConfigurationVersion: async (applicationId, profileId, input) => {
                calls.push(`create-version:${applicationId}:${profileId}:${input.values.contentType}`)
                return version
            },
            deleteAppConfigHostedConfigurationVersion: async (applicationId, profileId, versionNumber) => {
                calls.push(`delete-version:${applicationId}:${profileId}:${versionNumber}`)
            },
            listAppConfigDeploymentStrategies: async () => {
                calls.push('list-strategies')
                return [strategy]
            },
            createAppConfigDeploymentStrategy: async (input) => {
                calls.push(`create-strategy:${input.values.name}`)
                return strategy
            },
            deleteAppConfigDeploymentStrategy: async (strategyId) => {
                calls.push(`delete-strategy:${strategyId}`)
            },
            startAppConfigDeployment: async (applicationId, environmentId, input) => {
                calls.push(`start-deployment:${applicationId}:${environmentId}:${input.values.configurationVersion}`)
                return deployment
            },
            getAppConfigDeployment: async (applicationId, environmentId, deploymentNumber) => {
                calls.push(`get-deployment:${applicationId}:${environmentId}:${deploymentNumber}`)
                return deployment
            },
        })])

        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/environments')).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/environments', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'dev'}),
        })).status).toBe(201)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/environments/env-1', {method: 'DELETE'})).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/configuration-profiles')).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/configuration-profiles', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'settings'}),
        })).status).toBe(201)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/configuration-profiles/profile-1', {method: 'DELETE'})).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/configuration-profiles/profile-1/hosted-configuration-versions')).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/configuration-profiles/profile-1/hosted-configuration-versions', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({content: '{}', contentType: 'application/json'}),
        })).status).toBe(201)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/configuration-profiles/profile-1/hosted-configuration-versions/1')).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/configuration-profiles/profile-1/hosted-configuration-versions/1', {method: 'DELETE'})).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/deployment-strategies')).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/deployment-strategies', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'immediate'}),
        })).status).toBe(201)
        expect((await app.request('/api/clouds/aws/services/configuration/deployment-strategies/strategy-1', {method: 'DELETE'})).status).toBe(200)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/environments/env-1/deployments', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({configurationVersion: '1'}),
        })).status).toBe(201)
        expect((await app.request('/api/clouds/aws/services/configuration/resources/app-1/environments/env-1/deployments/1')).status).toBe(200)

        expect(calls).toEqual([
            'list-environments:app-1',
            'create-environment:app-1:dev',
            'delete-environment:app-1:env-1',
            'list-profiles:app-1',
            'create-profile:app-1:settings',
            'delete-profile:app-1:profile-1',
            'list-versions:app-1:profile-1',
            'create-version:app-1:profile-1:application/json',
            'get-version:app-1:profile-1:1',
            'delete-version:app-1:profile-1:1',
            'list-strategies',
            'create-strategy:immediate',
            'delete-strategy:strategy-1',
            'start-deployment:app-1:env-1:1',
            'get-deployment:app-1:env-1:1',
        ])
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
        const res = await appWithRoutes().request('/api/clouds/aws/services/not-a-service/status')
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

    test('routes PATCH to the adapter update method', async () => {
        let updatedId = ''
        let updatedValues: Record<string, unknown> = {}
        const app = appWithRoutes([
            mockAdapter('aws', {
                service: 'database',
                schema: awsDatabaseSchema,
                update: async (id, input) => {
                    updatedId = id
                    updatedValues = input.values
                    return {
                        id,
                        name: id,
                        cloud: 'aws',
                        service: 'database',
                        type: 'db-instance',
                        region: 'us-east-1',
                        createdAt: null,
                        metadata: input.values,
                    }
                },
            }),
        ])

        const res = await app.request('/api/clouds/aws/services/database/resources/orders-db', {
            method: 'PATCH',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({autoMinorVersionUpgrade: 'true'}),
        })

        expect(res.status).toBe(200)
        expect(updatedId).toBe('orders-db')
        expect(updatedValues).toEqual({autoMinorVersionUpgrade: 'true'})
    })

    test('returns 501 when the adapter does not implement update', async () => {
        const app = appWithRoutes([mockAdapter('aws', {service: 'database', schema: awsDatabaseSchema})])
        const res = await app.request('/api/clouds/aws/services/database/resources/orders-db', {
            method: 'PATCH',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({autoMinorVersionUpgrade: 'true'}),
        })
        expect(res.status).toBe(501)
    })

    test('maps adapter ValidationError on PATCH to 400', async () => {
        const app = appWithRoutes([
            mockAdapter('aws', {
                service: 'database',
                schema: awsDatabaseSchema,
                update: async () => {
                    throw new ValidationError('Invalid password')
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/database/resources/orders-db', {
            method: 'PATCH',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({masterUserPassword: 'short'}),
        })
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.message).toBe('Invalid password')
    })
})

const stubCollections: CollectionPage<ChildCollection> = {
    items: [{id: 'stream-a', name: 'stream-a', parentId: 'group-1', createdAt: null, metadata: {}}],
    nextCursor: 'cursor-2',
}

const stubItems: CollectionPage<ChildItem> = {
    items: [{id: 'event-1', collectionId: 'stream-a', timestamp: null, body: {message: 'hello'}, metadata: {}}],
    nextCursor: null,
}

const documentsStub: DocumentStoreAdapter = {
    listCollections: async () => stubCollections,
    createCollection: async (resourceId, input) => ({
        id: String(input.values.name),
        name: String(input.values.name),
        parentId: resourceId,
        createdAt: null,
        metadata: {},
    }),
    deleteCollection: async () => {},
    listItems: async () => stubItems,
}

const itemsStub: ItemStoreAdapter = {
    listItems: async () => stubItems,
}

describe('child collection routes', () => {
    test('lists collections and returns the cursor', async () => {
        const app = appWithRoutes([mockAdapter('aws', {documents: documentsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/group-1/collections')

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
            items: [{id: 'stream-a', name: 'stream-a', parentId: 'group-1', createdAt: null, metadata: {}}],
            nextCursor: 'cursor-2',
        })
    })

    test('creates a collection', async () => {
        const app = appWithRoutes([mockAdapter('aws', {documents: documentsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/group-1/collections', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'stream-b'}),
        })

        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({id: 'stream-b', parentId: 'group-1'})
    })

    test('lists items under a collection', async () => {
        const app = appWithRoutes([mockAdapter('aws', {documents: documentsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/group-1/collections/stream-a/items')

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({items: stubItems.items, nextCursor: null})
    })

    test('lists flat items', async () => {
        const app = appWithRoutes([mockAdapter('aws', {items: itemsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/table-1/items')

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({items: stubItems.items, nextCursor: null})
    })

    // A documents-only adapter has no flat shape, and vice versa.
    test('501s when the adapter has the other shape', async () => {
        const app = appWithRoutes([mockAdapter('aws', {documents: documentsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/group-1/items')

        expect(res.status).toBe(501)
    })

    test('501s when the adapter implements no child store', async () => {
        const app = appWithRoutes([mockAdapter('aws')])
        const res = await app.request('/api/clouds/aws/services/storage/resources/group-1/collections')

        expect(res.status).toBe(501)
    })

    test('501s for a write the store does not implement', async () => {
        const app = appWithRoutes([mockAdapter('aws', {documents: documentsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/group-1/collections/stream-a/items', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({message: 'nope'}),
        })

        expect(res.status).toBe(501)
    })

    test('rejects an out-of-range limit', async () => {
        const app = appWithRoutes([mockAdapter('aws', {documents: documentsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/group-1/collections?limit=5000')

        expect(res.status).toBe(400)
    })

    test('runs a flat query with its continuation from the body', async () => {
        let seen: unknown
        const app = appWithRoutes([
            mockAdapter('aws', {
                items: {
                    ...itemsStub,
                    queryItems: async (resourceId, query, page) => {
                        seen = {resourceId, query, page}
                        return {items: stubItems.items, nextCursor: 'next-token'}
                    },
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources/table-1/query', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({query: 'SELECT * FROM "table-1"', cursor: 'token-1', limit: 10}),
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({items: stubItems.items, nextCursor: 'next-token'})
        expect(seen).toEqual({resourceId: 'table-1', query: 'SELECT * FROM "table-1"', page: {cursor: 'token-1', limit: 10}})
    })

    test('defaults a flat query to the first page', async () => {
        let seen: unknown
        const app = appWithRoutes([
            mockAdapter('aws', {
                items: {
                    ...itemsStub,
                    queryItems: async (_resourceId, _query, page) => {
                        seen = page
                        return stubItems
                    },
                },
            }),
        ])
        await app.request('/api/clouds/aws/services/storage/resources/table-1/query', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({query: 'SELECT * FROM "table-1"', cursor: null}),
        })

        expect(seen).toEqual({cursor: undefined, limit: 100})
    })

    test.each([
        ['a non-string cursor', {cursor: 42}],
        ['a non-number limit', {limit: '10'}],
        ['an out-of-range limit', {limit: 5000}],
        ['a fractional limit', {limit: 2.5}],
    ])('rejects a flat query with %s', async (_name, page) => {
        let called = false
        const app = appWithRoutes([
            mockAdapter('aws', {
                items: {
                    ...itemsStub,
                    queryItems: async () => {
                        called = true
                        return stubItems
                    },
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources/table-1/query', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({query: 'SELECT 1', ...page}),
        })

        expect(res.status).toBe(400)
        expect(called).toBe(false)
    })

    test('501s a flat query the store does not implement', async () => {
        const app = appWithRoutes([mockAdapter('aws', {items: itemsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/table-1/query', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({query: 'SELECT 1'}),
        })

        expect(res.status).toBe(501)
    })

    test('runs a key query with its continuation from the body', async () => {
        let seen: unknown
        const app = appWithRoutes([
            mockAdapter('aws', {
                items: {
                    ...itemsStub,
                    queryItemsByKey: async (resourceId, query, page) => {
                        seen = {resourceId, query, page}
                        return {items: stubItems.items, nextCursor: 'next-key'}
                    },
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources/table-1/key-query', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                index: 'by-status',
                partitionKey: 'open',
                sortKey: {operator: 'between', value: '2026-01', to: '2026-06'},
                descending: true,
                cursor: 'key-1',
                limit: 25,
            }),
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({items: stubItems.items, nextCursor: 'next-key'})
        expect(seen).toEqual({
            resourceId: 'table-1',
            query: {index: 'by-status', partitionKey: 'open', sortKey: {operator: 'between', value: '2026-01', to: '2026-06'}, descending: true},
            page: {cursor: 'key-1', limit: 25},
        })
    })

    test.each([
        ['no partition key', {}],
        ['an empty partition key', {partitionKey: ''}],
        ['a non-string index', {partitionKey: 'a', index: 7}],
        ['a non-boolean descending', {partitionKey: 'a', descending: 'yes'}],
        ['an unknown operator', {partitionKey: 'a', sortKey: {operator: 'contains', value: 'x'}}],
        ['a sort condition without a value', {partitionKey: 'a', sortKey: {operator: 'eq'}}],
        ['between without an upper bound', {partitionKey: 'a', sortKey: {operator: 'between', value: '1'}}],
        ['an upper bound outside between', {partitionKey: 'a', sortKey: {operator: 'gt', value: '1', to: '2'}}],
        ['an out-of-range limit', {partitionKey: 'a', limit: 5000}],
    ])('rejects a key query with %s', async (_name, body) => {
        let called = false
        const app = appWithRoutes([
            mockAdapter('aws', {
                items: {
                    ...itemsStub,
                    queryItemsByKey: async () => {
                        called = true
                        return stubItems
                    },
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources/table-1/key-query', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(body),
        })

        expect(res.status).toBe(400)
        expect(called).toBe(false)
    })

    test('501s a key query the store does not implement', async () => {
        const app = appWithRoutes([mockAdapter('aws', {items: itemsStub})])
        const res = await app.request('/api/clouds/aws/services/storage/resources/table-1/key-query', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({partitionKey: 'a'}),
        })

        expect(res.status).toBe(501)
    })

    test('passes cursor and limit through to the adapter', async () => {
        let seen: unknown
        const app = appWithRoutes([
            mockAdapter('aws', {
                documents: {
                    ...documentsStub,
                    listCollections: async (_resourceId, page) => {
                        seen = page
                        return stubCollections
                    },
                },
            }),
        ])
        await app.request('/api/clouds/aws/services/storage/resources/group-1/collections?cursor=abc&limit=25')

        expect(seen).toEqual({cursor: 'abc', limit: 25})
    })

    // Registration-order regression: the literal `nosql` segment must keep
    // beating the new `:service` param, or the Cosmos panel silently breaks.
    test('the existing Cosmos container routes still resolve', async () => {
        const app = appWithRoutes([
            mockAdapter('azure', {
                service: 'nosql',
                schema: azureNoSqlSchema,
                listCosmosContainers: async (): Promise<CosmosContainer[]> => [{
                    id: 'items',
                    name: 'items',
                    databaseId: 'appdb',
                    partitionKeyPath: '/pk',
                    createdAt: null,
                    metadata: {},
                }],
            }),
        ])

        const res = await app.request('/api/clouds/azure/services/nosql/resources/appdb/containers')

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject([{id: 'items', databaseId: 'appdb'}])
    })
})

describe('queue message routes', () => {
    const messagesUrl = '/api/clouds/aws/services/messaging/resources/orders/messages'
    const queueMessage: QueueMessage = {
        messageId: 'm-1',
        body: 'hello',
        receiptHandle: 'h-1',
        messageAttributes: {TenantId: {dataType: 'String', value: 'acme'}},
    }

    function queueApp(overrides: Partial<CloudServiceAdapter> = {}) {
        return appWithRoutes([mockAdapter('aws', {
            service: 'messaging',
            schema: awsMessagingSchema,
            receiveMessages: async () => [queueMessage],
            ...overrides,
        })])
    }

    test('receive passes maxMessages through and returns attributes with their data type', async () => {
        let delegated: number | undefined
        const app = queueApp({
            receiveMessages: async (_id, maxMessages) => {
                delegated = maxMessages
                return [queueMessage]
            },
        })

        const res = await app.request(`${messagesUrl}?maxMessages=3`)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({messages: [queueMessage]})
        expect(delegated).toBe(3)
    })

    for (const value of ['0', '11', 'abc', '1.5', '10.5', '0.5', '']) {
        test(`receive rejects maxMessages=${value} with 400`, async () => {
            const res = await queueApp().request(`${messagesUrl}?maxMessages=${value}`)

            expect(res.status).toBe(400)
            expect(await res.json()).toEqual({
                error: 'maxMessages must be an integer between 1 and 10',
                code: 'invalid_request',
                message: 'maxMessages must be an integer between 1 and 10',
            })
        })
    }

    for (const attributes of [{n: 5}, [1], 'x']) {
        test(`send rejects attributes ${JSON.stringify(attributes)} with 400`, async () => {
            const res = await queueApp({
                sendMessage: async () => ({messageId: 'm-2'}),
            }).request(messagesUrl, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({body: 'hi', attributes}),
            })

            expect(res.status).toBe(400)
            expect(await res.json()).toMatchObject({error: 'attributes must be an object of string values'})
        })
    }
})

describe('stream message routes', () => {
    const url = '/api/clouds/oci/services/streams/resources/orders/stream-messages'

    function streamApp(overrides: Partial<CloudServiceAdapter> = {}) {
        return appWithRoutes([mockAdapter('oci', {
            service: 'streams',
            schema: ociStreamingSchema,
            putMessages: async () => ({failures: 0, entries: [{partition: '0', offset: 0}]}),
            readMessages: async () => ({messages: [], nextCursor: 'c2'}),
            ...overrides,
        })])
    }

    test('put forwards the messages and returns where they landed', async () => {
        let delegated: unknown
        const res = await streamApp({
            putMessages: async (_id, messages) => {
                delegated = messages
                return {failures: 0, entries: [{partition: '1', offset: 4}]}
            },
        }).request(url, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({messages: [{key: 'k1', value: 'hello'}, {key: '', value: 'two'}]}),
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({failures: 0, entries: [{partition: '1', offset: 4}]})
        expect(delegated).toEqual([{key: 'k1', value: 'hello'}, {key: undefined, value: 'two'}])
    })

    for (const messages of [undefined, [], [{value: ''}], [{key: 5, value: 'x'}], ['x']]) {
        test(`put rejects messages ${JSON.stringify(messages)} with 400`, async () => {
            const res = await streamApp().request(url, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({messages}),
            })
            expect(res.status).toBe(400)
        })
    }

    test('read passes the cursor choice through and returns the next cursor', async () => {
        let delegated: unknown
        const res = await streamApp({
            readMessages: async (_id, input) => {
                delegated = input
                return {messages: [], nextCursor: 'c2'}
            },
        }).request(`${url}?partition=1&cursorType=AT_OFFSET&offset=3&limit=5`)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({messages: [], nextCursor: 'c2'})
        expect(delegated).toEqual({partition: '1', cursorType: 'AT_OFFSET', offset: 3, limit: 5})
    })

    test('read defaults to TRIM_HORIZON', async () => {
        let delegated: unknown
        await streamApp({
            readMessages: async (_id, input) => {
                delegated = input
                return {messages: []}
            },
        }).request(`${url}?partition=0`)
        expect(delegated).toEqual({partition: '0', cursorType: 'TRIM_HORIZON'})
    })

    for (const query of [
        '',
        'partition=x',
        'partition=0&cursorType=NOPE',
        'partition=0&cursorType=AT_OFFSET',
        'partition=0&cursorType=AFTER_OFFSET&offset=-1',
        'partition=0&cursorType=AT_TIME&time=yesterday',
        'partition=0&limit=0',
        'partition=0&limit=101',
        'partition=0&limit=1.5',
    ]) {
        test(`read rejects ?${query} with 400`, async () => {
            const res = await streamApp().request(`${url}?${query}`)
            expect(res.status).toBe(400)
        })
    }

    test('a service whose adapter has no stream support answers 501 instead of a 500', async () => {
        const app = appWithRoutes([mockAdapter('aws', {service: 'streams', schema: awsKinesisSchema})])
        const res = await app.request('/api/clouds/aws/services/streams/resources/orders/stream-messages?partition=0')
        expect(res.status).toBe(501)
    })
})

describe('route guard error shape', () => {
    const notFound = (detail: string) => ({
        error: 'Resource not found',
        code: 'resource_not_found',
        message: 'Resource not found',
        detail,
    })
    const invalid = (message: string) => ({error: message, code: 'invalid_request', message})

    test('unknown cloud and service guards answer with the typed error body', async () => {
        const app = appWithRoutes()
        const cases: Array<[string, string]> = [
            ['/api/clouds/nope/services', 'Unknown cloud'],
            ['/api/clouds/nope/status', 'Unknown cloud'],
            ['/api/clouds/aws/services/not-a-service/status', 'Unknown cloud or service'],
            ['/api/clouds/aws/services/not-a-service/resources', 'Unknown cloud or service'],
            ['/api/clouds/nope/services/database/snapshots', 'Unknown cloud'],
        ]

        for (const [path, detail] of cases) {
            const res = await app.request(path)
            expect(res.status).toBe(404)
            expect(await res.json()).toEqual(notFound(detail))
        }
    })

    test('a resource the adapter does not return answers with the typed error body', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/resources/missing')

        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({
            error: 'Resource not found',
            code: 'resource_not_found',
            message: 'Resource not found',
        })
    })

    test('missing required input answers with the typed error body', async () => {
        const app = appWithRoutes()
        const base = '/api/clouds/aws/services/storage/resources/bucket-1'
        const cases: Array<[string, string, string]> = [
            ['GET', `${base}/object`, 'Object key is required'],
            ['DELETE', `${base}/object`, 'Object key is required'],
            ['POST', `${base}/object/copy`, 'srcKey and destKey are required'],
        ]

        for (const [method, path, message] of cases) {
            const res = await app.request(path, {
                method,
                headers: {'content-type': 'application/json'},
                body: method === 'POST' ? JSON.stringify({}) : undefined,
            })
            expect(res.status).toBe(400)
            expect(await res.json()).toEqual(invalid(message))
        }
    })

    test('an unexpected non-typed failure outside withRuntime stays a plain 500', async () => {
        const app = new Hono()
        const registry = new CloudAdapterRegistry([mockAdapter('aws')])
        const service = new CloudProxyService(registry, stubProbes())
        service.clouds = () => {
            throw new Error('boom')
        }
        app.route('/api/clouds', createCloudRoutes(service))

        const res = await app.request('/api/clouds')
        expect(res.status).toBe(500)
        expect(await res.text()).toBe('Internal Server Error')
    })
})

describe('empty bucket and object writes on the same bucket', () => {
    const emptyUrl = '/api/clouds/aws/services/storage/resources/logs/empty'
    const objectUrl = (bucket: string, key = 'a.txt') => `/api/clouds/aws/services/storage/resources/${bucket}/object?key=${key}`
    const env = {server: {timeout: () => {}}}

    function held() {
        let release!: () => void
        const done = new Promise<void>((resolve) => {
            release = resolve
        })
        return {done, release}
    }

    function upload(app: Hono, bucket: string, signal?: AbortSignal) {
        return app.request(new Request(`http://localhost${objectUrl(bucket)}`, {method: 'PUT', body: 'x', signal}), undefined, env)
    }

    test('Empty bucket is refused while a write the API started is still landing, even after its client gave up', async () => {
        const write = held()
        const started = held()
        let emptied = 0
        const app = appWithRoutes([mockAdapter('aws', {
            putObject: () => {
                started.release()
                return write.done
            },
            emptyBucket: async () => {
                emptied += 1
                return {deleted: 0}
            },
        })])
        const gaveUp = new AbortController()
        const pending = upload(app, 'logs', gaveUp.signal)
        await started.done
        gaveUp.abort()

        const refused = await app.request(emptyUrl, {method: 'POST'}, env)

        expect(refused.status).toBe(409)
        expect(await refused.json()).toMatchObject({code: 'resource_conflict', detail: expect.stringContaining('nothing was deleted')})
        expect(emptied).toBe(0)

        write.release()
        await pending
        expect((await app.request(emptyUrl, {method: 'POST'}, env)).status).toBe(200)
        expect(emptied).toBe(1)
    })

    test('a write to another bucket does not hold Empty bucket', async () => {
        const write = held()
        const started = held()
        const app = appWithRoutes([mockAdapter('aws', {
            putObject: () => {
                started.release()
                return write.done
            },
            emptyBucket: async () => ({deleted: 0}),
        })])
        const pending = upload(app, 'assets')
        await started.done

        expect((await app.request(emptyUrl, {method: 'POST'}, env)).status).toBe(200)
        write.release()
        await pending
    })

    test('a failed write releases the bucket', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            putObject: async () => {
                throw new RuntimeError('upload failed')
            },
            emptyBucket: async () => ({deleted: 0}),
        })])

        expect((await upload(app, 'logs')).status).toBe(502)
        expect((await app.request(emptyUrl, {method: 'POST'}, env)).status).toBe(200)
    })

    test('a failed Empty bucket releases the bucket', async () => {
        let runs = 0
        const app = appWithRoutes([mockAdapter('aws', {
            emptyBucket: async () => {
                runs += 1
                if (runs === 1) throw new RuntimeError('Emptying bucket "logs" stopped before deleting anything: boom')
                return {deleted: 0}
            },
            putObject: async () => {},
        })])

        expect((await app.request(emptyUrl, {method: 'POST'}, env)).status).toBe(502)
        expect((await upload(app, 'logs')).status).toBe(200)
        expect((await app.request(emptyUrl, {method: 'POST'}, env)).status).toBe(200)
    })

    test('uploads, deletes and copies into the bucket are refused while it is being emptied', async () => {
        const empty = held()
        const writes: string[] = []
        const app = appWithRoutes([mockAdapter('aws', {
            emptyBucket: async () => {
                await empty.done
                return {deleted: 0}
            },
            putObject: async (bucket) => {
                writes.push(`put:${bucket}`)
            },
            deleteObject: async (bucket) => {
                writes.push(`delete:${bucket}`)
            },
            copyObject: async (bucket, _src, _dest, destBucket) => {
                writes.push(`copy:${bucket}->${destBucket ?? bucket}`)
            },
        })])
        const running = app.request(emptyUrl, {method: 'POST'}, env)
        const copy = (from: string, destResourceId?: string) => app.request(`/api/clouds/aws/services/storage/resources/${from}/object/copy`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({srcKey: 'a.txt', destKey: 'b.txt', destResourceId}),
        }, env)

        expect((await upload(app, 'logs')).status).toBe(409)
        expect((await app.request(objectUrl('logs'), {method: 'DELETE'}, env)).status).toBe(409)
        expect((await copy('logs')).status).toBe(409)
        expect((await copy('assets', 'logs')).status).toBe(409)
        expect((await app.request(emptyUrl, {method: 'POST'}, env)).status).toBe(409)
        // Writes elsewhere go ahead, including a copy out of the bucket being emptied.
        expect((await upload(app, 'assets')).status).toBe(200)
        expect((await copy('logs', 'assets')).status).toBe(200)
        expect(writes).toEqual(['put:assets', 'copy:logs->assets'])

        empty.release()
        expect((await running).status).toBe(200)
        expect((await upload(app, 'logs')).status).toBe(200)
    })
})

describe('empty bucket route', () => {
    const emptyUrl = '/api/clouds/aws/services/storage/resources/logs/empty'
    const post = {method: 'POST'}

    function serverBinding() {
        const calls: Array<{request: Request; seconds: number}> = []
        return {calls, env: {server: {timeout: (request: Request, seconds: number) => calls.push({request, seconds})}}}
    }

    test('extends the request timeout, passes a signal and returns the result', async () => {
        const seen: Array<{id: string; signal?: AbortSignal}> = []
        const app = appWithRoutes([mockAdapter('aws', {
            emptyBucket: async (id, options) => {
                seen.push({id, signal: options?.signal})
                return {deleted: 7}
            },
        })])
        const binding = serverBinding()

        const res = await app.request(emptyUrl, post, binding.env)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({deleted: 7})
        expect(binding.calls.map((call) => call.seconds)).toEqual([150])
        expect(binding.calls[0].request.url).toEndWith(emptyUrl)
        expect(seen).toHaveLength(1)
        expect(seen[0].id).toBe('logs')
        expect(seen[0].signal).toBeInstanceOf(AbortSignal)
    })

    test('a delete batch sent at the deadline still finishes inside the connection budget', () => {
        expect(EMPTY_BUCKET_DEADLINE_MS + DELETE_BATCH_TIMEOUT_MS).toBeLessThan(EMPTY_BUCKET_IDLE_TIMEOUT_SECONDS * 1000)
    })

    test('a client disconnect reaches the adapter as an aborted signal', async () => {
        let signal: AbortSignal | undefined
        const app = appWithRoutes([mockAdapter('aws', {
            emptyBucket: async (_id, options) => {
                signal = options?.signal
                return {deleted: 0}
            },
        })])
        const disconnected = new AbortController()
        disconnected.abort()

        await app.request(new Request(`http://localhost${emptyUrl}`, {...post, signal: disconnected.signal}), undefined, serverBinding().env)

        expect(signal?.aborted).toBe(true)
    })

    test('a typed adapter failure keeps its status and detail', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            emptyBucket: async () => {
                throw new RuntimeError('Emptying bucket "logs" stopped after deletion started: S3 refused to delete 1 of 1 entries')
            },
        })])

        const res = await app.request(emptyUrl, post, serverBinding().env)

        expect(res.status).toBe(502)
        expect(await res.json()).toMatchObject({code: 'runtime_error', detail: expect.stringContaining('stopped after deletion started')})
    })

    test('a storage adapter without emptyBucket answers 501', async () => {
        const res = await appWithRoutes().request('/api/clouds/azure/services/storage/resources/logs/empty', post, serverBinding().env)

        expect(res.status).toBe(501)
        expect(await res.json()).toMatchObject({code: 'operation_not_supported'})
    })

    test('other services and unknown clouds have no empty route', async () => {
        const binding = serverBinding()
        const app = appWithRoutes()

        expect((await app.request('/api/clouds/aws/services/messaging/resources/orders/empty', post, binding.env)).status).toBe(404)
        expect((await app.request('/api/clouds/mars/services/storage/resources/logs/empty', post, binding.env)).status).toBe(404)
        expect(binding.calls).toEqual([])
    })

    test('refuses to start without the Bun server binding', async () => {
        let called = false
        const app = appWithRoutes([mockAdapter('aws', {
            emptyBucket: async () => {
                called = true
                return {deleted: 0}
            },
        })])

        const res = await app.request(emptyUrl, post)

        expect(res.status).toBe(500)
        expect(called).toBe(false)
    })

    test('runs on the service for the account in the header, else the query', async () => {
        const requested: Array<string | null | undefined> = []
        const emptied: string[] = []
        const accountService = (accountId?: string | null) => {
            requested.push(accountId)
            return new CloudProxyService(new CloudAdapterRegistry([mockAdapter('aws', {
                emptyBucket: async (id) => {
                    emptied.push(`${accountId}:${id}`)
                    return {deleted: 1}
                },
            })]), stubProbes())
        }
        const app = new Hono()
        app.route('/api/clouds', createCloudRoutes(undefined, accountService))
        const {env} = serverBinding()

        await app.request(`${emptyUrl}?account=222222222222`, {...post, headers: {'x-floci-account-id': '111111111111'}}, env)
        await app.request(`${emptyUrl}?account=222222222222`, post, env)

        expect(requested).toEqual(['111111111111', '222222222222'])
        expect(emptied).toEqual(['111111111111:logs', '222222222222:logs'])
    })
})
