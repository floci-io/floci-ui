import {afterEach, describe, expect, test} from 'bun:test'
import {OciOkeAdapter} from './OciOkeAdapter'
import {OciRestRuntimeClient} from '../oci'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'

const originalFetch = globalThis.fetch
const ENDPOINT = 'http://localhost:4599'
const TENANCY = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const API = `${ENDPOINT}/20180222`
const CLUSTER_ID = 'ocid1.cluster.oc1.iad.abc'
const POOL_ID = 'ocid1.nodepool.oc1.iad.def'
const VCN_ID = 'ocid1.vcn.oc1.iad.demo'
const WORK_REQUEST_ID = 'ocid1.coreservicesworkrequest.oc1..wr1'

afterEach(() => {
    globalThis.fetch = originalFetch
})

function adapter(): OciOkeAdapter {
    return new OciOkeAdapter(new OciRestRuntimeClient(ENDPOINT, TENANCY, 'us-ashburn-1', 'floci-local'))
}

type Call = {url: string; method: string; body: unknown}

function stubFetch(handler: (url: string, method: string) => Response) {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push({url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined})
        return handler(String(url), method)
    }) as unknown as typeof fetch
    return calls
}

function json(body: unknown, init: ResponseInit = {status: 200}): Response {
    return new Response(JSON.stringify(body), init)
}

function accepted(body: unknown = null): Response {
    return new Response(body === null ? null : JSON.stringify(body), {
        status: 202,
        headers: {'opc-work-request-id': WORK_REQUEST_ID},
    })
}

const cluster = {
    id: CLUSTER_ID,
    name: 'demo',
    compartmentId: TENANCY,
    vcnId: VCN_ID,
    kubernetesVersion: 'v1.30.1',
    lifecycleState: 'ACTIVE',
    endpoints: {kubernetes: 'https://127.0.0.1:6443'},
    metadata: {timeCreated: '2026-09-29T00:00:00Z'},
}

const pool = {
    id: POOL_ID,
    name: 'pool1',
    compartmentId: TENANCY,
    clusterId: CLUSTER_ID,
    kubernetesVersion: 'v1.30.1',
    nodeShape: 'VM.Standard.E4.Flex',
    quantityPerSubnet: 2,
    lifecycleState: 'ACTIVE',
    freeformTags: {team: 'core'},
}

const clusterOptions = {kubernetesVersions: ['v1.30.1', 'v1.29.1', 'v1.28.2']}
const nodePoolOptions = {shapes: ['VM.Standard.E4.Flex', 'VM.Standard2.1'], kubernetesVersions: ['v1.30.1']}

function workRequest(entityType: string, identifier: string) {
    return {status: 'SUCCEEDED', resources: [{entityType, actionType: 'CREATED', identifier}]}
}

