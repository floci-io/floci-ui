import {afterEach, describe, expect, test} from 'bun:test'
import {AzureComputeAdapter} from './AzureComputeAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureComputeAdapter {
    return new AzureComputeAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
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

function vm(name: string, rg = 'rg-app', overrides: Record<string, unknown> = {}) {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${name}`,
        name,
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus',
        properties: {
            hardwareProfile: {vmSize: 'Standard_B1s'},
            storageProfile: {
                imageReference: {publisher: 'Canonical', offer: 'UbuntuServer', sku: '20.04-LTS', version: 'latest'},
            },
            osProfile: {computerName: name, adminUsername: 'azureuser'},
            vmId: '4190719c-60b8-4a37-9346-6bf7be1730e0',
            provisioningState: 'Succeeded',
            timeCreated: '2026-07-28T09:37:46.091123168Z',
            ...overrides,
        },
    }
}

function instanceView(power = 'PowerState/running') {
    return {
        computerName: 'vm',
        osName: 'Linux',
        statuses: [
            {code: 'ProvisioningState/succeeded', displayStatus: 'Provisioning succeeded', level: 'Info'},
            {code: power, displayStatus: 'VM running', level: 'Info'},
        ],
    }
}

/** Routes each request to what the runtime actually answers for it. */
function runtimeStub(vms: unknown[] = [vm('web')], power = 'PowerState/running') {
    return stubFetch((url) => {
        if (url.includes('/subscriptions') && url.endsWith('/subscriptions')) {
            return json({value: [{subscriptionId: SUB, displayName: 'floci-az local', state: 'Enabled'}]})
        }
        if (url.includes('/instanceView')) return json(instanceView(power))
        if (url.includes('/virtualMachines/')) return json(vms[0] ?? {})
        if (url.includes('/resourceGroups') && !url.includes('/providers')) {
            return json({value: [{name: 'rg-app', id: `/subscriptions/${SUB}/resourceGroups/rg-app`}]})
        }
        return json({value: vms})
    })
}

describe('AzureComputeAdapter', () => {
    test('identifies itself as the Azure compute adapter', () => {
        const a = adapter()

        expect(a.cloud).toBe('azure')
        expect(a.service).toBe('compute')
        expect(a.schema().displayName).toBe('Azure Virtual Machines')
    })

    test('lists VMs and maps the ARM resource shape', async () => {
        runtimeStub()
        const [resource] = await adapter().list()

        expect(resource).toMatchObject({
            // The id carries the resource group, because ARM cannot address a VM
            // without it and the generic route only passes one id.
            id: 'rg-app/web',
            name: 'web',
            cloud: 'azure',
            service: 'compute',
            type: 'instance',
            region: 'eastus',
            instanceClass: 'Standard_B1s',
            createdAt: '2026-07-28T09:37:46.091123168Z',
        })
        expect(resource?.metadata).toMatchObject({
            resourceGroup: 'rg-app',
            provisioningState: 'Succeeded',
            adminUsername: 'azureuser',
            image: 'Canonical:UbuntuServer:20.04-LTS',
        })
    })

    test('reports the power state from the instance view', async () => {
        runtimeStub([vm('web')], 'PowerState/stopped')
        const [resource] = await adapter().list()

        expect(resource?.status).toBe('stopped')
    })

    test('still lists VMs when the instance view fails', async () => {
        // Power state is enrichment fanned out per VM. An unisolated failure would
        // reject the whole list and show nothing.
        stubFetch((url) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            if (url.includes('/instanceView')) return json({error: {message: 'boom'}}, 500)
            return json({value: [vm('web')]})
        })
        const [resource] = await adapter().list()

        expect(resource?.id).toBe('rg-app/web')
        expect(resource?.status).toBeNull()
        expect(resource?.metadata.powerStateUnavailable).toBe(true)
    })

    test('filters the list by search term', async () => {
        runtimeStub([vm('web'), vm('api')])
        const a = adapter()

        await expect(a.list({search: 'we'})).resolves.toHaveLength(1)
        await expect(a.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a VM addressed by resource group and name', async () => {
        const calls = runtimeStub()
        const resource = await adapter().get('rg-app/web')

        const vmCall = calls.find((c) => c.url.includes('/virtualMachines/web'))
        expect(vmCall?.url).toContain(`/subscriptions/${SUB}/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/web`)
        expect(resource?.id).toBe('rg-app/web')
    })

    test('rejects an id that does not name a resource group', async () => {
        await expect(adapter().get('web')).rejects.toThrow(ValidationError)
    })

    test('returns null when a VM does not exist', async () => {
        stubFetch((url) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            return json({error: {message: 'not found', code: 'ResourceNotFound'}}, 404)
        })
        await expect(adapter().get('rg-app/nope')).resolves.toBeNull()
    })

    test('creates a VM with the image reference the label maps to', async () => {
        const calls = runtimeStub()
        await adapter().create({
            values: {name: 'web', resourceGroup: 'rg-app', vmSize: 'Standard_B1s', image: 'Ubuntu 22.04 LTS'},
        })

        const put = calls.find((c) => c.init?.method === 'PUT')
        expect(put?.url).toContain('/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/web')
        const body = JSON.parse(String(put?.init?.body))
        expect(body.location).toBe('eastus')
        expect(body.properties.hardwareProfile.vmSize).toBe('Standard_B1s')
        expect(body.properties.storageProfile.imageReference).toEqual({
            publisher: 'Canonical',
            offer: '0001-com-ubuntu-server-jammy',
            sku: '22_04-lts',
            version: 'latest',
        })
        expect(body.properties.osProfile.adminUsername).toBe('azureuser')
    })

    test('verifies the resource group exists, because the runtime does not', async () => {
        // The local runtime happily creates a VM in a resource group that does not
        // exist and returns 201. Real Azure answers ResourceGroupNotFound, so the
        // check belongs here or the console would create unreachable resources.
        stubFetch((url) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            if (url.includes('/resourceGroups') && !url.includes('/providers')) return json({value: []})
            return json(vm('web'))
        })

        await expect(
            adapter().create({
                values: {name: 'web', resourceGroup: 'rg-missing', vmSize: 'Standard_B1s', image: 'Debian 11'},
            }),
        ).rejects.toThrow(ValidationError)
    })

    test('accepts a resource group whose case differs from the runtime', async () => {
        // Azure treats resource group names as case-insensitive, so rejecting
        // "RG-App" when "rg-app" exists would block a create that should succeed.
        const calls = runtimeStub()
        await adapter().create({
            values: {name: 'web', resourceGroup: 'RG-App', vmSize: 'Standard_B1s', image: 'Debian 11'},
        })

        expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true)
    })

    test("uses the runtime's spelling of the resource group, not the caller's", async () => {
        // The id is `resourceGroup/name`, so echoing the caller's casing would emit
        // an id that does not match what list() returns and inspect would 404.
        const calls = runtimeStub()
        const resource = await adapter().create({
            values: {name: 'web', resourceGroup: 'RG-App', vmSize: 'Standard_B1s', image: 'Debian 11'},
        })

        const put = calls.find((c) => c.init?.method === 'PUT')
        expect(put?.url).toContain('/resourceGroups/rg-app/')
        expect(put?.url).not.toContain('RG-App')
        expect(resource.id).toBe('rg-app/web')
    })

    test('requires the fields the schema marks required', async () => {
        runtimeStub()
        const a = adapter()

        const cases: Array<[Record<string, unknown>, string]> = [
            [{}, 'name is required'],
            [{name: 'web'}, 'resourceGroup is required'],
            [{name: 'web', resourceGroup: 'rg-app'}, 'vmSize is required'],
            [{name: 'web', resourceGroup: 'rg-app', vmSize: 'Standard_B1s'}, 'image is required'],
        ]

        for (const [values, message] of cases) {
            await expect(a.create({values})).rejects.toThrow(new ValidationError(message))
        }
    })

    test('rejects values the schema does not offer', async () => {
        runtimeStub()
        const a = adapter()
        const base = {name: 'web', resourceGroup: 'rg-app', vmSize: 'Standard_B1s', image: 'Debian 11'}

        await expect(a.create({values: {...base, vmSize: 'Standard_MEGA'}})).rejects.toThrow(ValidationError)
        await expect(a.create({values: {...base, image: 'TempleOS'}})).rejects.toThrow(ValidationError)
        await expect(a.create({values: {...base, location: 'mars1'}})).rejects.toThrow(ValidationError)
        await expect(a.create({values: {...base, name: 'bad name!'}})).rejects.toThrow(ValidationError)
    })

    test('deletes a VM', async () => {
        const calls = runtimeStub()
        await adapter().delete('rg-app/web')

        const del = calls.find((c) => c.init?.method === 'DELETE')
        expect(del?.url).toContain('/virtualMachines/web')
    })

    describe('lifecycle verbs map to the ARM actions', () => {
        const cases: Array<['start' | 'stop' | 'reboot', string]> = [
            ['start', '/start'],
            ['stop', '/powerOff'],
            ['reboot', '/restart'],
        ]

        for (const [verb, suffix] of cases) {
            test(`${verb} posts to ${suffix}`, async () => {
                const calls = runtimeStub()
                await adapter()[verb]('rg-app/web')

                const post = calls.find((c) => c.init?.method === 'POST')
                expect(post?.url).toContain(`/virtualMachines/web${suffix}`)
            })
        }
    })
})
