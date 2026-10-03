import {afterEach, describe, expect, test} from 'bun:test'
import {GcpComputeAdapter} from './GcpComputeAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const PROJECT_PATH = '/compute/v1/projects/floci-local'
const SELF = 'https://www.googleapis.com/compute/v1/projects/floci-local'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpComputeAdapter {
    return new GcpComputeAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{url: string; init?: RequestInit}> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), init})
        return handler(String(url), init)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})
}

/** Shape captured from the floci-gcp nightly image. */
function gceInstance(name: string, status = 'RUNNING') {
    return {
        kind: 'compute#instance',
        id: '1008',
        name,
        status,
        zone: `${SELF}/zones/us-central1-a`,
        machineType: `${SELF}/zones/us-central1-a/machineTypes/e2-standard-2`,
        creationTimestamp: '2026-10-03T20:46:21.948001847Z',
        disks: [{boot: true, autoDelete: true, source: `${SELF}/zones/us-central1-a/disks/${name}`, diskSizeGb: '10'}],
        networkInterfaces: [
            {
                network: `${SELF}/global/networks/net1`,
                subnetwork: `${SELF}/regions/us-central1/subnetworks/sub1`,
                name: 'nic0',
                networkIP: '10.0.0.2',
            },
        ],
    }
}

function operation(status: 'PENDING' | 'DONE', error?: unknown) {
    return {kind: 'compute#operation', name: 'operation-1', operationType: 'insert', status, ...(error ? {error} : {})}
}

const validValues = {
    name: 'vm1',
    zone: 'us-central1-a',
    machineType: 'e2-standard-2',
    network: 'net1',
    subnetwork: 'sub1',
}

