import {afterEach, describe, expect, test} from 'bun:test'
import {GcpCloudRunAdapter} from './GcpCloudRunAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const SERVICES_PATH = '/v2/projects/floci-local/locations/us-central1/services'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpCloudRunAdapter {
    return new GcpCloudRunAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

/** Records every request so path, method and body can be asserted. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function cloudRunService(name: string, overrides: Record<string, unknown> = {}) {
    return {
        name: `projects/floci-local/locations/us-central1/services/${name}`,
        uid: '4cd5586e-3fca-460b-ac38-2267fc4b8b79',
        generation: '1',
        createTime: '2026-07-28T09:21:30.065937592Z',
        updateTime: '2026-07-28T09:21:30.065937592Z',
        template: {containers: [{image: 'nginx:alpine'}]},
        traffic: [{type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100}],
        urls: [`http://${name}-1efb2c36c23f.us-central1.run.localhost.floci.io:4588`],
        observedGeneration: '1',
        terminalCondition: {
            type: 'Ready',
            state: 'CONDITION_SUCCEEDED',
            message: 'Ready',
            lastTransitionTime: '2026-07-28T09:21:30.065937592Z',
        },
        ...overrides,
    }
}

describe('GcpCloudRunAdapter', () => {
    test('identifies itself as the GCP containers adapter', () => {
        const a = adapter()

        expect(a.cloud).toBe('gcp')
        expect(a.service).toBe('containers')
        expect(a.schema().displayName).toBe('Cloud Run')
    })

    test('lists services and maps the v2 resource shape', async () => {
        const calls = stubFetch(() => json({services: [cloudRunService('web')]}))
        const [resource] = await adapter().list()

        expect(calls[0]?.url).toBe(`${ENDPOINT}${SERVICES_PATH}`)
        expect(resource).toMatchObject({
            id: 'web',
            name: 'web',
            cloud: 'gcp',
            service: 'containers',
            type: 'cloud-run-service',
            region: 'us-central1',
            createdAt: '2026-07-28T09:21:30.065937592Z',
            status: 'SUCCEEDED',
        })
        expect(resource?.metadata).toMatchObject({
            image: 'nginx:alpine',
            uri: 'http://web-1efb2c36c23f.us-central1.run.localhost.floci.io:4588',
            generation: '1',
        })
    })

    test('reports an empty list when the runtime returns no services key', async () => {
        // The runtime answers `{}` rather than `{"services": []}` when empty.
        stubFetch(() => json({}))
        await expect(adapter().list()).resolves.toEqual([])
    })

    test('surfaces a failed readiness condition instead of hiding it', async () => {
        // A container that does not listen on $PORT never becomes ready. The state
        // and the runtime's explanation both have to reach the UI.
        stubFetch(() =>
            json({
                services: [
                    cloudRunService('broken', {
                        terminalCondition: {
                            type: 'Ready',
                            state: 'CONDITION_FAILED',
                            message: 'Cloud Run runtime did not become ready before timeout: Connection refused',
                        },
                    }),
                ],
            }),
        )
        const [resource] = await adapter().list()

        expect(resource?.status).toBe('FAILED')
        expect(resource?.metadata.terminalMessage).toContain('did not become ready')
    })

    test('follows nextPageToken until the runtime stops paging', async () => {
        let call = 0
        const calls = stubFetch(() => {
            call += 1
            if (call === 1) return json({services: [cloudRunService('one')], nextPageToken: 'page-2'})
            return json({services: [cloudRunService('two')]})
        })

        const resources = await adapter().list()

        expect(resources.map((r) => r.id)).toEqual(['one', 'two'])
        expect(calls[1]?.url).toContain('pageToken=page-2')
    })

    test('filters the list by search term', async () => {
        stubFetch(() => json({services: [cloudRunService('web'), cloudRunService('api')]}))
        const a = adapter()

        await expect(a.list({search: 'we'})).resolves.toHaveLength(1)
        await expect(a.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a service by short name', async () => {
        const calls = stubFetch(() => json(cloudRunService('web')))
        const resource = await adapter().get('web')

        expect(calls[0]?.url).toBe(`${ENDPOINT}${SERVICES_PATH}/web`)
        expect(resource?.id).toBe('web')
    })

    test('returns null when a service does not exist', async () => {
        stubFetch(() => json({error: {code: 404, message: 'Cloud Run service not found', status: 'NOT_FOUND'}}, 404))
        await expect(adapter().get('missing')).resolves.toBeNull()
    })

    test('deploys a service with the image under the template', async () => {
        const calls = stubFetch((url, init) =>
            init?.method === 'POST'
                ? json({name: 'projects/floci-local/locations/us-central1/operations/op-1'})
                : json(cloudRunService('web')),
        )
        const resource = await adapter().create({values: {name: 'web', image: 'nginx:alpine'}})

        const post = calls[0]
        expect(post?.url).toBe(`${ENDPOINT}${SERVICES_PATH}?serviceId=web`)
        expect(post?.init?.method).toBe('POST')
        expect(JSON.parse(String(post?.init?.body))).toEqual({
            template: {containers: [{image: 'nginx:alpine'}]},
        })
        // create returns an Operation, so the service is read back rather than
        // parsed out of the envelope.
        expect(calls[1]?.url).toBe(`${ENDPOINT}${SERVICES_PATH}/web`)
        expect(resource.id).toBe('web')
    })

    test('passes a container port through when one is given', async () => {
        const calls = stubFetch((url, init) =>
            init?.method === 'POST' ? json({name: 'op'}) : json(cloudRunService('web')),
        )
        await adapter().create({values: {name: 'web', image: 'nginx:alpine', port: '3000'}})

        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            template: {containers: [{image: 'nginx:alpine', ports: [{containerPort: 3000}]}]},
        })
    })

    test('requires the fields the schema marks required', async () => {
        const a = adapter()

        await expect(a.create({values: {}})).rejects.toThrow(new ValidationError('name is required'))
        await expect(a.create({values: {name: 'web'}})).rejects.toThrow(new ValidationError('image is required'))
    })

    test('rejects a name the runtime would refuse', async () => {
        const a = adapter()

        for (const name of ['Web', '1web', 'web_service', 'web-']) {
            await expect(a.create({values: {name, image: 'nginx'}})).rejects.toThrow(ValidationError)
        }
    })

    test('rejects a port that is not a number', async () => {
        await expect(
            adapter().create({values: {name: 'web', image: 'nginx', port: 'http'}}),
        ).rejects.toThrow(ValidationError)
    })

    test('deletes a service by short name', async () => {
        const calls = stubFetch(() => json({name: 'op-delete'}))
        await adapter().delete('web')

        expect(calls[0]?.url).toBe(`${ENDPOINT}${SERVICES_PATH}/web`)
        expect(calls[0]?.init?.method).toBe('DELETE')
    })
})
