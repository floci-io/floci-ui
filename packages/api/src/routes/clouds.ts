import {Hono} from 'hono'
import type {Context} from 'hono'
import type {CloudProvider, CloudServiceType} from '../cloud-spi/types'
import {clampLimit, type PageQuery} from '../cloud-spi/childCollections'
import {toHttpError} from '../cloud-spi/errors'
import {isServiceType} from '../cloud-spi/serviceCatalog'
import {mapAwsSdkError} from '../adapter-aws/awsErrors'
import {serviceForAccount} from '../cloudProxy'
import {CloudProxyService} from '../service/CloudProxyService'

// Header (and query-param fallback for direct links such as object downloads)
// used by the frontend to scope every request to an AWS account.
export const ACCOUNT_HEADER = 'x-floci-account-id'

export function createCloudRoutes(injectedService?: CloudProxyService) {
    const app = new Hono()

    // Resolve the account-scoped service per request. An explicitly injected
    // service (used by tests) always wins and ignores the account header.
    const svc = (c: Context): CloudProxyService =>
        injectedService ?? serviceForAccount(c.req.header(ACCOUNT_HEADER) ?? c.req.query('account'))

    app.get('/', (c) => c.json(svc(c).clouds()))

    app.get('/:cloud/services', (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)
        return c.json(svc(c).services(cloud))
    })

    app.get('/:cloud/status', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)
        // Per-service detail is opt-in; the connection indicator polls this often.
        const includeServices = c.req.query('services') === 'all'
        return c.json(await svc(c).status(cloud, {includeServices}))
    })

    app.get('/:cloud/services/:service/status', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)
        return c.json(await svc(c).serviceStatus(cloud, serviceType))
    })

    app.get('/:cloud/services/:service/schema', (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        const schema = svc(c).schema(cloud, serviceType)
        if (!schema) {
            return c.json({error: 'Schema not available'}, 404)
        }

        return c.json(schema)
    })

    app.get('/:cloud/services/:service/resources', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const resources = await svc(c).listResources(cloud, serviceType, {search: c.req.query('search')})
            return c.json(resources)
        })
    })

    app.get('/:cloud/services/database/resources/:id/containers', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)

        return withRuntime(c, async () => {
            const containers = await svc(c).listCosmosContainers(cloud, c.req.param('id'))
            return c.json(containers)
        })
    })

    app.post('/:cloud/services/database/resources/:id/containers', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            const container = await svc(c).createCosmosContainer(cloud, c.req.param('id'), {values})
            return c.json(container, 201)
        })
    })

    app.delete('/:cloud/services/database/resources/:id/containers/:containerId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)

        return withRuntime(c, async () => {
            await svc(c).deleteCosmosContainer(cloud, c.req.param('id'), c.req.param('containerId'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/database/resources/:id/containers/:containerId/items', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)

        return withRuntime(c, async () => {
            const items = await svc(c).listCosmosItems(cloud, c.req.param('id'), c.req.param('containerId'))
            return c.json(items)
        })
    })

    app.post('/:cloud/services/database/resources/:id/containers/:containerId/items', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)

        return withRuntime(c, async () => {
            const document = await c.req.json<Record<string, unknown>>()
            const item = await svc(c).upsertCosmosItem(cloud, c.req.param('id'), c.req.param('containerId'), document)
            return c.json(item, 201)
        })
    })

    app.delete('/:cloud/services/database/resources/:id/containers/:containerId/items/:itemId', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)

        return withRuntime(c, async () => {
            await svc(c).deleteCosmosItem(cloud, c.req.param('id'), c.req.param('containerId'), c.req.param('itemId'), c.req.query('partitionKey') ?? null)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/database/resources/:id/containers/:containerId/query', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        if (!isCloudProvider(cloud)) return c.json({error: 'Unknown cloud'}, 404)

        return withRuntime(c, async () => {
            const body = await c.req.json<{query?: string}>()
            const result = await svc(c).queryCosmosItems(cloud, c.req.param('id'), c.req.param('containerId'), body.query ?? '')
            return c.json(result)
        })
    })

    // Child collections, parameterised by service. The Cosmos routes above keep
    // their literal `database` segment and are registered first, so they win.

    app.get('/:cloud/services/:service/resources/:id/collections', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const page = await svc(c).listChildCollections(target.cloud, target.service, c.req.param('id'), pageQuery(c))
            return c.json(page)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/collections', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            const collection = await svc(c).createChildCollection(target.cloud, target.service, c.req.param('id'), {values})
            return c.json(collection, 201)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/collections/:cid', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            await svc(c).deleteChildCollection(target.cloud, target.service, c.req.param('id'), c.req.param('cid'))
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/:service/resources/:id/collections/:cid/items', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const page = await svc(c).listCollectionItems(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), pageQuery(c))
            return c.json(page)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/collections/:cid/items', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const body = await c.req.json<Record<string, unknown>>()
            const item = await svc(c).putCollectionItem(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), body)
            return c.json(item, 201)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/collections/:cid/items/:itemId', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            await svc(c).deleteCollectionItem(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), c.req.param('itemId'), c.req.query('partitionKey') ?? null)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/collections/:cid/query', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const body = await c.req.json<{query?: string}>()
            const page = await svc(c).queryCollectionItems(target.cloud, target.service, c.req.param('id'), c.req.param('cid'), body.query ?? '')
            return c.json(page)
        })
    })

    app.get('/:cloud/services/:service/resources/:id/items', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const page = await svc(c).listFlatItems(target.cloud, target.service, c.req.param('id'), pageQuery(c))
            return c.json(page)
        })
    })

    app.post('/:cloud/services/:service/resources/:id/items', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const body = await c.req.json<Record<string, unknown>>()
            const item = await svc(c).putFlatItem(target.cloud, target.service, c.req.param('id'), body)
            return c.json(item, 201)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/items/:itemId', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            await svc(c).deleteFlatItem(target.cloud, target.service, c.req.param('id'), c.req.param('itemId'), c.req.query('partitionKey') ?? null)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/query', async (c) => {
        const target = childTarget(c)
        if (!target) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const body = await c.req.json<{query?: string}>()
            const page = await svc(c).queryFlatItems(target.cloud, target.service, c.req.param('id'), body.query ?? '')
            return c.json(page)
        })
    })

    app.get('/:cloud/services/:service/resources/:id', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const resource = await svc(c).getResource(cloud, serviceType, c.req.param('id'))
            if (!resource) return c.json({error: 'Resource not found'}, 404)
            return c.json(resource)
        })
    })

    app.get('/:cloud/services/:service/resources/:id/objects', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const objects = await svc(c).listObjects(cloud, serviceType, c.req.param('id'), c.req.query('prefix') ?? '')
            return c.json(objects)
        })
    })

    app.put('/:cloud/services/:service/resources/:id/object', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        const key = c.req.query('key') ?? ''
        if (!key) return c.json({error: 'Object key is required'}, 400)
        const body = new Uint8Array(await c.req.arrayBuffer())
        const contentType = c.req.header('content-type') ?? 'application/octet-stream'
        return withRuntime(c, async () => {
            await svc(c).putObject(cloud, serviceType, c.req.param('id'), key, body, contentType)
            return c.json({ok: true})
        })
    })

    app.get('/:cloud/services/:service/resources/:id/object', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        const key = c.req.query('key') ?? ''
        if (!key) return c.json({error: 'Object key is required'}, 400)
        return withRuntime(c, async () => {
            const object = await svc(c).getObject(cloud, serviceType, c.req.param('id'), key)
            return new Response(object.body, {
                headers: {
                    'content-type': object.contentType,
                    ...(object.contentLength === null ? {} : {'content-length': String(object.contentLength)}),
                    'content-disposition': `attachment; filename="${key.split('/').pop() ?? key}"`,
                },
            })
        })
    })

    app.delete('/:cloud/services/:service/resources/:id/object', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        const key = c.req.query('key') ?? ''
        if (!key) return c.json({error: 'Object key is required'}, 400)
        return withRuntime(c, async () => {
            await svc(c).deleteObject(cloud, serviceType, c.req.param('id'), key)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/object/copy', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        const {srcKey, destKey, destResourceId} = await c.req.json<{srcKey: string; destKey: string; destResourceId?: string}>()
        if (!srcKey || !destKey) return c.json({error: 'srcKey and destKey are required'}, 400)

        return withRuntime(c, async () => {
            await svc(c).copyObject(cloud, serviceType, c.req.param('id'), srcKey, destKey, destResourceId)
            return c.json({ok: true})
        })
    })

    app.post('/:cloud/services/:service/resources/:id/invoke', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) {
            return c.json({error: 'Unknown cloud or service'}, 404)
        }

        return withRuntime(c, async () => {
            const body: {payload?: string} = await c.req.json<{payload?: string}>().catch(() => ({}))
            const result = await svc(c).invokeResource(
                cloud,
                serviceType,
                c.req.param('id'),
                body.payload ?? '{}',
            )
            return c.json(result)
        })
    })

    app.post('/:cloud/services/:service/resources', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            const values = await c.req.json<Record<string, unknown>>()
            const resource = await svc(c).createResource(cloud, serviceType, {values})
            return c.json(resource, 201)
        })
    })

    app.delete('/:cloud/services/:service/resources/:id', async (c) => {
        const cloud = c.req.param('cloud') as CloudProvider
        const serviceType = c.req.param('service') as CloudServiceType
        if (!isCloudProvider(cloud) || !isServiceType(serviceType)) return c.json({error: 'Unknown cloud or service'}, 404)

        return withRuntime(c, async () => {
            await svc(c).deleteResource(cloud, serviceType, c.req.param('id'))
            return c.json({ok: true})
        })
    })

    return app
}

function isCloudProvider(value: string): value is CloudProvider {
    return value === 'aws' || value === 'azure' || value === 'gcp'
}

/**
 * Resolve and validate the cloud/service pair for a child-collection route.
 * Returns null when either is unknown, which the caller turns into a 404.
 */
function childTarget(c: Context): {cloud: CloudProvider; service: CloudServiceType} | null {
    const cloud = c.req.param('cloud') as CloudProvider
    const service = c.req.param('service') as CloudServiceType
    if (!isCloudProvider(cloud) || !isServiceType(service)) return null
    return {cloud, service}
}

/** Parse paging params. An out-of-range limit raises and becomes a 400. */
function pageQuery(c: Context): PageQuery {
    return {cursor: c.req.query('cursor'), limit: clampLimit(c.req.query('limit'))}
}

async function withRuntime(c: Context, handler: () => Promise<Response>): Promise<Response> {
    try {
        return await handler()
    } catch (err) {
        const {status, body} = toHttpError(err, mapAwsSdkError)
        return c.json(body, status)
    }
}

export default createCloudRoutes()