describe('OciOkeAdapter', () => {
    test('identifies itself as the OCI k8s adapter', () => {
        const instance = adapter()
        expect(instance.cloud).toBe('oci')
        expect(instance.service).toBe('k8s')
        expect(instance.schema().displayName).toBe('OCI Container Engine (OKE)')
    })

    test('lists clusters in the tenancy root compartment and maps the wire shape', async () => {
        const calls = stubFetch(() => json([cluster]))
        const [resource] = await adapter().list()

        expect(calls[0]?.url).toBe(`${API}/clusters?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(resource).toMatchObject({
            id: CLUSTER_ID,
            name: 'demo',
            cloud: 'oci',
            service: 'k8s',
            type: 'cluster',
            region: 'us-ashburn-1',
            createdAt: '2026-09-29T00:00:00Z',
            status: 'ACTIVE',
            version: 'v1.30.1',
        })
        expect(resource?.metadata).toMatchObject({
            provider: 'oci',
            k8sService: 'oke',
            vcnId: VCN_ID,
            endpoint: 'https://127.0.0.1:6443',
            compartmentId: TENANCY,
        })
    })

    test('hides DELETED clusters but keeps other lifecycle states', async () => {
        stubFetch(() => json([
            cluster,
            {...cluster, id: 'c2', name: 'gone', lifecycleState: 'DELETED'},
            {...cluster, id: 'c3', name: 'booting', lifecycleState: 'CREATING'},
        ]))
        const resources = await adapter().list()
        expect(resources.map((resource) => [resource.name, resource.status])).toEqual([
            ['demo', 'ACTIVE'],
            ['booting', 'CREATING'],
        ])
    })

    test('follows opc-next-page when listing clusters', async () => {
        const calls = stubFetch((url) => url.includes('page=p2')
            ? json([{...cluster, id: 'c2', name: 'second'}])
            : new Response(JSON.stringify([cluster]), {status: 200, headers: {'opc-next-page': 'p2'}}))
        const resources = await adapter().list()
        expect(resources.map((resource) => resource.name)).toEqual(['demo', 'second'])
        expect(calls[1]?.url).toContain('&page=p2')
    })

    test('filters the list by search term', async () => {
        stubFetch(() => json([cluster, {...cluster, id: 'c2', name: 'other'}]))
        const resources = await adapter().list({search: 'DEM'})
        expect(resources.map((resource) => resource.name)).toEqual(['demo'])
    })

    test('gets a cluster by OCID and returns null when missing', async () => {
        const calls = stubFetch((url) => url.endsWith('missing')
            ? json({code: 'NotAuthorizedOrNotFound', message: 'Cluster not found'}, {status: 404})
            : json(cluster))
        expect((await adapter().get(CLUSTER_ID))?.name).toBe('demo')
        expect(calls[0]?.url).toBe(`${API}/clusters/${encodeURIComponent(CLUSTER_ID)}`)
        expect(await adapter().get('missing')).toBeNull()
    })

    test('creates a cluster, resolving its OCID through the work request', async () => {
        const calls = stubFetch((url, method) => {
            if (url.includes('/clusterOptions/all')) return json(clusterOptions)
            if (method === 'POST') return accepted()
            if (url.includes('/workRequests/')) return json(workRequest('cluster', CLUSTER_ID))
            return json({...cluster, lifecycleState: 'CREATING'})
        })
        const resource = await adapter().create({values: {clusterName: ' demo ', vcnId: VCN_ID, kubernetesVersion: 'v1.29.1'}})

        expect(calls[0]?.url).toBe(`${API}/clusterOptions/all?compartmentId=${encodeURIComponent(TENANCY)}`)
        expect(calls[1]).toMatchObject({
            url: `${API}/clusters`,
            method: 'POST',
            body: {compartmentId: TENANCY, name: 'demo', vcnId: VCN_ID, kubernetesVersion: 'v1.29.1'},
        })
        expect(calls[2]?.url).toBe(`${API}/workRequests/${encodeURIComponent(WORK_REQUEST_ID)}`)
        expect(calls[3]?.url).toBe(`${API}/clusters/${encodeURIComponent(CLUSTER_ID)}`)
        expect(resource.status).toBe('CREATING')
    })

    test('falls back to the echoed body when there is no work request id', async () => {
        const calls = stubFetch((url, method) => {
            if (url.includes('/clusterOptions/all')) return json(clusterOptions)
            if (method === 'POST') return json(cluster, {status: 202})
            return json(cluster)
        })
        const resource = await adapter().create({values: {clusterName: 'demo', vcnId: VCN_ID, kubernetesVersion: 'v1.30.1'}})
        expect(resource.id).toBe(CLUSTER_ID)
        expect(calls.some((call) => call.url.includes('/workRequests/'))).toBe(false)
    })

    test('reports a runtime error when the created OCID cannot be resolved', async () => {
        stubFetch((url, method) => {
            if (url.includes('/clusterOptions/all')) return json(clusterOptions)
            if (method === 'POST') return new Response(null, {status: 202})
            return json(cluster)
        })
        await expect(adapter().create({values: {clusterName: 'demo', vcnId: VCN_ID, kubernetesVersion: 'v1.30.1'}}))
            .rejects.toBeInstanceOf(RuntimeError)
    })

    test('reports a failed work request instead of a created cluster', async () => {
        stubFetch((url, method) => {
            if (url.includes('/clusterOptions/all')) return json(clusterOptions)
            if (method === 'POST') return accepted()
            if (url.includes('/workRequests/')) return json({...workRequest('cluster', CLUSTER_ID), status: 'FAILED'})
            return json(cluster)
        })
        await expect(adapter().create({values: {clusterName: 'demo', vcnId: VCN_ID, kubernetesVersion: 'v1.30.1'}}))
            .rejects.toThrow(/FAILED/)
    })

    test('reports an accepted cluster that cannot be read yet as CREATING', async () => {
        stubFetch((url, method) => {
            if (url.includes('/clusterOptions/all')) return json(clusterOptions)
            if (method === 'POST') return accepted()
            if (url.includes('/workRequests/')) return json(workRequest('cluster', CLUSTER_ID))
            return new Response(null, {status: 404})
        })
        const resource = await adapter().create({values: {clusterName: 'demo', vcnId: VCN_ID, kubernetesVersion: 'v1.30.1'}})
        expect(resource).toMatchObject({id: CLUSTER_ID, name: 'demo', status: 'CREATING'})
    })

    test('validates create input before calling the runtime', async () => {
        const calls = stubFetch(() => json(clusterOptions))
        const instance = adapter()
        await expect(instance.create({values: {vcnId: VCN_ID, kubernetesVersion: 'v1.30.1'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(instance.create({values: {clusterName: 'demo', kubernetesVersion: 'v1.30.1'}})).rejects.toThrow('vcnId is required')
        await expect(instance.create({values: {clusterName: 'demo', vcnId: 'vcn-1', kubernetesVersion: 'v1.30.1'}})).rejects.toThrow('ocid1.vcn.')
        await expect(instance.create({values: {clusterName: 'demo', vcnId: VCN_ID}})).rejects.toThrow('kubernetesVersion is required')
        await expect(instance.create({values: {clusterName: 'x'.repeat(256), vcnId: VCN_ID, kubernetesVersion: 'v1.30.1'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toHaveLength(0)
    })

    test('rejects a Kubernetes version missing from the cluster options', async () => {
        const calls = stubFetch(() => json(clusterOptions))
        await expect(adapter().create({values: {clusterName: 'demo', vcnId: VCN_ID, kubernetesVersion: 'v1.99.0'}}))
            .rejects.toThrow('Available: v1.30.1, v1.29.1, v1.28.2')
        expect(calls.every((call) => call.method === 'GET')).toBe(true)
    })

    test('maps a runtime 400 to a validation error', async () => {
        stubFetch((url, method) => {
            if (url.includes('/clusterOptions/all')) return json(clusterOptions)
            if (method === 'POST') return json({code: 'MissingParameter', message: 'Missing required parameter: vcnId'}, {status: 400})
            return json(cluster)
        })
        await expect(adapter().create({values: {clusterName: 'demo', vcnId: VCN_ID, kubernetesVersion: 'v1.30.1'}}))
            .rejects.toBeInstanceOf(ValidationError)
    })

    test('updates the name and version, then reads the cluster back', async () => {
        const calls = stubFetch((url, method) => {
            if (url.includes('/clusterOptions/all')) return json(clusterOptions)
            if (method === 'PUT') return accepted()
            return json({...cluster, name: 'renamed', kubernetesVersion: 'v1.29.1'})
        })
        const resource = await adapter().update(CLUSTER_ID, {values: {name: 'renamed', kubernetesVersion: 'v1.29.1'}})

        const put = calls.find((call) => call.method === 'PUT')
        expect(put).toMatchObject({
            url: `${API}/clusters/${encodeURIComponent(CLUSTER_ID)}`,
            body: {name: 'renamed', kubernetesVersion: 'v1.29.1'},
        })
        expect(resource).toMatchObject({name: 'renamed', version: 'v1.29.1'})
    })

    test('rejects an empty update and an unknown version', async () => {
        const calls = stubFetch(() => json(clusterOptions))
        await expect(adapter().update(CLUSTER_ID, {values: {}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter().update(CLUSTER_ID, {values: {kubernetesVersion: 'v2.0.0'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    })

    test('deletes a cluster and tolerates one that is already gone', async () => {
        const calls = stubFetch(() => new Response(null, {status: 404}))
        await adapter().delete(CLUSTER_ID)
        expect(calls[0]).toMatchObject({url: `${API}/clusters/${encodeURIComponent(CLUSTER_ID)}`, method: 'DELETE'})
    })

    test('lists node pools for one cluster and hides DELETED ones', async () => {
        const calls = stubFetch(() => json([pool, {...pool, id: 'p2', lifecycleState: 'DELETED'}]))
        const nodegroups = await adapter().listKubernetesNodegroups(CLUSTER_ID)

        const qs = new URLSearchParams({compartmentId: TENANCY, clusterId: CLUSTER_ID})
        expect(calls[0]?.url).toBe(`${API}/nodePools?${qs}`)
        expect(nodegroups).toEqual([{
            id: POOL_ID,
            name: 'pool1',
            clusterId: CLUSTER_ID,
            arn: null,
            status: 'ACTIVE',
            version: 'v1.30.1',
            releaseVersion: null,
            createdAt: null,
            modifiedAt: null,
            capacityType: null,
            instanceTypes: ['VM.Standard.E4.Flex'],
            subnets: [],
            nodeRole: null,
            scalingConfig: {desiredSize: 2},
            labels: {},
            tags: {team: 'core'},
        }])
    })

    test('creates a node pool with the cluster version and the chosen shape', async () => {
        const calls = stubFetch((url, method) => {
            if (url.includes('/nodePoolOptions/')) return json(nodePoolOptions)
            if (method === 'POST') return accepted()
            if (url.includes('/workRequests/')) return json(workRequest('nodepool', POOL_ID))
            if (url.includes('/nodePools/')) return json({...pool, initialNodeLabels: [{key: 'role', value: 'web'}]})
            return json(cluster)
        })
        const nodegroup = await adapter().createKubernetesNodegroup(CLUSTER_ID, {
            name: 'pool1',
            nodeRole: '',
            subnets: ['ocid1.subnet.oc1.iad.s1'],
            instanceTypes: ['VM.Standard.E4.Flex'],
            scalingConfig: {desiredSize: 2},
            labels: {role: 'web'},
            tags: {team: 'core'},
        })

        expect(calls.find((call) => call.method === 'POST')).toMatchObject({
            url: `${API}/nodePools`,
            body: {
                compartmentId: TENANCY,
                clusterId: CLUSTER_ID,
                name: 'pool1',
                kubernetesVersion: 'v1.30.1',
                nodeShape: 'VM.Standard.E4.Flex',
                quantityPerSubnet: 2,
                subnetIds: ['ocid1.subnet.oc1.iad.s1'],
                initialNodeLabels: [{key: 'role', value: 'web'}],
                freeformTags: {team: 'core'},
            },
        })
        expect(calls.some((call) => call.url === `${API}/nodePoolOptions/${encodeURIComponent(CLUSTER_ID)}`)).toBe(true)
        expect(nodegroup).toMatchObject({id: POOL_ID, labels: {role: 'web'}, instanceTypes: ['VM.Standard.E4.Flex']})
    })

    test('validates node pool input', async () => {
        stubFetch((url) => url.includes('/nodePoolOptions/') ? json(nodePoolOptions) : json(cluster))
        const instance = adapter()
        await expect(instance.createKubernetesNodegroup(CLUSTER_ID, {name: '', nodeRole: '', subnets: []}))
            .rejects.toThrow('Node pool name is required')
        await expect(instance.createKubernetesNodegroup(CLUSTER_ID, {name: 'p', nodeRole: '', subnets: []}))
            .rejects.toThrow('node shape is required')
        await expect(instance.createKubernetesNodegroup(CLUSTER_ID, {name: 'p', nodeRole: '', subnets: [], instanceTypes: ['BM.Unknown']}))
            .rejects.toThrow('Unsupported node shape')
        await expect(instance.createKubernetesNodegroup(CLUSTER_ID, {name: 'p', nodeRole: '', subnets: [], instanceTypes: ['VM.Standard2.1'], scalingConfig: {desiredSize: 0}}))
            .rejects.toBeInstanceOf(ValidationError)
    })

    test('splits the desired size across subnets and reports the pool total', async () => {
        const subnets = ['ocid1.subnet.oc1.iad.s1', 'ocid1.subnet.oc1.iad.s2']
        const calls = stubFetch((url, method) => {
            if (url.includes('/nodePoolOptions/')) return json(nodePoolOptions)
            if (method === 'POST') return accepted()
            if (url.includes('/workRequests/')) return json(workRequest('nodepool', POOL_ID))
            if (url.includes('/nodePools/')) return json({...pool, quantityPerSubnet: 2, subnetIds: subnets})
            return json(cluster)
        })
        const nodegroup = await adapter().createKubernetesNodegroup(CLUSTER_ID, {
            name: 'pool1', nodeRole: '', subnets, instanceTypes: ['VM.Standard.E4.Flex'], scalingConfig: {desiredSize: 4},
        })

        expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({quantityPerSubnet: 2, subnetIds: subnets})
        expect(nodegroup.scalingConfig).toEqual({desiredSize: 4})
    })

    test('requires a subnet and a size that splits evenly across subnets', async () => {
        const calls = stubFetch((url) => url.includes('/nodePoolOptions/') ? json(nodePoolOptions) : json(cluster))
        const instance = adapter()
        await expect(instance.createKubernetesNodegroup(CLUSTER_ID, {name: 'p', nodeRole: '', subnets: [' '], instanceTypes: ['VM.Standard2.1']}))
            .rejects.toThrow('At least one subnet')
        await expect(instance.createKubernetesNodegroup(CLUSTER_ID, {
            name: 'p', nodeRole: '', subnets: ['ocid1.subnet.oc1.iad.s1', 'ocid1.subnet.oc1.iad.s2'], instanceTypes: ['VM.Standard2.1'], scalingConfig: {desiredSize: 3},
        })).rejects.toThrow('split evenly')
        expect(calls.some((call) => call.method === 'POST')).toBe(false)
    })

    test('rejects a node pool for a missing cluster', async () => {
        stubFetch(() => new Response(null, {status: 404}))
        await expect(adapter().createKubernetesNodegroup('missing', {name: 'p', nodeRole: '', subnets: [], instanceTypes: ['VM.Standard2.1']}))
            .rejects.toBeInstanceOf(NotFoundError)
    })

    test('deletes a node pool that belongs to the cluster', async () => {
        const calls = stubFetch((_url, method) => method === 'DELETE' ? accepted() : json(pool))
        await adapter().deleteKubernetesNodegroup(CLUSTER_ID, POOL_ID)
        expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE'])
        expect(calls[1]?.url).toBe(`${API}/nodePools/${encodeURIComponent(POOL_ID)}`)
    })

    test('refuses to delete a node pool from another cluster and ignores a missing one', async () => {
        let calls = stubFetch(() => json({...pool, clusterId: 'ocid1.cluster.oc1.iad.other'}))
        await expect(adapter().deleteKubernetesNodegroup(CLUSTER_ID, POOL_ID)).rejects.toBeInstanceOf(NotFoundError)
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

        calls = stubFetch(() => new Response(null, {status: 404}))
        await adapter().deleteKubernetesNodegroup(CLUSTER_ID, POOL_ID)
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    })
})
