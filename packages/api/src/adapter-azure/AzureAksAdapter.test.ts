import {afterEach, describe, expect, test} from 'bun:test'
import {AzureAksAdapter} from './AzureAksAdapter'
import {AzureRestRuntimeClient} from '../azure'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4577'
const SUB = '00000000-0000-0000-0000-000000000001'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): AzureAksAdapter {
    return new AzureAksAdapter(new AzureRestRuntimeClient(ENDPOINT, 'devstoreaccount1'))
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

function cluster(name: string, rg = 'rg-app', provisioningState = 'Succeeded') {
    return {
        id: `/subscriptions/${SUB}/resourceGroups/${rg}/providers/Microsoft.ContainerService/managedClusters/${name}`,
        name,
        type: 'Microsoft.ContainerService/managedClusters',
        location: 'eastus',
        properties: {
            provisioningState,
            kubernetesVersion: '1.29.0',
            currentKubernetesVersion: '1.29.0',
            dnsPrefix: `${name}dns`,
            fqdn: `${name}dns.hcp.eastus.azmk8s.io`,
            enableRBAC: true,
            nodeResourceGroup: `MC_${rg}_${name}_eastus`,
            agentPoolProfiles: [
                {name: 'nodepool1', count: 2, vmSize: 'Standard_D2s_v3', osType: 'Linux', mode: 'System'},
            ],
        },
    }
}

function runtimeStub(clusters: unknown[] = [cluster('prod')]) {
    return stubFetch((url) => {
        if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
        if (url.includes('/managedClusters/')) return json(clusters[0] ?? {})
        return json({value: clusters})
    })
}

describe('AzureAksAdapter', () => {
    test('identifies itself as the Azure k8s adapter', () => {
        const a = adapter()

        expect(a.cloud).toBe('azure')
        expect(a.service).toBe('k8s')
        expect(a.schema().displayName).toBe('Azure AKS')
    })

    test('lists clusters and maps the ARM shape onto the shared columns', async () => {
        runtimeStub()
        const [resource] = await adapter().list()

        expect(resource).toMatchObject({
            // Same addressing as Azure VMs: ARM cannot reach a cluster without its
            // resource group, and the generic route passes one id.
            id: 'rg-app/prod',
            name: 'prod',
            cloud: 'azure',
            service: 'k8s',
            type: 'cluster',
            region: 'eastus',
            status: 'Succeeded',
            version: '1.29.0',
        })
        expect(resource?.metadata).toMatchObject({
            resourceGroup: 'rg-app',
            fqdn: 'proddns.hcp.eastus.azmk8s.io',
            nodeResourceGroup: 'MC_rg-app_prod_eastus',
            enableRBAC: true,
            nodeCount: 2,
        })
    })

    test('reports a failed provisioning state rather than hiding it', async () => {
        // The local runtime never actually provisions a cluster: every create
        // settles at Failed. Showing that is the whole point of the column.
        runtimeStub([cluster('broken', 'rg-app', 'Failed')])
        const [resource] = await adapter().list()

        expect(resource?.status).toBe('Failed')
    })

    test('summarises the agent pools', async () => {
        runtimeStub()
        const [resource] = await adapter().list()

        expect(resource?.metadata.agentPools).toEqual([
            {name: 'nodepool1', count: 2, vmSize: 'Standard_D2s_v3', osType: 'Linux', mode: 'System'},
        ])
    })

    test('filters the list by search term', async () => {
        runtimeStub([cluster('prod'), cluster('staging')])
        const a = adapter()

        await expect(a.list({search: 'prod'})).resolves.toHaveLength(1)
        await expect(a.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a cluster addressed by resource group and name', async () => {
        const calls = runtimeStub()
        const resource = await adapter().get('rg-app/prod')

        const call = calls.find((c) => c.url.includes('/managedClusters/prod'))
        expect(call?.url).toContain(`/resourceGroups/rg-app/providers/Microsoft.ContainerService/managedClusters/prod`)
        expect(resource?.id).toBe('rg-app/prod')
    })

    test('rejects an id that does not name a resource group', async () => {
        await expect(adapter().get('prod')).rejects.toThrow(ValidationError)
    })

    test('returns null when a cluster does not exist', async () => {
        stubFetch((url) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            return json({error: {code: 'ResourceNotFound', message: 'not found'}}, 404)
        })
        await expect(adapter().get('rg-app/nope')).resolves.toBeNull()
    })

    test('refuses create and delete because this runtime cannot provision a cluster', async () => {
        // Deliberately a runtime-specific reason, not a category-wide one: GCP's
        // GKE adapter does support create and delete, so "k8s is read-only
        // everywhere" is false. What holds here is narrower and verified — the
        // shipped floci-az config runs AKS unmocked with no Docker socket to
        // start k3s with, so a created cluster sits at provisioningState Failed
        // forever. Advertising create would be advertising a dead end.
        const a = adapter()

        await expect(a.create({values: {name: 'prod'}})).rejects.toThrow(NotSupportedError)
        await expect(a.delete('rg-app/prod')).rejects.toThrow(NotSupportedError)
    })

    test('sends the accept header the other Azure adapters send', async () => {
        // azureJson and cosmosJson both set it, and some ARM endpoints are
        // Accept-sensitive; diverging here makes error handling inconsistent.
        const calls = runtimeStub()
        await adapter().list()

        const headers = calls[0]?.init?.headers as Record<string, string> | undefined
        expect(headers?.accept).toBe('application/json')
    })

    test('treats an empty ARM response as no cluster rather than a parse error', async () => {
        stubFetch((url) => {
            if (url.endsWith('/subscriptions')) return json({value: [{subscriptionId: SUB}]})
            return new Response(null, {status: 204})
        })

        await expect(adapter().get('rg-app/prod')).resolves.toBeNull()
    })

    test('advertises only list and inspect', () => {
        expect(adapter().schema().actions).toEqual(['list', 'inspect'])
    })
})
