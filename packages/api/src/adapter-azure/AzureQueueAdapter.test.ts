import {afterEach, describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {AzureQueueAdapter} from './AzureQueueAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {ConflictError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {createCloudAdapterRegistry, createCloudProxyService} from '../cloudProxy'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import {createCloudRoutes} from '../routes/clouds'

const ENDPOINT = 'http://localhost:4577'
const ACCOUNT = 'devstoreaccount1'
const ROOT = `${ENDPOINT}/${ACCOUNT}-queue`
const originalFetch = globalThis.fetch

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureQueueAdapter {
    return new AzureQueueAdapter(new AzureRestRuntimeClient(ENDPOINT, ACCOUNT))
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

const listXml = `<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults xmlns="http://schemas.microsoft.com/windowsazure">
  <Queues>
    <Queue><Name>orders</Name><Metadata><Name>not-a-queue</Name></Metadata></Queue>
    <Queue><Name>audit-log</Name></Queue>
  </Queues>
  <NextMarker></NextMarker>
</EnumerationResults>`

describe('AzureQueueAdapter', () => {
    test('registers Queue Storage separately from Azure Service Bus', () => {
        const registry = createCloudAdapterRegistry()
        const proxy = createCloudProxyService()

        expect(registry.get('azure', 'queue')).toBeInstanceOf(AzureQueueAdapter)
        expect(registry.get('azure', 'messaging')?.schema().displayName).toBe('Service Bus')
        expect(proxy.services('azure').find((service) => service.service === 'queue')).toMatchObject({
            availability: 'available', route: 'queue', displayName: 'Queue Storage',
        })
        expect(proxy.schema('azure', 'queue')?.actions).toEqual(['list', 'create', 'inspect', 'delete'])
    })

    test('lists queues from Azure XML without treating metadata elements as queues', async () => {
        const calls = stubFetch(() => new Response(listXml))

        const resources = await adapter().list()

        expect(calls.map((call) => call.url)).toEqual([`${ROOT}?comp=list`])
        expect(calls[0]?.init?.method).toBe('GET')
        expect(calls[0]?.init?.headers).toMatchObject({'x-ms-version': '2021-12-02'})
        expect(resources).toMatchObject([
            {id: 'orders', name: 'orders', cloud: 'azure', service: 'queue', type: 'queue', metadata: {storageService: 'queue'}},
            {id: 'audit-log', name: 'audit-log'},
        ])
    })

    test('returns an empty list and filters queue names case-insensitively', async () => {
        stubFetch(() => new Response(listXml))
        await expect(adapter().list({search: ' AUDIT '})).resolves.toMatchObject([{id: 'audit-log'}])

        stubFetch(() => new Response('<EnumerationResults><Queues/></EnumerationResults>'))
        await expect(adapter().list()).resolves.toEqual([])
    })

    test('follows Azure list markers and rejects a repeated marker', async () => {
        const calls = stubFetch((url) => new Response(url.includes('marker=next')
            ? '<EnumerationResults><Queues><Queue><Name>audit</Name></Queue></Queues><NextMarker/></EnumerationResults>'
            : '<EnumerationResults><Queues><Queue><Name>orders</Name></Queue></Queues><NextMarker>next</NextMarker></EnumerationResults>'))

        await expect(adapter().list()).resolves.toMatchObject([{id: 'orders'}, {id: 'audit'}])
        expect(calls.map((call) => call.url)).toEqual([`${ROOT}?comp=list`, `${ROOT}?comp=list&marker=next`])

        stubFetch(() => new Response('<EnumerationResults><Queues/><NextMarker>next</NextMarker></EnumerationResults>'))
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('rejects malformed or unrelated XML instead of showing an empty list', async () => {
        stubFetch(() => new Response('<html>unavailable</html>'))
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)

        stubFetch(() => new Response('<EnumerationResults><Queues><Queue><Name>orders</Name></Queues>'))
        await expect(adapter().list()).rejects.toBeInstanceOf(RuntimeError)
    })

    test('inspects queue metadata and reports a missing queue as null', async () => {
        const calls = stubFetch(() => new Response(null, {
            headers: {'x-ms-approximate-messages-count': '4'},
        }))
        await expect(adapter().get('orders')).resolves.toMatchObject({
            id: 'orders', metadata: {approximateMessages: 4},
        })
        expect(calls[0]?.url).toBe(`${ROOT}/orders?comp=metadata`)

        stubFetch(() => new Response('<Error><Code>QueueNotFound</Code></Error>', {status: 404}))
        await expect(adapter().get('missing')).resolves.toBeNull()
    })

    test('creates a queue through the Azure Storage endpoint', async () => {
        const calls = stubFetch(() => new Response(null, {status: 201}))

        await expect(adapter().create({values: {queueName: '  orders  '}})).resolves.toMatchObject({
            id: 'orders', name: 'orders', service: 'queue',
        })
        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe(`${ROOT}/orders`)
        expect(calls[0]?.init?.method).toBe('PUT')
    })

    test('reports an existing queue instead of claiming an idempotent 204 created it', async () => {
        stubFetch(() => new Response(null, {status: 204}))

        await expect(adapter().create({values: {queueName: 'orders'}})).rejects.toBeInstanceOf(ConflictError)
    })

    test('validates queue names before contacting the runtime', async () => {
        const calls = stubFetch(() => new Response(null, {status: 201}))
        for (const name of ['', 'ab', 'UPPER', '-bad', 'bad-', 'two--hyphens', 'a'.repeat(64)]) {
            await expect(adapter().create({values: {queueName: name}})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(calls).toHaveLength(0)
    })

    test('deletes by queue name and probes the list endpoint', async () => {
        const calls = stubFetch(() => new Response(null, {status: 204}))

        await adapter().delete('audit-log')
        await adapter().health()

        expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
            [`${ROOT}/audit-log`, 'DELETE'],
            [`${ROOT}?comp=list&maxresults=1`, 'GET'],
        ])
    })

    test('serves create, list, inspect, and delete through the generic cloud routes', async () => {
        const queues = new Set<string>()
        stubFetch((url, init) => {
            if (url === `${ROOT}?comp=list`) {
                const rows = [...queues].map((name) => `<Queue><Name>${name}</Name></Queue>`).join('')
                return new Response(`<EnumerationResults><Queues>${rows}</Queues></EnumerationResults>`)
            }
            if (url === `${ROOT}/orders?comp=metadata`) {
                return queues.has('orders')
                    ? new Response(null, {headers: {'x-ms-approximate-messages-count': '0'}})
                    : new Response(null, {status: 404})
            }
            if (url === `${ROOT}/orders` && init?.method === 'PUT') {
                if (queues.has('orders')) return new Response(null, {status: 204})
                queues.add('orders')
                return new Response(null, {status: 201})
            }
            if (url === `${ROOT}/orders` && init?.method === 'DELETE') {
                queues.delete('orders')
                return new Response(null, {status: 204})
            }
            return new Response(null, {status: 404})
        })

        const app = new Hono()
        const service = new CloudProxyService(new CloudAdapterRegistry([adapter()]), {
            aws: async () => {}, azure: async () => {}, gcp: async () => {}, oci: async () => {},
        })
        app.route('/api/clouds', createCloudRoutes(service))
        const path = '/api/clouds/azure/services/queue'

        expect((await (await app.request('/api/clouds/azure/services')).json())
            .find((entry: {service: string}) => entry.service === 'queue')).toMatchObject({availability: 'available'})
        expect((await (await app.request(`${path}/schema`)).json()).service).toBe('queue')

        const created = await app.request(`${path}/resources`, {
            method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({queueName: 'orders'}),
        })
        expect(created.status).toBe(201)
        expect((await created.json()).id).toBe('orders')

        const invalid = await app.request(`${path}/resources`, {
            method: 'POST', headers: {'content-type': 'application/json'}, body: 'null',
        })
        expect(invalid.status).toBe(400)
        expect((await invalid.json()).code).toBe('invalid_request')

        const duplicate = await app.request(`${path}/resources`, {
            method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({queueName: 'orders'}),
        })
        expect(duplicate.status).toBe(409)
        expect((await duplicate.json()).code).toBe('resource_conflict')

        const listed = await app.request(`${path}/resources`)
        expect((await listed.json())).toMatchObject([{id: 'orders'}])

        const inspected = await app.request(`${path}/resources/orders`)
        expect((await inspected.json()).metadata.approximateMessages).toBe(0)

        const deleted = await app.request(`${path}/resources/orders`, {method: 'DELETE'})
        expect(deleted.status).toBe(200)
        expect((await (await app.request(`${path}/resources/orders`)).status)).toBe(404)
    })
})
