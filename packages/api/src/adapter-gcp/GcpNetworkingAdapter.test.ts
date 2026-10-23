import {afterEach, describe, expect, test} from 'bun:test'
import {GcpNetworkingAdapter} from './GcpNetworkingAdapter'
import {GcpRestRuntimeClient} from '../gcp'
import {ConflictError, NotFoundError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4588'
const BASE = `${ENDPOINT}/compute/v1/projects/floci-local`
const SELF = 'https://www.googleapis.com/compute/v1/projects/floci-local'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): GcpNetworkingAdapter {
    return new GcpNetworkingAdapter(new GcpRestRuntimeClient(ENDPOINT, 'floci-local', 'us-central1'))
}

interface Call {
    url: string
    method: string
    body?: unknown
}

function stubFetch(routes: Record<string, unknown | ((call: Call) => Response)>) {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const call: Call = {
            url: String(url),
            method: init?.method ?? 'GET',
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        }
        calls.push(call)
        const route = routes[`${call.method} ${call.url.replace(BASE, '').split('?')[0]}`]
        if (typeof route === 'function') return route(call)
        if (route === undefined) return json({error: {code: 404, message: 'Resource not found'}}, 404)
        return json(route)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

const network = {
    name: 'net-a',
    selfLink: `${SELF}/global/networks/net-a`,
    autoCreateSubnetworks: false,
    routingConfig: {routingMode: 'REGIONAL'},
    subnetworks: [`${SELF}/regions/us-central1/subnetworks/sub-a`],
}
const subnet = {
    name: 'sub-a',
    network: `${SELF}/global/networks/net-a`,
    region: `${SELF}/regions/us-central1`,
    ipCidrRange: '10.0.0.0/24',
    gatewayAddress: '10.0.0.1',
}
const firewall = {
    name: 'fw-a',
    network: `${SELF}/global/networks/net-a`,
    direction: 'INGRESS',
    priority: 1000,
    sourceRanges: ['0.0.0.0/0'],
    allowed: [{IPProtocol: 'tcp', ports: ['22', '80-90']}],
}
const operation = {kind: 'compute#operation', status: 'PENDING'}

const listRoutes = {
    'GET /global/networks': {items: [network]},
    'GET /aggregated/subnetworks': {items: {'regions/us-central1': {subnetworks: [subnet]}}},
    'GET /global/firewalls': {items: [firewall]},
}

describe('GcpNetworkingAdapter', () => {
    test('identifies itself as the GCP networking adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('gcp')
        expect(instance.service).toBe('networking')
        expect(instance.schema().actions).toEqual(['list', 'inspect', 'create', 'delete'])
    })

    test('lists networks, subnetworks and firewalls with kind-prefixed ids', async () => {
        stubFetch(listRoutes)
        const resources = await adapter().list()

        expect(resources.map((r) => [r.id, r.type])).toEqual([
            ['network:net-a', 'network'],
            ['subnetwork:us-central1:sub-a', 'subnetwork'],
            ['firewall:fw-a', 'firewall'],
        ])
        expect(resources[1]).toMatchObject({
            region: 'us-central1',
            metadata: {network: 'net-a', ipCidrRange: '10.0.0.0/24'},
        })
        expect(resources[2]?.metadata).toMatchObject({direction: 'INGRESS', action: 'allow', rules: ['tcp:22,80-90']})
    })

    test('reads subnetworks for every region in one aggregated call', async () => {
        const calls = stubFetch(listRoutes)
        await adapter().list()
        expect(calls.filter((c) => c.url.includes('/subnetworks'))).toHaveLength(1)
    })

    test('normalizes empty lists, including an aggregated list with no items', async () => {
        stubFetch({
            'GET /global/networks': {kind: 'compute#networkList', items: []},
            'GET /aggregated/subnetworks': {kind: 'compute#subnetworkAggregatedList', items: {}},
            'GET /global/firewalls': {kind: 'compute#firewallList'},
        })
        await expect(adapter().list()).resolves.toEqual([])
    })

    test('follows nextPageToken', async () => {
        const calls = stubFetch({
            'GET /global/networks': (call: Call) =>
                call.url.includes('pageToken=t2')
                    ? json({items: [{...network, name: 'net-b'}]})
                    : json({items: [network], nextPageToken: 't2'}),
            'GET /aggregated/subnetworks': {},
            'GET /global/firewalls': {},
        })
        const resources = await adapter().list()
        expect(resources.map((r) => r.name)).toEqual(['net-a', 'net-b'])
        expect(calls.some((c) => c.url.endsWith('/global/networks?pageToken=t2'))).toBe(true)
    })

    test('filters by search term and by kind facet', async () => {
        stubFetch(listRoutes)
        await expect(adapter().list({search: 'sub'})).resolves.toHaveLength(1)
        await expect(adapter().list({search: 'firewall'})).resolves.toHaveLength(1)

        const calls = stubFetch(listRoutes)
        const only = await adapter().list({filters: {kind: 'firewall'}})
        expect(only.map((r) => r.type)).toEqual(['firewall'])
        expect(calls.every((c) => c.url.endsWith('/global/firewalls'))).toBe(true)
        await expect(adapter().list({filters: {kind: 'route'}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('inspects each kind by id and returns null for a missing one', async () => {
        stubFetch({
            'GET /global/networks/net-a': network,
            'GET /regions/us-central1/subnetworks/sub-a': subnet,
            'GET /global/firewalls/fw-a': firewall,
        })
        expect((await adapter().get('network:net-a'))?.type).toBe('network')
        expect((await adapter().get('subnetwork:us-central1:sub-a'))?.name).toBe('sub-a')
        expect((await adapter().get('firewall:fw-a'))?.metadata.network).toBe('net-a')
        await expect(adapter().get('network:nope')).resolves.toBeNull()
    })

    test('rejects an id that names no kind', async () => {
        stubFetch({})
        await expect(adapter().get('net-a')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().delete('subnetwork:sub-a')).rejects.toBeInstanceOf(ValidationError)
    })

    test('creates a custom-mode network and reads it back', async () => {
        const calls = stubFetch({
            'POST /global/networks': operation,
            'GET /global/networks/net-a': network,
        })
        const created = await adapter().create({values: {kind: 'network', name: 'net-a'}})

        expect(calls[0]?.body).toEqual({
            name: 'net-a',
            autoCreateSubnetworks: false,
            routingConfig: {routingMode: 'REGIONAL'},
        })
        expect(created.id).toBe('network:net-a')
    })

    test('creates a subnetwork with the full network reference', async () => {
        const calls = stubFetch({
            'POST /regions/europe-west1/subnetworks': operation,
            'GET /regions/europe-west1/subnetworks/sub-a': {...subnet, region: `${SELF}/regions/europe-west1`},
        })
        const created = await adapter().create({
            values: {kind: 'subnetwork', name: 'sub-a', subnetNetwork: 'net-a', region: 'europe-west1', ipCidrRange: '10.0.0.0/24'},
        })

        expect(calls[0]?.body).toEqual({
            name: 'sub-a',
            network: 'projects/floci-local/global/networks/net-a',
            ipCidrRange: '10.0.0.0/24',
        })
        expect(created.id).toBe('subnetwork:europe-west1:sub-a')
    })

    test('defaults the subnetwork region to the client location', async () => {
        const calls = stubFetch({
            'POST /regions/us-central1/subnetworks': operation,
            'GET /regions/us-central1/subnetworks/sub-a': subnet,
        })
        await adapter().create({values: {kind: 'subnetwork', name: 'sub-a', subnetNetwork: 'net-a', ipCidrRange: '10.0.0.0/24'}})
        expect(calls[0]?.url).toBe(`${BASE}/regions/us-central1/subnetworks`)
    })

    test('creates an ingress firewall rule from the flat form', async () => {
        const calls = stubFetch({
            'POST /global/firewalls': operation,
            'GET /global/firewalls/fw-a': firewall,
        })
        await adapter().create({
            values: {
                kind: 'firewall',
                name: 'fw-a',
                firewallNetwork: 'net-a',
                ranges: '0.0.0.0/0, 10.0.0.0/8',
                ports: '22, 80-90',
            },
        })

        expect(calls[0]?.body).toEqual({
            name: 'fw-a',
            network: 'projects/floci-local/global/networks/net-a',
            direction: 'INGRESS',
            priority: 1000,
            sourceRanges: ['0.0.0.0/0', '10.0.0.0/8'],
            allowed: [{IPProtocol: 'tcp', ports: ['22', '80-90']}],
        })
    })

    test('uses destinationRanges for egress and keeps a full network path as given', async () => {
        const calls = stubFetch({'POST /global/firewalls': operation, 'GET /global/firewalls/fw-e': firewall})
        await adapter().create({
            values: {
                kind: 'firewall',
                name: 'fw-e',
                firewallNetwork: 'projects/other/global/networks/net-a',
                direction: 'EGRESS',
                protocol: 'icmp',
                ranges: '10.0.0.0/8',
            },
        })
        expect(calls[0]?.body).toMatchObject({
            network: 'projects/other/global/networks/net-a',
            destinationRanges: ['10.0.0.0/8'],
            allowed: [{IPProtocol: 'icmp'}],
        })
        expect(calls[0]?.body).not.toHaveProperty('sourceRanges')
    })

    test.each([
        ['an unknown kind', {kind: 'route', name: 'x'}],
        ['a missing name', {kind: 'network'}],
        ['an upper case name', {kind: 'network', name: 'Net_A'}],
        ['a subnetwork without a network', {kind: 'subnetwork', name: 'a', ipCidrRange: '10.0.0.0/24'}],
        ['a bad CIDR', {kind: 'subnetwork', name: 'a', subnetNetwork: 'n', ipCidrRange: '999.0.0.0/24'}],
        ['a bad region', {kind: 'subnetwork', name: 'a', subnetNetwork: 'n', region: 'moon', ipCidrRange: '10.0.0.0/24'}],
        ['a firewall without ranges', {kind: 'firewall', name: 'a', firewallNetwork: 'n'}],
        ['a bad direction', {kind: 'firewall', name: 'a', firewallNetwork: 'n', ranges: '10.0.0.0/8', direction: 'SIDEWAYS'}],
        ['ports on icmp', {kind: 'firewall', name: 'a', firewallNetwork: 'n', ranges: '10.0.0.0/8', protocol: 'icmp', ports: '80'}],
        ['a priority above 65535', {kind: 'firewall', name: 'a', firewallNetwork: 'n', ranges: '10.0.0.0/8', priority: '70000'}],
    ])('rejects %s before calling the runtime', async (_label, values) => {
        const calls = stubFetch({})
        await expect(adapter().create({values})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('surfaces runtime conflicts and missing resources as typed errors', async () => {
        stubFetch({'POST /global/networks': () => json({error: {code: 409, message: 'Resource already exists'}}, 409)})
        await expect(adapter().create({values: {kind: 'network', name: 'net-a'}})).rejects.toBeInstanceOf(ConflictError)

        stubFetch({})
        await expect(adapter().delete('firewall:nope')).rejects.toBeInstanceOf(NotFoundError)
    })

    test('reports a network that is still in use as a validation error', async () => {
        stubFetch({
            'DELETE /global/networks/net-a': () =>
                json({error: {code: 400, message: 'Resource is in use by regions/us-central1/subnetworks/sub-a'}}, 400),
        })
        await expect(adapter().delete('network:net-a')).rejects.toThrow('in use by regions/us-central1/subnetworks/sub-a')
    })

    test('deletes each kind on its own path', async () => {
        const calls = stubFetch({
            'DELETE /global/networks/net-a': operation,
            'DELETE /regions/us-central1/subnetworks/sub-a': operation,
            'DELETE /global/firewalls/fw-a': operation,
        })
        await adapter().delete('network:net-a')
        await adapter().delete('subnetwork:us-central1:sub-a')
        await adapter().delete('firewall:fw-a')

        expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
            'DELETE /global/networks/net-a',
            'DELETE /regions/us-central1/subnetworks/sub-a',
            'DELETE /global/firewalls/fw-a',
        ])
    })
})
