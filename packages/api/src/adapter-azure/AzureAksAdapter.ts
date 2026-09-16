import {azure, type AzureRuntimeClient} from '../azure'
import {NotSupportedError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {azureAksSchema} from '../cloud-spi/eksSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to the Floci-AZ runtime's ARM surface for
 * Microsoft.ContainerService/managedClusters — verified against `floci/floci-az`
 * 0.9.0:
 *
 *   list GET /subscriptions/{s}/providers/Microsoft.ContainerService/managedClusters
 *   get  GET /subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.ContainerService/managedClusters/{n}
 *
 * Read-only, and for a reason specific to this runtime rather than to the
 * category: GCP's GKE adapter does support create and delete, so "k8s is
 * read-only everywhere" is not true. What is true here is that a cluster created
 * against floci-az settles at `provisioningState: Failed` and stays there, and
 * `docker ps` shows nothing starts — unlike GKE on floci-gcp, which really
 * launches k3s. Advertising create would advertise something that cannot
 * succeed.
 *
 * `DELETE` does work on the runtime (202, and the cluster disappears), but a
 * delete-only surface in a category that cannot create is worse than none.
 */
const API_VERSION = '2023-10-01'

interface ArmList<T> {
    value?: T[]
}

interface AgentPoolProfile {
    name?: string
    count?: number
    vmSize?: string
    osType?: string
    mode?: string
}

interface AksCluster {
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
        provisioningState?: string
        kubernetesVersion?: string
        currentKubernetesVersion?: string
        dnsPrefix?: string
        fqdn?: string
        enableRBAC?: boolean
        nodeResourceGroup?: string
        agentPoolProfiles?: AgentPoolProfile[]
    }
}

export class AzureAksAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'k8s' as const

    private subscriptionId: string | null = null

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureAksSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const subscription = await this.subscription()
        const body = await this.json<ArmList<AksCluster>>(
            `/subscriptions/${subscription}/providers/Microsoft.ContainerService/managedClusters?api-version=${API_VERSION}`,
        )
        return filterBySearch((body?.value ?? []).map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {resourceGroup, name} = parseId(id)
        const subscription = await this.subscription()
        const path = `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(name)}`

        const cluster = await this.json<AksCluster>(
            `${path}?api-version=${API_VERSION}`,
            {},
            {emptyOnNotFound: true},
        )
        return cluster ? toResource(cluster) : null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('AKS cluster creation is not supported from the dynamic Cloud Explorer.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('AKS cluster deletion is not supported from the dynamic Cloud Explorer.')
    }

    /** The runtime ignores the subscription id, but a real one keeps ids honest. */
    private async subscription(): Promise<string> {
        if (this.subscriptionId) return this.subscriptionId

        const body = await this.json<ArmList<{subscriptionId?: string}>>('/subscriptions')
        const id = body?.value?.[0]?.subscriptionId
        if (!id) throw new RuntimeError('Floci-AZ returned no subscription to scope cluster requests to')

        this.subscriptionId = id
        return id
    }

    /**
     * Mirrors the `azureJson`/`cosmosJson` helpers the other Azure adapters use:
     * ARM endpoints can be Accept-sensitive, and a 204 carries no body to parse.
     *
     * Several near-identical copies of this now exist under adapter-azure/. Worth
     * lifting onto AzureRuntimeClient once the open Azure PRs have merged — doing
     * it in parallel branches would only conflict.
     */
    private async json<T>(path: string, init: RequestInit = {}, options = {}): Promise<T | null> {
        const res = await this.client.fetch(
            path,
            {
                ...init,
                headers: {
                    accept: 'application/json',
                    ...(init.headers ?? {}),
                },
            },
            options,
        )
        if (!res || res.status === 204) return null

        const text = await res.text()
        if (!text) return null
        return JSON.parse(text) as T
    }
}

function toResource(cluster: AksCluster): CloudResource {
    const properties = cluster.properties ?? {}
    const name = cluster.name ?? ''
    const resourceGroup = resourceGroupOf(cluster.id ?? '')
    const pools = properties.agentPoolProfiles ?? []

    return {
        id: resourceGroup ? `${resourceGroup}/${name}` : name,
        name,
        cloud: 'azure',
        service: 'k8s',
        type: 'cluster',
        region: cluster.location ?? null,
        // ARM does not return a creation time for a managed cluster, and inventing
        // one would be fake data.
        createdAt: null,
        status: properties.provisioningState ?? null,
        version: properties.currentKubernetesVersion ?? properties.kubernetesVersion ?? null,
        metadata: {
            provider: 'azure',
            resourceId: cluster.id,
            resourceGroup,
            dnsPrefix: properties.dnsPrefix,
            fqdn: properties.fqdn,
            enableRBAC: properties.enableRBAC,
            nodeResourceGroup: properties.nodeResourceGroup,
            agentPools: pools,
            nodeCount: pools.reduce((total, pool) => total + (pool.count ?? 0), 0),
            tags: cluster.tags,
        },
    }
}

/** ARM cannot address a cluster without its resource group, so the id carries both. */
function parseId(id: string): {resourceGroup: string; name: string} {
    const [resourceGroup, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!resourceGroup || !name) {
        throw new ValidationError(`cluster id must be "resourceGroup/name", got "${id}"`)
    }
    return {resourceGroup, name}
}

function resourceGroupOf(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i)
    return match ? match[1] : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
