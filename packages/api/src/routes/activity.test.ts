import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {CloudError, NotFoundError, toHttpError} from '../cloud-spi/errors'
import {ActivityLog} from '../service/activityLog'
import {activityRecorder, createActivityRoutes, describeRequest} from './activity'

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'

interface FeedResponse {
    items: Array<Record<string, unknown>>
    facets: Record<string, string[]>
    nextCursor: string | null
}

/**
 * A console-shaped app: one recorder ahead of the routes, the same typed-error
 * mapping `routes/clouds.ts` uses, and the feed endpoint behind them.
 */
function appWith(configure: (app: Hono) => void): {app: Hono; log: ActivityLog} {
    const log = new ActivityLog()
    const app = new Hono()
    app.use('/api/*', activityRecorder(log))
    app.onError((err, c) => {
        if (err instanceof CloudError) {
            const {status, body} = toHttpError(err)
            return c.json(body, status)
        }
        console.error(err)
        return c.text('Internal Server Error', 500)
    })
    configure(app)
    app.route('/api/activity', createActivityRoutes(log))
    return {app, log}
}

async function feed(app: Hono, query = ''): Promise<FeedResponse> {
    const response = await app.request(`/api/activity${query}`)
    expect(response.status).toBe(200)
    return await response.json() as FeedResponse
}

describe('describeRequest', () => {
    test('names the cloud, service and operation of a generic mutation', () => {
        expect(describeRequest('POST', '/api/clouds/aws/services/storage/resources')).toEqual({
            cloud: 'aws', service: 'storage', operation: 'Create', resourceId: null, action: null,
        })
        expect(describeRequest('PUT', '/api/clouds/gcp/services/compute/resources/i-1')).toMatchObject({
            cloud: 'gcp', service: 'compute', operation: 'Update', resourceId: 'i-1',
        })
        expect(describeRequest('DELETE', '/api/clouds/azure/services/storage/resources/b')).toMatchObject({
            cloud: 'azure', operation: 'Delete', resourceId: 'b',
        })
    })

    test('reads service actions off the path', () => {
        expect(describeRequest('POST', '/api/clouds/aws/services/compute/resources/i-1/start')).toMatchObject({operation: 'Start'})
        expect(describeRequest('POST', '/api/clouds/aws/services/compute/resources/i-1/reboot')).toMatchObject({operation: 'Reboot'})
        expect(describeRequest('POST', '/api/clouds/aws/services/storage/resources/b/empty')).toMatchObject({operation: 'Empty'})
        expect(describeRequest('POST', '/api/clouds/aws/services/serverless/resources/fn/invoke')).toMatchObject({operation: 'Invoke'})
        expect(describeRequest('POST', '/api/clouds/aws/services/kms/resources/k/rotate')).toMatchObject({operation: 'Rotate'})
        expect(describeRequest('POST', '/api/clouds/aws/services/secrets/resources/s/purge-deleted')).toMatchObject({operation: 'Purge deleted'})
        expect(describeRequest('POST', '/api/clouds/aws/services/storage/resources/b/object/copy')).toMatchObject({operation: 'Copy'})
        expect(describeRequest('POST', '/api/clouds/aws/services/nosql/resources/db/containers')).toMatchObject({operation: 'Create'})
        expect(describeRequest('DELETE', '/api/clouds/aws/services/email/inbox')).toMatchObject({operation: 'Clear'})
    })

    test('skips reads, including ones sent as POST', () => {
        expect(describeRequest('GET', '/api/clouds/aws/services/storage/resources')).toBeNull()
        expect(describeRequest('POST', '/api/clouds/aws/services/logs/query')).toBeNull()
        expect(describeRequest('POST', '/api/clouds/aws/services/logs/resources/g/query')).toBeNull()
        expect(describeRequest('POST', '/api/clouds/aws/services/database/resources/db1/sql/databases')).toBeNull()
        expect(describeRequest('POST', '/api/clouds/aws/services/database/resources/db1/sql/query')).toBeNull()
        expect(describeRequest('POST', '/api/clouds/aws/services/dynamodb/resources/t/key-query')).toBeNull()
    })

    test('maps the legacy AWS-only routes onto catalog service keys', () => {
        expect(describeRequest('POST', '/api/ec2/instances')).toEqual({
            cloud: 'aws', service: 'compute', operation: 'Create', resourceId: null, action: 'instances',
        })
        expect(describeRequest('POST', '/api/ec2/instances/i-1/start')).toMatchObject({service: 'compute', operation: 'Start'})
        expect(describeRequest('DELETE', '/api/secretsmanager/secrets/my-secret')).toMatchObject({service: 'secrets', operation: 'Delete'})
        expect(describeRequest('POST', '/api/eks/clusters')).toMatchObject({service: 'k8s', operation: 'Create'})
    })

    test('ignores paths the console does not serve', () => {
        expect(describeRequest('POST', '/api/activity')).toBeNull()
        expect(describeRequest('POST', '/api/clouds/aws/status')).toBeNull()
        expect(describeRequest('POST', '/api/health')).toBeNull()
        expect(describeRequest('POST', '/somewhere/else')).toBeNull()
    })
})

