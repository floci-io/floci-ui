import {afterEach, describe, expect, test} from 'bun:test'
import {AzureContainerAppsAdapter} from './AzureContainerAppsAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {ConflictError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'
const ENV_ID = `/subscriptions/${SUB}/resourceGroups/rg-apps/providers/Microsoft.App/managedEnvironments/local`

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureContainerAppsAdapter {
    return new AzureContainerAppsAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
}

interface Call {
    method: string
    url: string
    body?: unknown
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status})
}

function environment(name = 'local') {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/rg-apps/providers/Microsoft.App/managedEnvironments/${name}`,
        name,
        type: 'Microsoft.App/managedEnvironments',
        location: 'eastus',
        properties: {provisioningState: 'Succeeded', defaultDomain: `${name}.azurecontainerapps.io`, staticIp: '127.0.0.1'},
    }
}

function app(name = 'hello', overrides: Record<string, unknown> = {}) {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/rg-apps/providers/Microsoft.App/containerApps/${name}`,
        name,
        type: 'Microsoft.App/containerApps',
        location: 'eastus',
        properties: {
            environmentId: ENV_ID,
            provisioningState: 'Succeeded',
            runningStatus: 'Running',
            latestRevisionName: `${name}--000001`,
            configuration: {
                activeRevisionsMode: 'Single',
                // The runtime strips `value`; the second entry proves the adapter does too.
                secrets: [{name: 'token'}, {name: 'leaky', value: 'hunter2'}],
                ingress: {external: true, targetPort: 80, fqdn: `${name}.local.azurecontainerapps.io`},
            },
            template: {
                containers: [
                    {
                        name: 'web',
                        image: 'nginx:alpine',
                        env: [
                            {name: 'TOKEN', secretRef: 'token'},
                            {name: 'PLAIN', value: 'visible-in-arm-only'},
                        ],
                    },
                ],
                scale: {minReplicas: 1, maxReplicas: 3},
            },
            ...overrides,
        },
    }
}

function revision(name = 'hello--000001') {
    return {
        id: `${app().id}/revisions/${name}`,
        name,
        properties: {
            active: true,
            createdTime: '2026-10-17T20:34:46.433Z',
            fqdn: `${name}.local.azurecontainerapps.io`,
            healthState: 'Healthy',
            provisioningState: 'Provisioned',
            runningState: 'Running',
            replicas: 1,
            trafficWeight: 100,
            template: {containers: [{name: 'web', image: 'nginx:alpine'}]},
        },
    }
}

/** Routes each request to what the runtime answers for it, recording what was sent. */
function runtimeStub(options: {environments?: unknown[]; apps?: unknown[]; groups?: string[]} = {}) {
    const calls: Call[] = []
    const environments = options.environments ?? [environment()]
    const apps = options.apps ?? [app()]
    const groups = options.groups ?? ['rg-apps']

    globalThis.fetch = (async (input: string, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        calls.push({method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined})
        const path = url.replace(ENDPOINT, '')

        if (path === '/subscriptions') return json({value: [{subscriptionId: SUB}]})
        if (path.includes('/resourceGroups?')) return json({value: groups.map((name) => ({name}))})
        if (method === 'PUT') return json({}, 201)
        if (method === 'DELETE') return new Response(null, {status: 204})
        if (path.includes('/providers/Microsoft.App/managedEnvironments?')) return json({value: environments})
        if (path.includes('/providers/Microsoft.App/containerApps?')) return json({value: apps})
        if (path.includes('/revisions?')) return json({value: [revision()]})
        if (path.includes('/managedEnvironments/')) {
            const found = environments.find((item) => path.includes(`/managedEnvironments/${(item as {name: string}).name}?`))
            return found ? json(found) : json({error: {code: 'ResourceNotFound'}}, 404)
        }
        if (path.includes('/containerApps/')) {
            const found = apps.find((item) => path.includes(`/containerApps/${(item as {name: string}).name}?`))
            return found ? json(found) : json({error: {code: 'ResourceNotFound'}}, 404)
        }
        return json({}, 404)
    }) as unknown as typeof fetch
    return calls
}

describe('AzureContainerAppsAdapter list and get', () => {
    test('lists environments and apps with kind-prefixed ids', async () => {
        runtimeStub()
        const resources = await adapter().list()

        expect(resources.map((resource) => [resource.id, resource.type])).toEqual([
            ['managedEnvironments/rg-apps/local', 'managed-environment'],
            ['containerApps/rg-apps/hello', 'container-app'],
        ])
        expect(resources[1].metadata.image).toBe('nginx:alpine')
        expect(resources[1].metadata.environmentName).toBe('local')
    })

    test('lists nothing when the runtime has no resources', async () => {
        runtimeStub({environments: [], apps: []})
        expect(await adapter().list()).toEqual([])
    })

    test('filters by search on the name', async () => {
        runtimeStub({apps: [app('hello'), app('worker')]})
        const resources = await adapter().list({search: 'WORK'})
        expect(resources.map((resource) => resource.name)).toEqual(['worker'])
    })

    test('inspecting an app includes its revisions', async () => {
        runtimeStub()
        const resource = await adapter().get('containerApps/rg-apps/hello')

        expect(resource?.metadata.revisions).toEqual([
            {
                name: 'hello--000001',
                active: true,
                createdAt: '2026-10-17T20:34:46.433Z',
                lastActiveAt: null,
                provisioningState: 'Provisioned',
                runningState: 'Running',
                healthState: 'Healthy',
                replicas: 1,
                trafficWeight: 100,
                fqdn: 'hello--000001.local.azurecontainerapps.io',
                images: ['nginx:alpine'],
            },
        ])
        expect(resource?.metadata.ingress).toEqual({
            external: true,
            targetPort: 80,
            fqdn: 'hello.local.azurecontainerapps.io',
        })
    })

    test('never returns a secret value or a plain env value from list or inspect', async () => {
        runtimeStub()
        const listed = JSON.stringify(await adapter().list())
        const inspected = JSON.stringify(await adapter().get('containerApps/rg-apps/hello'))

        for (const text of [listed, inspected]) {
            expect(text).not.toContain('hunter2')
            expect(text).not.toContain('visible-in-arm-only')
        }
        const resource = await adapter().get('containerApps/rg-apps/hello')
        expect(resource?.metadata.secretNames).toEqual(['token', 'leaky'])
    })

    test('never asks the runtime for the secret values', async () => {
        const calls = runtimeStub()
        await adapter().list()
        await adapter().get('containerApps/rg-apps/hello')
        expect(calls.some((call) => call.url.includes('listSecrets'))).toBe(false)
    })

    test('returns null for a missing app', async () => {
        runtimeStub()
        expect(await adapter().get('containerApps/rg-apps/ghost')).toBeNull()
    })

    test('rejects an id without a kind', async () => {
        runtimeStub()
        await expect(adapter().get('rg-apps/hello')).rejects.toBeInstanceOf(ValidationError)
    })
})

