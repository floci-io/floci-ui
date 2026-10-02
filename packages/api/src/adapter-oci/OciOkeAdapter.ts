import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {ociOkeSchema} from '../cloud-spi/eksSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateKubernetesNodegroupInput,
    CreateResourceInput,
    KubernetesNodegroup,
    ResourceQuery,
    ServiceSchema,
    UpdateResourceInput,
} from '../cloud-spi/types'

/**
 * OKE through the Floci-OCI emulator, which mirrors the Container Engine
 * `20180222` REST API:
 *
 *   GET/POST        /20180222/clusters
 *   GET/PUT/DELETE  /20180222/clusters/{clusterId}
 *   GET/POST        /20180222/nodePools
 *   GET/DELETE      /20180222/nodePools/{nodePoolId}
 *   GET             /20180222/clusterOptions/all, /20180222/nodePoolOptions/{clusterId}
 *   GET             /20180222/workRequests/{workRequestId}
 *
 * Mutations answer 202 with an `opc-work-request-id`; real OKE sends no body,
 * so created resources are resolved through the work request, not the body.
 */

const API = '/20180222'

interface OciOkeCluster {
    id?: string
    name?: string
    compartmentId?: string
    vcnId?: string
    kubernetesVersion?: string
    kmsKeyId?: string
    lifecycleState?: string
    lifecycleDetails?: string
    endpoints?: Record<string, string>
    metadata?: {timeCreated?: string}
    freeformTags?: Record<string, string>
}

interface OciNodePool {
    id?: string
    name?: string
    compartmentId?: string
    clusterId?: string
    kubernetesVersion?: string
    nodeShape?: string
    quantityPerSubnet?: number
    subnetIds?: string[]
    nodeConfigDetails?: {size?: number}
    initialNodeLabels?: Array<{key?: string; value?: string}>
    lifecycleState?: string
    timeCreated?: string
    freeformTags?: Record<string, string>
}

interface OciWorkRequest {
    status?: string
    resources?: Array<{entityType?: string; actionType?: string; identifier?: string}>
}

interface OciClusterOptions {
    kubernetesVersions?: string[]
}

interface OciNodePoolOptions {
    shapes?: string[]
}