describe('activity recorder', () => {
    test('records a successful create with the name and type the API answered with', async () => {
        const {app} = appWith((routes) => {
            routes.post('/api/clouds/aws/services/storage/resources', (c) =>
                c.json({id: 'b1', name: 'orders', type: 'bucket'}, 201))
        })

        const response = await app.request('/api/clouds/aws/services/storage/resources', {
            method: 'POST',
            headers: {'content-type': 'application/json', 'user-agent': BROWSER_UA},
            body: '{}',
        })
        expect(response.status).toBe(201)

        const {items} = await feed(app)
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({
            cloud: 'aws',
            service: 'storage',
            operation: 'Create',
            resourceType: 'bucket',
            resourceName: 'orders',
            status: 'success',
            statusCode: 201,
            source: 'Floci UI',
            httpMethod: 'POST',
            path: '/api/clouds/aws/services/storage/resources',
            detail: null,
        })
    })

    test('records a failed mutation with its status and error detail', async () => {
        const {app} = appWith((routes) => {
            routes.delete('/api/clouds/aws/services/compute/resources/:id', () => {
                throw new NotFoundError('Instance i-1 is already terminated.')
            })
        })

        const response = await app.request('/api/clouds/aws/services/compute/resources/i-1', {method: 'DELETE'})
        expect(response.status).toBe(404)

        const {items} = await feed(app)
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({
            operation: 'Delete',
            resourceName: 'i-1',
            status: 'failed',
            statusCode: 404,
            detail: 'Instance i-1 is already terminated.',
        })
    })

    test('names object writes after their key', async () => {
        const {app} = appWith((routes) => {
            routes.put('/api/clouds/aws/services/storage/resources/:id/object', (c) => c.json({ok: true}))
        })

        await app.request('/api/clouds/aws/services/storage/resources/bucket-a/object?key=hello.txt', {
            method: 'PUT',
            body: 'hi',
        })

        const {items} = await feed(app)
        expect(items[0]).toMatchObject({operation: 'Update', resourceName: 'hello.txt', resourceType: null})
    })

    test('maps legacy routes to their catalog service key', async () => {
        const {app} = appWith((routes) => {
            routes.post('/api/ec2/instances', (c) => c.json({id: 'i-1', name: 'web-1', type: 'instance'}))
        })

        await app.request('/api/ec2/instances', {method: 'POST', headers: {'user-agent': 'aws-cli/2.17.0'}, body: '{}'})

        const {items} = await feed(app)
        expect(items[0]).toMatchObject({cloud: 'aws', service: 'compute', operation: 'Create', source: 'AWS CLI'})
    })

    test('derives the source of each call from its caller', async () => {
        const {app} = appWith((routes) => {
            routes.post('/api/clouds/aws/services/storage/resources', (c) => c.json({ok: true}, 201))
            routes.post('/api/clouds/aws/services/storage/resources/:id/action', (c) => c.json({ok: true}))
        })

        await app.request('/api/clouds/aws/services/storage/resources', {
            method: 'POST', headers: {'user-agent': BROWSER_UA}, body: '{}',
        })
        await app.request('/api/clouds/aws/services/storage/resources/b1/action', {
            method: 'POST', headers: {'user-agent': 'curl/8.5.0'}, body: '{}',
        })
        await app.request('/api/clouds/aws/services/storage/resources/b1/action', {
            method: 'POST', headers: {'user-agent': 'Terraform/1.9.0 OpenTofu/1.8.2'}, body: '{}',
        })

        const {items} = await feed(app)
        expect(items.map((item) => item.source)).toEqual(['Terraform/OpenTofu', 'API client', 'Floci UI'])
    })

    test('records nothing for reads', async () => {
        const {app} = appWith((routes) => {
            routes.get('/api/clouds/aws/services/storage/resources', (c) => c.json([]))
            routes.post('/api/clouds/aws/services/logs/resources/g/query', (c) => c.json({results: []}))
        })

        await app.request('/api/clouds/aws/services/storage/resources')
        await app.request('/api/clouds/aws/services/logs/resources/g/query', {method: 'POST', body: '{}'})

        const {items} = await feed(app)
        expect(items).toHaveLength(0)
    })
})