describe('AzureContainerAppsAdapter create', () => {
    test('creates a managed environment', async () => {
        const calls = runtimeStub()
        await adapter().create({values: {resourceType: 'managedEnvironment', name: 'local', resourceGroup: 'RG-APPS'}})

        const put = calls.find((call) => call.method === 'PUT')
        expect(put?.url).toContain('/resourceGroups/rg-apps/providers/Microsoft.App/managedEnvironments/local?api-version=')
        expect(put?.body).toEqual({location: 'eastus', properties: {}})
    })

    test('creates an app with an image and external ingress', async () => {
        const calls = runtimeStub()
        await adapter().create({
            values: {
                resourceType: 'containerApp',
                name: 'hello',
                resourceGroup: 'rg-apps',
                environment: 'local',
                image: 'nginx:alpine',
                ingress: 'external',
                targetPort: '8080',
            },
        })

        const put = calls.find((call) => call.method === 'PUT')
        expect(put?.url).toContain('/providers/Microsoft.App/containerApps/hello?api-version=')
        expect(put?.body).toEqual({
            location: 'eastus',
            properties: {
                environmentId: ENV_ID,
                configuration: {ingress: {external: true, targetPort: 8080}},
                template: {containers: [{name: 'hello', image: 'nginx:alpine'}]},
            },
        })
    })

    test('internal ingress defaults the port to 80 and none sends no ingress block', async () => {
        const internal = runtimeStub()
        await adapter().create({
            values: {resourceType: 'containerApp', name: 'hello', resourceGroup: 'rg-apps', environment: 'local', image: 'x', ingress: 'internal'},
        })
        expect(internal.find((call) => call.method === 'PUT')?.body).toMatchObject({
            properties: {configuration: {ingress: {external: false, targetPort: 80}}},
        })

        const none = runtimeStub()
        await adapter().create({
            values: {resourceType: 'containerApp', name: 'hello', resourceGroup: 'rg-apps', environment: 'local', image: 'x', ingress: 'none'},
        })
        expect(none.find((call) => call.method === 'PUT')?.body).toMatchObject({properties: {configuration: {}}})
    })

    test.each([
        ['a missing image', {image: ''}],
        ['a missing environment', {environment: ''}],
        ['an invalid name', {name: 'Hello_App'}],
        ['an out of range port', {ingress: 'external', targetPort: '70000'}],
        ['an unknown ingress mode', {ingress: 'public'}],
        ['an unknown resource type', {resourceType: 'job'}],
    ])('rejects %s without calling the runtime to create', async (_label, override) => {
        const calls = runtimeStub()
        const values = {
            resourceType: 'containerApp',
            name: 'hello',
            resourceGroup: 'rg-apps',
            environment: 'local',
            image: 'nginx:alpine',
            ...override,
        }
        await expect(adapter().create({values})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('rejects an app whose managed environment does not exist', async () => {
        const calls = runtimeStub({environments: []})
        await expect(
            adapter().create({
                values: {resourceType: 'containerApp', name: 'hello', resourceGroup: 'rg-apps', environment: 'nope', image: 'x'},
            }),
        ).rejects.toThrow('managed environment nope does not exist')
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('rejects a resource group that does not exist', async () => {
        const calls = runtimeStub({groups: []})
        await expect(
            adapter().create({values: {resourceType: 'managedEnvironment', name: 'local', resourceGroup: 'rg-missing'}}),
        ).rejects.toThrow('resource group rg-missing does not exist')
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })
})

describe('AzureContainerAppsAdapter delete', () => {
    test('deletes an app by kind, group and name', async () => {
        const calls = runtimeStub()
        await adapter().delete('containerApps/rg-apps/hello')
        const del = calls.find((call) => call.method === 'DELETE')
        expect(del?.url).toContain('/resourceGroups/rg-apps/providers/Microsoft.App/containerApps/hello?api-version=')
    })

    test('an environment that still holds apps surfaces as a conflict', async () => {
        globalThis.fetch = (async (input: string, init?: RequestInit) => {
            if (String(input).endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            if (init?.method === 'DELETE') {
                return json({error: {code: 'ManagedEnvironmentInUse', message: 'still contains Container Apps'}}, 409)
            }
            return json({}, 404)
        }) as unknown as typeof fetch

        await expect(adapter().delete('managedEnvironments/rg-apps/local')).rejects.toBeInstanceOf(ConflictError)
    })
})
