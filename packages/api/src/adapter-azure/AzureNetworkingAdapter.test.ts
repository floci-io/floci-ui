import {afterEach, describe, expect, test} from 'bun:test'
import {AzureNetworkingAdapter} from './AzureNetworkingAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {ConflictError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureNetworkingAdapter {
    return new AzureNetworkingAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

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

function vnet(name: string, rg = 'rg-app', subnets = [{name: 'default', properties: {addressPrefix: '10.0.1.0/24'}}]) {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/${rg}/providers/Microsoft.Network/virtualNetworks/${name}`,
        name,
        type: 'Microsoft.Network/virtualNetworks',
        location: 'eastus',
        properties: {
            addressSpace: {addressPrefixes: ['10.0.0.0/16']},
            subnets,
            provisioningState: 'Succeeded',
        },
    }
}

/**
 * Mirrors floci-az rather than being permissive: only the **group-scoped**
 * collection reports VNets, and the subscription-scoped path answers 200 with an
 * empty value. A catch-all that served both made the adapter's original
 * subscription-scoped list look correct while it returned nothing against the
 * real runtime.
 *
 * Stateful on the single-VNet path: a GET for a name not yet in `vnets` is a
 * real 404 (not the first seeded VNet), and a PUT/DELETE mutates the in-memory
 * list, so `create()`'s pre-existence check and its readback-after-PUT both see
 * a consistent runtime rather than always the same fixture.
 */
function runtimeStub(seedVnets: Array<ReturnType<typeof vnet>> = [vnet('core')], groups = [{name: 'rg-app'}]) {
    const vnets = [...seedVnets]
    return stubFetch((url, init) => {
        if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
        if (url.includes('/resourceGroups?') || url.match(/\/resourceGroups$/)) return json({value: groups})

        const single = url.match(
            /resourceGroups\/([^/?]+)\/providers\/Microsoft\.Network\/virtualNetworks\/([^/?]+)\?/,
        )
        if (single) {
            const [, group, name] = single
            const index = vnets.findIndex((v) => v.name === name && v.id.includes(`/resourceGroups/${group}/`))
            if (init?.method === 'PUT') {
                const body = init.body ? JSON.parse(String(init.body)) : {}
                const next = vnet(name, group, body.properties?.subnets ?? [])
                next.location = body.location ?? next.location
                next.properties.addressSpace.addressPrefixes =
                    body.properties?.addressSpace?.addressPrefixes ?? next.properties.addressSpace.addressPrefixes
                if (index >= 0) vnets[index] = next
                else vnets.push(next)
                return json(next)
            }
            if (init?.method === 'DELETE') {
                if (index >= 0) vnets.splice(index, 1)
                return new Response(null, {status: 204})
            }
            return index >= 0 ? json(vnets[index]) : json({error: {code: 'ResourceNotFound'}}, 404)
        }

        const group = url.match(/resourceGroups\/([^/?]+)\/providers\/Microsoft\.Network\/virtualNetworks/)?.[1]
        if (!group) return json({value: []})
        return json({value: vnets.filter((candidate) => candidate.id.includes(`/resourceGroups/${group}/`))})
    })
}

// A name distinct from the default-seeded 'core' VNet, so create tests start
// from "does not exist yet" rather than tripping the duplicate-name check.
const validValues = {name: 'new-vnet', resourceGroup: 'rg-app', addressPrefix: '10.0.0.0/16'}

describe('AzureNetworkingAdapter', () => {
    test('identifies itself as the Azure networking adapter', () => {
        const a = adapter()

        expect(a.cloud).toBe('azure')
        expect(a.service).toBe('networking')
        expect(a.schema().displayName).toBe('Azure Virtual Networks')
    })

    test('lists VNets and maps the ARM shape', async () => {
        runtimeStub()
        const [resource] = await adapter().list()

        expect(resource).toMatchObject({
            id: 'rg-app/core',
            name: 'core',
            cloud: 'azure',
            service: 'networking',
            // Reuses the existing vpc type: a VNet is Azure's VPC, and the shared
            // column stays meaningful without widening the union.
            type: 'vpc',
            region: 'eastus',
            status: 'Succeeded',
        })
        expect(resource?.metadata).toMatchObject({
            resourceGroup: 'rg-app',
            cidrBlock: '10.0.0.0/16',
            addressPrefixes: ['10.0.0.0/16'],
            subnetCount: 1,
        })
    })

    test('summarises subnets with their prefixes', async () => {
        runtimeStub([
            vnet('core', 'rg-app', [
                {name: 'web', properties: {addressPrefix: '10.0.1.0/24'}},
                {name: 'db', properties: {addressPrefix: '10.0.2.0/24'}},
            ]),
        ])
        const [resource] = await adapter().list()

        expect(resource?.metadata.subnets).toEqual([
            {name: 'web', addressPrefix: '10.0.1.0/24'},
            {name: 'db', addressPrefix: '10.0.2.0/24'},
        ])
        expect(resource?.metadata.subnetCount).toBe(2)
    })

    test('handles a VNet with no subnets', async () => {
        runtimeStub([vnet('empty', 'rg-app', [])])
        const [resource] = await adapter().list()

        expect(resource?.metadata.subnetCount).toBe(0)
        expect(resource?.metadata.subnets).toEqual([])
    })

    /**
     * Regression for the empty-table bug: the adapter listed at subscription
     * scope, which floci-az answers 200-with-nothing, so a created VNet never
     * appeared. Verified against the runtime on 2026-07-29.
     */
    test('lists per resource group rather than at subscription scope', async () => {
        const calls = runtimeStub()

        await adapter().list()

        const collectionCalls = calls.filter(
            (call) => call.url.includes('/virtualNetworks?') || call.url.endsWith('/virtualNetworks'),
        )
        expect(collectionCalls.length).toBeGreaterThan(0)
        for (const call of collectionCalls) {
            expect(call.url).toContain('/resourceGroups/rg-app/providers/Microsoft.Network/virtualNetworks')
        }
    })

    test('aggregates VNets across every resource group', async () => {
        runtimeStub(
            [vnet('core', 'rg-app'), vnet('edge', 'rg-net')],
            [{name: 'rg-app'}, {name: 'rg-net'}],
        )

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id).sort()).toEqual(['rg-app/core', 'rg-net/edge'])
    })

    test('lists what it can when one resource group errors, instead of blanking the whole table', async () => {
        // emptyOnNotFound only swallows a 404. A group that answers 403 or 500
        // must not reject the whole aggregate and hide the VNets the other
        // groups did return.
        const calls = stubFetch((url) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            if (url.includes('/resourceGroups?') || url.match(/\/resourceGroups$/)) {
                return json({value: [{name: 'rg-app'}, {name: 'rg-broken'}]})
            }
            if (url.includes('/resourceGroups/rg-broken/')) return json({error: {code: 'Forbidden'}}, 403)
            return json({value: [vnet('core', 'rg-app')]})
        })

        const resources = await adapter().list()

        expect(resources.map((resource) => resource.id)).toEqual(['rg-app/core'])
        expect(calls.some((c) => c.url.includes('rg-broken'))).toBe(true)
    })

    test('filters the list by search term', async () => {
        runtimeStub([vnet('core'), vnet('edge')])
        const a = adapter()

        await expect(a.list({search: 'cor'})).resolves.toHaveLength(1)
        await expect(a.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a VNet addressed by resource group and name', async () => {
        const calls = runtimeStub()
        const resource = await adapter().get('rg-app/core')

        const call = calls.find((c) => c.url.includes('/virtualNetworks/core'))
        expect(call?.url).toContain('/resourceGroups/rg-app/providers/Microsoft.Network/virtualNetworks/core')
        expect(resource?.id).toBe('rg-app/core')
    })

    test('rejects an id that does not name a resource group', async () => {
        await expect(adapter().get('core')).rejects.toThrow(ValidationError)
    })

    test('returns null when a VNet does not exist', async () => {
        stubFetch((url) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            return json({error: {code: 'ResourceNotFound', message: 'not found'}}, 404)
        })
        await expect(adapter().get('rg-app/nope')).resolves.toBeNull()
    })

    test('creates a VNet with its address space', async () => {
        const calls = runtimeStub()
        const resource = await adapter().create({values: validValues})

        const put = calls.find((c) => c.init?.method === 'PUT')
        expect(put?.url).toContain('/resourceGroups/rg-app/providers/Microsoft.Network/virtualNetworks/new-vnet')
        const body = JSON.parse(String(put?.init?.body))
        expect(body.location).toBe('eastus')
        expect(body.properties.addressSpace.addressPrefixes).toEqual(['10.0.0.0/16'])
        expect(body.properties.subnets).toBeUndefined()
        expect(resource.id).toBe('rg-app/new-vnet')
    })

    test('creates the first subnet when both subnet fields are given', async () => {
        const calls = runtimeStub()
        await adapter().create({
            values: {...validValues, subnetName: 'web', subnetPrefix: '10.0.1.0/24'},
        })

        const body = JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body))
        expect(body.properties.subnets).toEqual([{name: 'web', properties: {addressPrefix: '10.0.1.0/24'}}])
    })

    test('requires both subnet fields or neither', async () => {
        // Half a subnet is not something ARM can act on, and silently dropping the
        // one value the user did supply would be worse than saying so.
        runtimeStub()
        const a = adapter()

        await expect(a.create({values: {...validValues, subnetName: 'web'}})).rejects.toThrow(
            new ValidationError('subnetPrefix is required when subnetName is given'),
        )
        await expect(a.create({values: {...validValues, subnetPrefix: '10.0.1.0/24'}})).rejects.toThrow(
            new ValidationError('subnetName is required when subnetPrefix is given'),
        )
    })

    test('accepts a resource group whose case differs from the runtime', async () => {
        // Azure resource group names are case-insensitive, and the id must carry the
        // runtime's spelling or inspect against the returned id would 404.
        const calls = runtimeStub()
        const resource = await adapter().create({values: {...validValues, resourceGroup: 'RG-App'}})

        const put = calls.find((c) => c.init?.method === 'PUT')
        expect(put?.url).toContain('/resourceGroups/rg-app/')
        expect(resource.id).toBe('rg-app/new-vnet')
    })

    test('rejects a resource group that does not exist', async () => {
        runtimeStub([vnet('core')], [])

        await expect(adapter().create({values: validValues})).rejects.toThrow(ValidationError)
    })

    test('requires the fields the schema marks required', async () => {
        runtimeStub()
        const a = adapter()

        const cases: Array<[Record<string, unknown>, string]> = [
            [{}, 'name is required'],
            [{name: 'core'}, 'resourceGroup is required'],
            [{name: 'core', resourceGroup: 'rg-app'}, 'addressPrefix is required'],
        ]

        for (const [values, message] of cases) {
            await expect(a.create({values})).rejects.toThrow(new ValidationError(message))
        }
    })

    test('rejects an address space that is not a CIDR', async () => {
        runtimeStub()
        const a = adapter()

        await expect(a.create({values: {...validValues, addressPrefix: '10.0.0.0'}})).rejects.toThrow(ValidationError)
        await expect(a.create({values: {...validValues, addressPrefix: 'not-a-cidr'}})).rejects.toThrow(ValidationError)
    })

    test('rejects a CIDR whose octets or prefix length are out of range', async () => {
        // A digits-and-slashes pattern accepts 999.999.999.999/99, which then fails
        // at ARM with an opaque runtime error instead of a clear ValidationError.
        runtimeStub()
        const a = adapter()

        for (const cidr of ['999.999.999.999/99', '256.0.0.0/16', '10.0.0.0/33', '10.0.0/16', '10.0.0.0/']) {
            await expect(
                a.create({values: {...validValues, addressPrefix: cidr}}),
                `${cidr} must be rejected`,
            ).rejects.toThrow(ValidationError)
        }
    })

    test('accepts CIDRs at the edges of the valid range', async () => {
        const a = adapter()

        // A fresh stub per iteration: each create() targets the same VNet name,
        // and the runtime is now stateful, so reusing one stub across iterations
        // would make every create after the first a legitimate duplicate.
        for (const cidr of ['0.0.0.0/0', '255.255.255.255/32', '10.0.0.0/16', '192.168.1.0/24']) {
            runtimeStub()
            await expect(a.create({values: {...validValues, addressPrefix: cidr}}), `${cidr} must be accepted`)
                .resolves.toBeDefined()
        }
    })

    test('rejects a subnet CIDR that is out of range too', async () => {
        runtimeStub()

        await expect(
            adapter().create({values: {...validValues, subnetName: 'web', subnetPrefix: '10.0.1.0/33'}}),
        ).rejects.toThrow(ValidationError)
    })

    test('rejects a duplicate create instead of upserting the existing VNet', async () => {
        // The runtime's PUT is an upsert; the UI only exposes "Create VNet" with
        // no update flow, so a second create against an existing name must
        // reject rather than silently modify it.
        const calls = runtimeStub([vnet('core')])

        await expect(adapter().create({values: {...validValues, name: 'core'}})).rejects.toThrow(ConflictError)
        expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false)
    })

    test('serializes concurrent creates of the same name so only one PUT is sent', async () => {
        // A GET-then-PUT check is a race unless concurrent callers for the same
        // name are serialized: without that, both requests can pass the
        // existence check before either PUTs, and the runtime's upsert lets the
        // second silently overwrite the first instead of conflicting.
        const calls = runtimeStub([], [{name: 'rg-app'}])
        const a = adapter()

        const [first, second] = await Promise.allSettled([
            a.create({values: {...validValues, name: 'racer'}}),
            a.create({values: {...validValues, name: 'racer'}}),
        ])

        const outcomes = [first.status, second.status].sort()
        expect(outcomes).toEqual(['fulfilled', 'rejected'])
        const rejected = first.status === 'rejected' ? first : (second as PromiseRejectedResult)
        expect(rejected.reason).toBeInstanceOf(ConflictError)
        expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(1)
    })

    test('serializes concurrent creates across two adapter instances for the same name', async () => {
        // cloudProxy.ts's serviceForAccount caches one CloudProxyService (and
        // therefore one AzureNetworkingAdapter) per account id, but Azure is
        // account-neutral: both instances hit the same floci-az runtime, so
        // the lock must not be per-instance state or two different accounts
        // racing the same VNet name would both pass the existence check.
        const calls = runtimeStub([], [{name: 'rg-app'}])
        const a = adapter()
        const b = adapter()

        const [first, second] = await Promise.allSettled([
            a.create({values: {...validValues, name: 'cross-account-racer'}}),
            b.create({values: {...validValues, name: 'cross-account-racer'}}),
        ])

        const outcomes = [first.status, second.status].sort()
        expect(outcomes).toEqual(['fulfilled', 'rejected'])
        expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(1)
    })

    test('does not serialize creates of different names', async () => {
        runtimeStub([], [{name: 'rg-app'}])
        const a = adapter()

        const results = await Promise.allSettled([
            a.create({values: {...validValues, name: 'racer-a'}}),
            a.create({values: {...validValues, name: 'racer-b'}}),
        ])

        expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    })

    test('rejects a subnet CIDR that is not contained within the address space', async () => {
        // The schema tells the user the subnet must sit inside the address
        // space; the adapter previously only checked that both were valid
        // CIDRs, so a subnet outside the VNet's range would reach the runtime.
        const calls = runtimeStub()

        await expect(
            adapter().create({
                values: {...validValues, addressPrefix: '10.0.0.0/16', subnetName: 'web', subnetPrefix: '10.1.0.0/24'},
            }),
        ).rejects.toThrow(ValidationError)
        expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false)
    })

    test('accepts a subnet CIDR that sits inside the address space', async () => {
        runtimeStub()

        await expect(
            adapter().create({
                values: {...validValues, addressPrefix: '10.0.0.0/16', subnetName: 'web', subnetPrefix: '10.0.1.0/24'},
            }),
        ).resolves.toBeDefined()
    })

    test('enforces the Azure VNet name rules', async () => {
        // Azure requires 2-64 characters, starting with a letter or digit and
        // ending with a letter, digit or underscore. A one-character name or a
        // trailing hyphen only fails at the ARM PUT otherwise.
        runtimeStub()
        const a = adapter()

        for (const name of ['a', 'core-', 'core.', '-core', '.core']) {
            await expect(a.create({values: {...validValues, name}}), `${name} must be rejected`).rejects.toThrow(
                ValidationError,
            )
        }
        for (const name of ['ab', 'core_net', 'core-net', 'core.net', 'a1']) {
            await expect(a.create({values: {...validValues, name}}), `${name} must be accepted`).resolves.toBeDefined()
        }
    })

    test('sends the accept header and tolerates an empty ARM body', async () => {
        // Matches the azureJson/cosmosJson helpers the other Azure adapters use:
        // ARM endpoints can be Accept-sensitive, and a 204 has no body to parse.
        const calls = stubFetch((url, init) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            if (init?.method === 'DELETE') return new Response(null, {status: 204})
            return json({value: [vnet('core')]})
        })

        await expect(adapter().delete('rg-app/core')).resolves.toBeUndefined()

        const headers = calls[0]?.init?.headers as Record<string, string> | undefined
        expect(headers?.accept).toBe('application/json')
    })

    test('rejects a location the schema does not offer', async () => {
        runtimeStub()

        await expect(adapter().create({values: {...validValues, location: 'mars1'}})).rejects.toThrow(ValidationError)
    })

    test('deletes a VNet', async () => {
        const calls = runtimeStub()
        await adapter().delete('rg-app/core')

        const del = calls.find((c) => c.init?.method === 'DELETE')
        expect(del?.url).toContain('/virtualNetworks/core')
    })
})
