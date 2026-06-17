import {Hono} from 'hono'
import type {Context} from 'hono'
import type {CloudProvider, CloudServiceType} from '../cloud-spi/types'
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
        return c.json(await svc(c).status(cloud))
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

function isServiceType(value: string): value is CloudServiceType {
    return value === 'storage' || value === 'k8s' || value === 'database' || value === 'serverless' || value === 'compute' || value === 'networking'
}

async function withRuntime(c: Context, handler: () => Promise<Response>): Promise<Response> {
    try {
        return await handler()
    } catch (err) {
        const error = normalizeRuntimeError(err)
        return c.json(error.body, error.status)
    }
}

function normalizeRuntimeError(err: unknown): {
    status: 400 | 404 | 501 | 502 | 503
    body: {error: string; code: string; message: string; detail?: string}
} {
    const message = err instanceof Error ? err.message : 'Runtime request failed'

    if (message.includes('Cannot reach')) {
        return errorResponse(503, 'runtime_unavailable', 'Runtime unavailable', message)
    }

    if (message.includes('Cosmos NoSQL request failed on all known routes')) {
        return errorResponse(
            502,
            'cosmos_nosql_unavailable',
            'Cosmos NoSQL endpoint is not available on the selected Floci-AZ runtime',
            message,
        )
    }

    if (message.includes('HTTP 501') || message.includes('NotImplemented')) {
        return errorResponse(501, 'operation_not_implemented', 'Operation is not implemented by the selected runtime', message)
    }

    if (message.includes('not found') || message.includes('NotFound') || message.includes('NoSuchBucket') || message.includes('NoSuchKey')) {
        return errorResponse(404, 'resource_not_found', 'Resource not found', message)
    }

    if (message.includes('is not supported') || message.includes('No adapter registered')) {
        return errorResponse(501, 'operation_not_supported', 'Operation is not supported by this adapter', message)
    }

    if (message.includes('is required') || message.includes('Use a valid')) {
        return errorResponse(400, 'invalid_request', message)
    }

    return errorResponse(502, 'runtime_error', 'Runtime request failed', message)
}

function errorResponse(
    status: 400 | 404 | 501 | 502 | 503,
    code: string,
    message: string,
    detail?: string,
): {
    status: 400 | 404 | 501 | 502 | 503
    body: {error: string; code: string; message: string; detail?: string}
} {
    return {
        status,
        body: {
            error: message,
            code,
            message,
            ...(detail && detail !== message ? {detail} : {}),
        },
    }
}

export default createCloudRoutes()