export class OciOkeAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'k8s' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociOkeSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const clusters = await this.client.listAll<OciOkeCluster>(`${API}/clusters?${qs}`)
        return filterBySearch(
            clusters.filter((cluster) => cluster.lifecycleState !== 'DELETED').map((cluster) => this.toResource(cluster)),
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const cluster = await this.client.json<OciOkeCluster>(clusterPath(id), {method: 'GET'}, {emptyOnNotFound: true})
        return cluster ? this.toResource(cluster) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.clusterName ?? input.values.name)
        const vcnId = stringValue(input.values.vcnId)
        const kubernetesVersion = stringValue(input.values.kubernetesVersion)

        if (!name) throw new ValidationError('clusterName is required')
        if (name.length > 255) throw new ValidationError('Cluster name must be at most 255 characters')
        if (!vcnId) throw new ValidationError('vcnId is required: OKE clusters run in a VCN')
        if (!vcnId.startsWith('ocid1.vcn.')) throw new ValidationError('vcnId must be a VCN OCID starting with ocid1.vcn.')
        if (!kubernetesVersion) throw new ValidationError('kubernetesVersion is required')
        await this.assertKubernetesVersion(kubernetesVersion)

        const res = await this.client.fetch(`${API}/clusters`, jsonRequest('POST', {
            compartmentId: this.client.tenancyId,
            name,
            vcnId,
            kubernetesVersion,
        }))
        const id = await this.createdIdentifier(res, 'cluster')
        // Real OKE may not serve the cluster yet; the accepted create is reported as CREATING, not as a failure.
        return (await this.get(id)) ?? this.toResource({
            id, name, vcnId, kubernetesVersion, compartmentId: this.client.tenancyId, lifecycleState: 'CREATING',
        })
    }

    async update(id: string, input: UpdateResourceInput): Promise<CloudResource> {
        const body: Record<string, string> = {}
        const name = stringValue(input.values.name)
        const kubernetesVersion = stringValue(input.values.kubernetesVersion)
        if (name) {
            if (name.length > 255) throw new ValidationError('Cluster name must be at most 255 characters')
            body.name = name
        }
        if (kubernetesVersion) {
            await this.assertKubernetesVersion(kubernetesVersion)
            body.kubernetesVersion = kubernetesVersion
        }
        if (Object.keys(body).length === 0) throw new ValidationError('Provide a new name or Kubernetes version')

        await this.client.fetch(clusterPath(id), jsonRequest('PUT', body))
        const updated = await this.get(id)
        if (!updated) throw new NotFoundError(`Cluster ${id} not found`)
        return updated
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(clusterPath(id), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    async listKubernetesNodegroups(clusterId: string): Promise<KubernetesNodegroup[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId, clusterId})
        const pools = await this.client.listAll<OciNodePool>(`${API}/nodePools?${qs}`)
        return pools.filter((pool) => pool.lifecycleState !== 'DELETED').map((pool) => toNodegroup(pool, clusterId))
    }

    /**
     * Maps the provider-neutral input onto CreateNodePoolDetails: the first
     * instance type is the node shape, and the desired size is the pool total,
     * split evenly across the subnets because `quantityPerSubnet` counts nodes in
     * each subnet. OCI has no node role, so `nodeRole` is ignored.
     */
    async createKubernetesNodegroup(clusterId: string, input: CreateKubernetesNodegroupInput): Promise<KubernetesNodegroup> {
        const name = stringValue(input?.name)
        if (!name) throw new ValidationError('Node pool name is required')

        const cluster = await this.client.json<OciOkeCluster>(clusterPath(clusterId), {method: 'GET'}, {emptyOnNotFound: true})
        if (!cluster) throw new NotFoundError(`Cluster ${clusterId} not found`)

        const nodeShape = stringValue(input.instanceTypes?.[0])
        if (!nodeShape) throw new ValidationError('A node shape is required, e.g. VM.Standard.E4.Flex')
        await this.assertNodeShape(clusterId, nodeShape)

        const desiredSize = input.scalingConfig?.desiredSize ?? 1
        if (!Number.isInteger(desiredSize) || desiredSize < 1) {
            throw new ValidationError('Desired size must be a whole number of at least 1')
        }

        // CreateNodePoolDetails needs exactly one of subnetIds or nodeConfigDetails.
        const subnetIds = (input.subnets ?? []).map(stringValue).filter(Boolean)
        if (subnetIds.length === 0) throw new ValidationError('At least one subnet OCID is required for the node pool')
        if (desiredSize % subnetIds.length !== 0) {
            throw new ValidationError(
                `Desired size ${desiredSize} must split evenly across ${subnetIds.length} subnets; OKE places the same number of nodes in each subnet`,
            )
        }
        const quantityPerSubnet = desiredSize / subnetIds.length

        const res = await this.client.fetch(`${API}/nodePools`, jsonRequest('POST', {
            compartmentId: this.client.tenancyId,
            clusterId,
            name,
            kubernetesVersion: cluster.kubernetesVersion,
            nodeShape,
            quantityPerSubnet,
            subnetIds,
            ...(input.labels ? {initialNodeLabels: Object.entries(input.labels).map(([key, value]) => ({key, value}))} : {}),
            ...(input.tags ? {freeformTags: input.tags} : {}),
        }))
        const id = await this.createdIdentifier(res, 'nodepool')
        const pool = await this.client.json<OciNodePool>(nodePoolPath(id), {method: 'GET'}, {emptyOnNotFound: true})
        return toNodegroup(pool ?? {
            id, name, clusterId, kubernetesVersion: cluster.kubernetesVersion, nodeShape, quantityPerSubnet, subnetIds,
            lifecycleState: 'CREATING',
        }, clusterId)
    }

    async deleteKubernetesNodegroup(clusterId: string, nodegroupId: string): Promise<void> {
        const pool = await this.client.json<OciNodePool>(nodePoolPath(nodegroupId), {method: 'GET'}, {emptyOnNotFound: true})
        if (!pool || pool.lifecycleState === 'DELETED') return
        if (pool.clusterId && pool.clusterId !== clusterId) {
            throw new NotFoundError(`Node pool ${nodegroupId} does not belong to cluster ${clusterId}`)
        }
        await this.client.fetch(nodePoolPath(nodegroupId), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    private async assertKubernetesVersion(version: string): Promise<void> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        const options = await this.client.json<OciClusterOptions>(`${API}/clusterOptions/all?${qs}`)
        const versions = options?.kubernetesVersions ?? []
        if (versions.length > 0 && !versions.includes(version)) {
            throw new ValidationError(`Unsupported Kubernetes version ${version}. Available: ${versions.join(', ')}`)
        }
    }

    private async assertNodeShape(clusterId: string, shape: string): Promise<void> {
        const options = await this.client.json<OciNodePoolOptions>(
            `${API}/nodePoolOptions/${encodeURIComponent(clusterId)}`,
        )
        const shapes = options?.shapes ?? []
        if (shapes.length > 0 && !shapes.includes(shape)) {
            throw new ValidationError(`Unsupported node shape ${shape}. Available: ${shapes.join(', ')}`)
        }
    }

    /**
     * Real OKE answers a create with 202 and no body, so the new OCID comes from
     * the work request's resources. Floci-OCI also echoes the resource, which
     * serves as the fallback when no work request id is returned.
     */
    private async createdIdentifier(res: Response | null, entityType: string): Promise<string> {
        const workRequestId = res?.headers.get('opc-work-request-id')
        if (workRequestId) {
            const workRequest = await this.client.json<OciWorkRequest>(
                `${API}/workRequests/${encodeURIComponent(workRequestId)}`,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            if (workRequest?.status === 'FAILED' || workRequest?.status === 'CANCELED') {
                throw new RuntimeError(`OKE did not create the ${entityType}: work request ${workRequestId} ${workRequest.status}`)
            }
            const resource = workRequest?.resources?.find(
                (entry) => entry.entityType?.toLowerCase() === entityType && entry.identifier,
            )
            if (resource?.identifier) return resource.identifier
        }

        const text = res ? await res.text() : ''
        const id = text ? (safeJson(text) as {id?: unknown} | null)?.id : undefined
        if (typeof id === 'string' && id) return id
        throw new RuntimeError(`OKE accepted the ${entityType} request but did not report its OCID`)
    }

    private toResource(cluster: OciOkeCluster): CloudResource {
        return {
            id: cluster.id ?? '',
            name: cluster.name ?? cluster.id ?? '',
            cloud: 'oci',
            service: 'k8s',
            type: 'cluster',
            region: this.client.region,
            createdAt: cluster.metadata?.timeCreated ?? null,
            status: cluster.lifecycleState ?? null,
            version: cluster.kubernetesVersion ?? null,
            metadata: {
                provider: 'oci',
                k8sService: 'oke',
                ocid: cluster.id,
                compartmentId: cluster.compartmentId,
                vcnId: cluster.vcnId,
                endpoint: cluster.endpoints?.kubernetes,
                endpoints: cluster.endpoints,
                kmsKeyId: cluster.kmsKeyId,
                lifecycleDetails: cluster.lifecycleDetails,
                freeformTags: cluster.freeformTags,
            },
        }
    }
}

function toNodegroup(pool: OciNodePool, clusterId: string): KubernetesNodegroup {
    // quantityPerSubnet counts nodes in each subnet, so the pool total multiplies by the subnet count.
    const perSubnet = pool.quantityPerSubnet
    const size = pool.nodeConfigDetails?.size
        ?? (typeof perSubnet === 'number' ? perSubnet * Math.max(pool.subnetIds?.length ?? 0, 1) : undefined)
    return {
        id: pool.id ?? '',
        name: pool.name ?? pool.id ?? '',
        clusterId: pool.clusterId ?? clusterId,
        arn: null,
        status: pool.lifecycleState ?? null,
        version: pool.kubernetesVersion ?? null,
        releaseVersion: null,
        createdAt: pool.timeCreated ?? null,
        modifiedAt: null,
        capacityType: null,
        instanceTypes: pool.nodeShape ? [pool.nodeShape] : [],
        subnets: pool.subnetIds ?? [],
        nodeRole: null,
        scalingConfig: typeof size === 'number' ? {desiredSize: size} : null,
        labels: Object.fromEntries(
            (pool.initialNodeLabels ?? [])
                .filter((label) => label.key)
                .map((label) => [label.key as string, label.value ?? '']),
        ),
        tags: pool.freeformTags ?? {},
    }
}

function clusterPath(id: string): string {
    return `${API}/clusters/${encodeURIComponent(id)}`
}

function nodePoolPath(id: string): string {
    return `${API}/nodePools/${encodeURIComponent(id)}`
}

function jsonRequest(method: string, body: unknown): RequestInit {
    return {method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