describe('GcpComputeAdapter', () => {
    test('identifies itself as the GCP compute adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('gcp')
        expect(instance.service).toBe('compute')
        expect(instance.schema().cloud).toBe('gcp')
    })

    test('lists instances across zones from the aggregated list', async () => {
        const calls = stubFetch(() =>
            json({
                items: {
                    'zones/us-central1-a': {instances: [gceInstance('vm1')]},
                    'zones/us-central1-b': {warning: {code: 'NO_RESULTS_ON_PAGE'}},
                },
            }),
        )

        const resources = await adapter().list()

        expect(calls[0].url).toBe(`${ENDPOINT}${PROJECT_PATH}/aggregated/instances`)
        expect(resources).toHaveLength(1)
        expect(resources[0]).toMatchObject({
            id: 'us-central1-a/vm1',
            name: 'vm1',
            cloud: 'gcp',
            service: 'compute',
            type: 'instance',
            region: 'us-central1-a',
            status: 'RUNNING',
            instanceClass: 'e2-standard-2',
        })
        expect(resources[0].metadata).toMatchObject({internalIp: '10.0.0.2', network: 'net1', subnetwork: 'sub1'})
    })

    test('returns an empty list when nothing exists', async () => {
        stubFetch(() => json({kind: 'compute#instanceAggregatedList', items: {}}))
        expect(await adapter().list()).toEqual([])
    })

    test('filters the list by search term', async () => {
        stubFetch(() => json({items: {'zones/us-central1-a': {instances: [gceInstance('web-1'), gceInstance('db-1')]}}}))
        const resources = await adapter().list({search: 'WEB'})
        expect(resources.map((resource) => resource.name)).toEqual(['web-1'])
    })

    test('gets an instance by zone and name', async () => {
        const calls = stubFetch(() => json(gceInstance('vm1', 'TERMINATED')))

        const resource = await adapter().get('us-central1-a/vm1')

        expect(calls[0].url).toBe(`${ENDPOINT}${PROJECT_PATH}/zones/us-central1-a/instances/vm1`)
        expect(resource?.status).toBe('TERMINATED')
    })

    test('returns null when the instance is gone', async () => {
        stubFetch(() => json({error: {code: 404, message: 'not found'}}, 404))
        expect(await adapter().get('us-central1-a/missing')).toBeNull()
    })

    test('rejects an id without a zone', async () => {
        await expect(adapter().get('vm1')).rejects.toBeInstanceOf(ValidationError)
    })

    test('creates an instance, polls the operation and reads it back', async () => {
        let operationReads = 0
        const calls = stubFetch((url, init) => {
            if (init?.method === 'POST') return json(operation('PENDING'))
            if (url.includes('/operations/')) return json(operation(++operationReads > 1 ? 'DONE' : 'PENDING'))
            return json(gceInstance('vm1'))
        })

        const resource = await adapter().create({values: validValues})

        const post = calls[0]
        expect(post.url).toBe(`${ENDPOINT}${PROJECT_PATH}/zones/us-central1-a/instances`)
        expect(JSON.parse(String(post.init?.body))).toEqual({
            name: 'vm1',
            machineType: 'zones/us-central1-a/machineTypes/e2-standard-2',
            disks: [{boot: true, autoDelete: true, initializeParams: {diskSizeGb: '10'}}],
            networkInterfaces: [{network: 'global/networks/net1', subnetwork: 'regions/us-central1/subnetworks/sub1'}],
        })
        expect(operationReads).toBe(2)
        expect(resource.id).toBe('us-central1-a/vm1')
    })

    test('surfaces a failed operation as a runtime error', async () => {
        stubFetch((_url, init) =>
            init?.method === 'POST' ? json(operation('DONE', {errors: [{message: 'quota exceeded'}]})) : json({}),
        )
        await expect(adapter().create({values: validValues})).rejects.toBeInstanceOf(RuntimeError)
    })

    test('validates create input before calling the runtime', async () => {
        const calls = stubFetch(() => json({}))

        await expect(adapter().create({values: {...validValues, name: 'Bad_Name'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {...validValues, zone: 'mars-1-a'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {...validValues, subnetwork: ''}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().create({values: {...validValues, diskSizeGb: '0'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('deletes an instance and tolerates one that is already gone', async () => {
        const calls = stubFetch(() => json({error: {code: 404, message: 'not found'}}, 404))

        await adapter().delete('us-central1-a/vm1')

        expect(calls[0].init?.method).toBe('DELETE')
        expect(calls[0].url).toBe(`${ENDPOINT}${PROJECT_PATH}/zones/us-central1-a/instances/vm1`)
    })

    test('maps start, stop and reboot to start, stop and reset', async () => {
        const calls = stubFetch(() => json(operation('PENDING')))

        await adapter().start('us-central1-a/vm1')
        await adapter().stop('us-central1-a/vm1')
        await adapter().reboot('us-central1-a/vm1')

        expect(calls.map((call) => call.url.split('/').pop())).toEqual(['start', 'stop', 'reset'])
        expect(calls.every((call) => call.init?.method === 'POST')).toBe(true)
    })

    describe('network defaults', () => {
        const noNetwork = {name: 'vm1', zone: 'us-central1-a', machineType: 'e2-standard-2'}
        const notFound = () => json({error: {code: 404, message: 'not found'}}, 404)

        /** Runtime where `existing` URLs answer 200 on GET and everything else is missing. */
        function runtime(existing: string[], onPost?: (url: string) => Response | undefined) {
            return stubFetch((url, init) => {
                const path = url.replace(ENDPOINT, '')
                if (init?.method === 'POST') {
                    const override = onPost?.(path)
                    if (override) return override
                    return json(operation('DONE'))
                }
                if (path.includes('/operations/')) return json(operation('DONE'))
                if (path.endsWith('/instances/vm1')) return json(gceInstance('vm1'))
                return existing.includes(path) ? json({name: 'x'}) : notFound()
            })
        }

        const net = `${PROJECT_PATH}/global/networks/default`
        const subnet = (region: string) => `${PROJECT_PATH}/regions/${region}/subnetworks/default`

        test('with no network or subnetwork, creates the default VPC and regional subnet when missing', async () => {
            const calls = runtime([])

            await adapter().create({values: noNetwork})

            const posts = calls.filter((call) => call.init?.method === 'POST')
            expect(posts.map((call) => call.url.replace(ENDPOINT, ''))).toEqual([
                `${PROJECT_PATH}/global/networks`,
                `${PROJECT_PATH}/regions/us-central1/subnetworks`,
                `${PROJECT_PATH}/zones/us-central1-a/instances`,
            ])
            expect(JSON.parse(String(posts[0].init?.body))).toEqual({name: 'default', autoCreateSubnetworks: false})
            expect(JSON.parse(String(posts[1].init?.body))).toEqual({
                name: 'default',
                network: 'global/networks/default',
                ipCidrRange: '10.128.0.0/20',
            })
            expect(JSON.parse(String(posts[2].init?.body)).networkInterfaces).toEqual([
                {network: 'global/networks/default', subnetwork: 'regions/us-central1/subnetworks/default'},
            ])
        })

        test('uses the region-specific default range outside us-central1', async () => {
            const calls = runtime([net])

            await adapter().create({values: {...noNetwork, zone: 'europe-west1-b'}})

            const subnetPost = calls.find((call) => call.url.endsWith('/regions/europe-west1/subnetworks'))
            expect(JSON.parse(String(subnetPost?.init?.body)).ipCidrRange).toBe('10.132.0.0/20')
        })

        test('does not recreate default resources that already exist', async () => {
            const calls = runtime([net, subnet('us-central1')])

            await adapter().create({values: noNetwork})

            const posts = calls.filter((call) => call.init?.method === 'POST')
            expect(posts.map((call) => call.url.replace(ENDPOINT, ''))).toEqual([
                `${PROJECT_PATH}/zones/us-central1-a/instances`,
            ])
        })

        test('tolerates a concurrent creator winning the race with a 409', async () => {
            runtime([], (path) =>
                path.endsWith('/global/networks') ? json({error: {code: 409, message: 'exists'}}, 409) : undefined,
            )
            const resource = await adapter().create({values: noNetwork})
            expect(resource.id).toBe('us-central1-a/vm1')
        })

        test('network default without a subnetwork behaves like no networking at all', async () => {
            const calls = runtime([net, subnet('us-central1')])
            await adapter().create({values: {...noNetwork, network: 'default'}})
            expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(1)
        })

        test('a custom network without a subnetwork is rejected like GCP does', async () => {
            const calls = stubFetch(() => json({}))
            await expect(adapter().create({values: {...noNetwork, network: 'my-vpc'}})).rejects.toBeInstanceOf(
                ValidationError,
            )
            expect(calls).toHaveLength(0)
        })

        test('a subnetwork alone takes its network from the subnetwork', async () => {
            const calls = stubFetch((url, init) => {
                if (init?.method === 'POST') return json(operation('DONE'))
                if (url.includes('/subnetworks/my-subnet')) return json({name: 'my-subnet', network: `${SELF}/global/networks/my-vpc`})
                if (url.includes('/operations/')) return json(operation('DONE'))
                return json(gceInstance('vm1'))
            })

            await adapter().create({values: {...noNetwork, subnetwork: 'my-subnet'}})

            const post = calls.find((call) => call.init?.method === 'POST')
            expect(JSON.parse(String(post?.init?.body)).networkInterfaces).toEqual([
                {network: 'global/networks/my-vpc', subnetwork: 'regions/us-central1/subnetworks/my-subnet'},
            ])
        })

        test('a subnetwork that does not exist is a validation error', async () => {
            stubFetch(() => json({error: {code: 404, message: 'not found'}}, 404))
            await expect(adapter().create({values: {...noNetwork, subnetwork: 'ghost'}})).rejects.toBeInstanceOf(
                ValidationError,
            )
        })
    })

    test('follows nextPageToken across aggregated pages before filtering', async () => {
        const calls = stubFetch((url) =>
            url.includes('pageToken=tok%201')
                ? json({items: {'zones/us-central1-b': {instances: [gceInstance('web-2')]}}, nextPageToken: 'tok 2'})
                : url.includes('pageToken=tok%202')
                  ? json({items: {'zones/us-central1-c': {instances: [gceInstance('web-3')]}}})
                  : json({items: {'zones/us-central1-a': {instances: [gceInstance('web-1')]}}, nextPageToken: 'tok 1'}),
        )

        const all = await adapter().list()
        expect(all.map((resource) => resource.name)).toEqual(['web-1', 'web-2', 'web-3'])
        expect(calls.map((call) => call.url.split('?')[1] ?? '')).toEqual(['', 'pageToken=tok%201', 'pageToken=tok%202'])

        stubFetch((url) =>
            url.includes('pageToken=')
                ? json({items: {'zones/us-central1-b': {instances: [gceInstance('needle')]}}})
                : json({items: {'zones/us-central1-a': {instances: [gceInstance('web-1')]}}, nextPageToken: 'next'}),
        )
        expect((await adapter().list({search: 'needle'})).map((resource) => resource.name)).toEqual(['needle'])
    })

    describe('runtime availability', () => {
        const health = (services: Record<string, string>) => () => json({services, version: 'x'})

        test('is available when the runtime health lists compute', async () => {
            stubFetch(health({gke: 'running', compute: 'running'}))
            expect(await adapter().resolveDescriptorOverride()).toEqual({})
        })

        test('is unavailable with a reason when health omits compute (floci-gcp 0.9.0)', async () => {
            const calls = stubFetch(health({gke: 'running', cloudrun: 'running'}))
            const override = await adapter().resolveDescriptorOverride()
            expect(calls[0].url).toBe(`${ENDPOINT}/_floci-gcp/health`)
            expect(override.availability).toBe('coming_soon')
            expect(override.reason).toContain('floci-gcp:nightly')
        })

        test('stays available when health cannot be read', async () => {
            stubFetch(() => {
                throw new TypeError('connection refused')
            })
            expect(await adapter().resolveDescriptorOverride()).toEqual({})
            stubFetch(() => new Response('not json', {status: 200}))
            expect(await adapter().resolveDescriptorOverride()).toEqual({})
        })

        test('gives up on a stalled health request and stays available', async () => {
            globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
                })) as unknown as typeof fetch
            const started = Date.now()
            expect(await adapter().resolveDescriptorOverride()).toEqual({})
            expect(Date.now() - started).toBeLessThan(4_000)
        }, 6_000)

        test('memoizes the probe briefly', async () => {
            const calls = stubFetch(health({compute: 'running'}))
            const instance = adapter()
            await instance.resolveDescriptorOverride()
            await instance.resolveDescriptorOverride()
            expect(calls).toHaveLength(1)
        })
    })
})