describe('GET /api/activity', () => {
    async function seededApp(): Promise<Hono> {
        const {app} = appWith((routes) => {
            routes.post('/api/clouds/aws/services/storage/resources', (c) =>
                c.json({id: 'b1', name: 'orders', type: 'bucket'}, 201))
            routes.post('/api/clouds/aws/services/compute/resources/:id/start', (c) => c.json({ok: true}))
            routes.delete('/api/clouds/azure/services/compute/resources/:id', () => {
                throw new NotFoundError('gone')
            })
        })
        await app.request('/api/clouds/aws/services/storage/resources', {method: 'POST', body: '{}'})
        await app.request('/api/clouds/aws/services/compute/resources/i-1/start', {method: 'POST', body: '{}'})
        await app.request('/api/clouds/azure/services/compute/resources/i-2', {method: 'DELETE'})
        return app
    }

    test('returns entries newest first with facet values', async () => {
        const app = await seededApp()
        const {items, facets} = await feed(app)

        expect(items.map((item) => item.operation)).toEqual(['Delete', 'Start', 'Create'])
        expect(facets.clouds).toEqual(['aws', 'azure'])
        expect(facets.operations).toEqual(['Create', 'Delete', 'Start'])
        expect(facets.services).toEqual(['compute', 'storage'])
        expect(facets.statuses).toEqual(['failed', 'success'])
    })

    test('filters by cloud, service, operation, status and search', async () => {
        const app = await seededApp()

        expect((await feed(app, '?cloud=aws')).items).toHaveLength(2)
        expect((await feed(app, '?service=storage')).items.map((i) => i.resourceName)).toEqual(['orders'])
        expect((await feed(app, '?operation=Start')).items).toHaveLength(1)
        expect((await feed(app, '?status=failed')).items.map((i) => i.statusCode)).toEqual([404])
        expect((await feed(app, '?search=orders')).items).toHaveLength(1)
        expect((await feed(app, '?search=nothing')).items).toHaveLength(0)
    })

    test('rejects unusable query values with a typed 400', async () => {
        const app = await seededApp()

        expect((await app.request('/api/activity?status=maybe')).status).toBe(400)
        expect((await app.request('/api/activity?from=yesterday-ish')).status).toBe(400)
        expect((await app.request('/api/activity?limit=0')).status).toBe(400)
        expect((await app.request('/api/activity?cursor=nope')).status).toBe(400)
    })

    test('accepts epoch seconds and millisecond date bounds', async () => {
        const app = await seededApp()
        const epochSeconds = Math.floor(Date.now() / 1000) - 60

        const page = await feed(app, `?from=${epochSeconds}&to=${Date.now() + 60_000}`)
        expect(page.items).toHaveLength(3)
    })
})
