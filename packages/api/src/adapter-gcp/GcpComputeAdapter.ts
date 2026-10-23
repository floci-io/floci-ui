import {ConflictError, NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    GCP_COMPUTE_ZONES,
    GCP_INSTANCE_NAME_PATTERN,
    GCP_MACHINE_TYPES,
    gcpComputeSchema,
} from '../cloud-spi/computeSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceDescriptorOverride,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Compute Engine through the Floci-GCP emulator, which serves the public
 * `compute.googleapis.com` v1 REST paths. Verified against the floci-gcp nightly
 * image; the 0.9.0 release has no `compute` service and answers 404 to every
 * `/compute/v1` path.
 *
 *   GET    /compute/v1/projects/{p}/aggregated/instances
 *   GET    /compute/v1/projects/{p}/zones/{z}/instances/{i}
 *   POST   /compute/v1/projects/{p}/zones/{z}/instances
 *   DELETE /compute/v1/projects/{p}/zones/{z}/instances/{i}
 *   POST   /compute/v1/projects/{p}/zones/{z}/instances/{i}/{start|stop|reset}
 *   GET    /compute/v1/projects/{p}/zones/{z}/operations/{op}
 *
 * Mutations answer with a `compute#operation` that stays PENDING until the
 * project is next read, so `create` polls the operation instead of trusting the
 * receipt. A zonal instance is addressed by zone and name, hence ids are
 * `zone/name`. A stopped instance reports TERMINATED.
 */
const COMPUTE_PREFIX = '/compute/v1/projects'
const OPERATION_POLL_ATTEMPTS = 20
const OPERATION_POLL_INTERVAL_MS = 100
const DEFAULT_DISK_SIZE_GB = 10
const HEALTH_PATH = '/_floci-gcp/health'
const HEALTH_TTL_MS = 5_000
const HEALTH_TIMEOUT_MS = 2_000
const DEFAULT_NETWORK = 'default'
/** The auto-mode subnet ranges real GCP assigns to each region's `default` subnet. */
const DEFAULT_SUBNET_RANGES: Record<string, string> = {
    'us-central1': '10.128.0.0/20',
    'europe-west1': '10.132.0.0/20',
}

interface GceNetworkInterface {
    network?: string
    subnetwork?: string
    networkIP?: string
    accessConfigs?: Array<{natIP?: string}>
}

interface GceInstance {
    id?: string
    name?: string
    zone?: string
    status?: string
    machineType?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    tags?: {items?: string[]}
    disks?: Array<{boot?: boolean; source?: string; diskSizeGb?: string; autoDelete?: boolean}>
    networkInterfaces?: GceNetworkInterface[]
}

interface GceInstanceList {
    items?: GceInstance[]
}

interface GceAggregatedList {
    items?: Record<string, {instances?: GceInstance[]}>
    nextPageToken?: string
}

interface GceOperation {
    name?: string
    status?: string
    error?: {errors?: Array<{message?: string}>}
}

export class GcpComputeAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'compute' as const

    private runtimeServes: {at: number; value: boolean} | null = null

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    /**
     * The 0.9.0 floci-gcp release does not serve `/compute/v1`; builds that do list
     * `compute` in their health report. Only a successful health report that omits
     * it marks the service unavailable. An unreachable or unparseable health leaves
     * it available, since runtime reachability is reported separately and a probe
     * failure must not hide a service that works. The probe is bounded by its own
     * timeout so a stalled health request cannot block service discovery.
     */
    async resolveDescriptorOverride(): Promise<CloudServiceDescriptorOverride> {
        if (await this.runtimeServesCompute()) return {}
        return {
            availability: 'coming_soon',
            reason: 'The Floci-GCP runtime does not expose Compute Engine; it requires floci-gcp:nightly or later.',
        }
    }

    private async runtimeServesCompute(): Promise<boolean> {
        if (this.runtimeServes && Date.now() - this.runtimeServes.at < HEALTH_TTL_MS) return this.runtimeServes.value

        let value = true
        try {
            const health = await this.client.json<{services?: Record<string, unknown>}>(HEALTH_PATH, {
                signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            })
            if (health?.services && typeof health.services === 'object') value = 'compute' in health.services
        } catch {
            value = true
        }
        this.runtimeServes = {at: Date.now(), value}
        return value
    }

    schema(): ServiceSchema {
        return gcpComputeSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const instances: GceInstance[] = []
        let pageToken: string | undefined

        do {
            const path = `${this.projectPath()}/aggregated/instances`
            const body = await this.client.json<GceAggregatedList>(
                pageToken ? `${path}?pageToken=${encodeURIComponent(pageToken)}` : path,
            )
            instances.push(...Object.values(body?.items ?? {}).flatMap((scope) => scope.instances ?? []))
            pageToken = body?.nextPageToken
        } while (pageToken)

        return filterBySearch(instances.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const {zone, name} = parseId(id)
        const instance = await this.client.json<GceInstance>(
            this.instancePath(zone, name),
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return instance ? toResource(instance) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(GCP_INSTANCE_NAME_PATTERN).test(name)) {
            throw new ValidationError(
                'name must be 1-63 lowercase letters, numbers or hyphens, starting with a letter and not ending with a hyphen',
            )
        }
        const zone = requiredOneOf(input.values.zone, GCP_COMPUTE_ZONES, 'zone')
        const machineType = requiredOneOf(input.values.machineType, GCP_MACHINE_TYPES, 'machineType')
        const diskSizeGb = diskSize(input.values.diskSizeGb)
        const region = regionOfZone(zone)
        const {network, subnetwork} = await this.resolveNetworking(
            region,
            optionalString(input.values.network),
            optionalString(input.values.subnetwork),
        )

        const operation = await this.client.json<GceOperation>(`${this.zonePath(zone)}/instances`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                name,
                machineType: `zones/${zone}/machineTypes/${machineType}`,
                disks: [{boot: true, autoDelete: true, initializeParams: {diskSizeGb: String(diskSizeGb)}}],
                networkInterfaces: [
                    {
                        network: `global/networks/${network}`,
                        subnetwork: `regions/${region}/subnetworks/${subnetwork}`,
                    },
                ],
            }),
        })
        await this.waitForOperation(this.zonePath(zone), operation)

        const created = await this.get(`${zone}/${name}`)
        if (!created) throw new RuntimeError(`Instance ${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        const {zone, name} = parseId(id)
        await this.client.fetch(this.instancePath(zone, name), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    async start(id: string): Promise<void> {
        await this.power(id, 'start')
    }

    async stop(id: string): Promise<void> {
        await this.power(id, 'stop')
    }

    async reboot(id: string): Promise<void> {
        await this.power(id, 'reset')
    }

    private async power(id: string, action: 'start' | 'stop' | 'reset'): Promise<void> {
        const {zone, name} = parseId(id)
        const res = await this.client.fetch(`${this.instancePath(zone, name)}/${action}`, {method: 'POST'}, {emptyOnNotFound: true})
        if (!res) throw new NotFoundError(`Instance ${id} was not found`)
    }

    /**
     * GCP puts new instances on the `default` VPC when none is named, and a
     * subnetwork alone implies its network. The runtime only implements
     * custom-mode networks, so a missing `default` is created as custom-mode with
     * the region's well-known subnet range. A custom network with no subnetwork
     * has nothing to place the instance in, so that is a 400 as on real GCP.
     */
    private async resolveNetworking(
        region: string,
        network: string | undefined,
        subnetwork: string | undefined,
    ): Promise<{network: string; subnetwork: string}> {
        if (!network && subnetwork) {
            const existing = await this.client.json<{network?: string}>(
                `${this.regionPath(region)}/subnetworks/${encodeURIComponent(subnetwork)}`,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            if (!existing) throw new ValidationError(`subnetwork ${subnetwork} does not exist in region ${region}`)
            return {network: lastSegment(existing.network) || DEFAULT_NETWORK, subnetwork}
        }

        const resolvedNetwork = network ?? DEFAULT_NETWORK
        if (resolvedNetwork === DEFAULT_NETWORK && (!subnetwork || subnetwork === DEFAULT_NETWORK)) {
            await this.ensureDefaultNetwork(region)
            return {network: DEFAULT_NETWORK, subnetwork: DEFAULT_NETWORK}
        }
        if (!subnetwork) {
            throw new ValidationError(`subnetwork is required for custom-mode network ${resolvedNetwork}`)
        }
        return {network: resolvedNetwork, subnetwork}
    }

    private async ensureDefaultNetwork(region: string): Promise<void> {
        const cidr = DEFAULT_SUBNET_RANGES[region]
        if (!cidr) throw new ValidationError(`No default subnet range is known for region ${region}`)

        const globalPath = `${this.projectPath()}/global`
        await this.createIfMissing(`${globalPath}/networks`, DEFAULT_NETWORK, globalPath, {
            name: DEFAULT_NETWORK,
            autoCreateSubnetworks: false,
        })
        await this.createIfMissing(`${this.regionPath(region)}/subnetworks`, DEFAULT_NETWORK, this.regionPath(region), {
            name: DEFAULT_NETWORK,
            network: `global/networks/${DEFAULT_NETWORK}`,
            ipCidrRange: cidr,
        })
    }

    /** Insert unless present; a concurrent creator winning the race is not an error. */
    private async createIfMissing(
        collectionPath: string,
        name: string,
        operationScopePath: string,
        body: Record<string, unknown>,
    ): Promise<void> {
        const existing = await this.client.fetch(
            `${collectionPath}/${encodeURIComponent(name)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        if (existing) return

        try {
            const operation = await this.client.json<GceOperation>(collectionPath, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify(body),
            })
            await this.waitForOperation(operationScopePath, operation)
        } catch (error) {
            if (!(error instanceof ConflictError)) throw error
        }
    }

    private async waitForOperation(scopePath: string, operation: GceOperation | null): Promise<void> {
        const name = operation?.name
        if (!name) return

        let current: GceOperation | null = operation
        for (let attempt = 0; attempt < OPERATION_POLL_ATTEMPTS && current?.status !== 'DONE'; attempt++) {
            await sleep(OPERATION_POLL_INTERVAL_MS)
            current = await this.client.json<GceOperation>(`${scopePath}/operations/${encodeURIComponent(name)}`)
        }

        const failure = current?.error?.errors?.[0]?.message
        if (failure) throw new RuntimeError(`Compute Engine operation failed: ${failure}`)
        if (current?.status !== 'DONE') throw new RuntimeError(`Compute Engine operation ${name} did not complete in time`)
    }

    private projectPath(): string {
        return `${COMPUTE_PREFIX}/${encodeURIComponent(this.client.project)}`
    }

    private regionPath(region: string): string {
        return `${this.projectPath()}/regions/${encodeURIComponent(region)}`
    }

    private zonePath(zone: string): string {
        return `${this.projectPath()}/zones/${encodeURIComponent(zone)}`
    }

    private instancePath(zone: string, name: string): string {
        return `${this.zonePath(zone)}/instances/${encodeURIComponent(name)}`
    }
}

function toResource(instance: GceInstance): CloudResource {
    const name = instance.name ?? ''
    const zone = lastSegment(instance.zone)
    const nic = instance.networkInterfaces?.[0]

    return {
        id: zone ? `${zone}/${name}` : name,
        name,
        cloud: 'gcp',
        service: 'compute',
        type: 'instance',
        region: zone || null,
        createdAt: instance.creationTimestamp ?? null,
        status: instance.status ?? null,
        instanceClass: lastSegment(instance.machineType) || null,
        metadata: {
            provider: 'gcp',
            instanceId: instance.id,
            internalIp: nic?.networkIP,
            externalIp: nic?.accessConfigs?.[0]?.natIP,
            network: lastSegment(nic?.network) || undefined,
            subnetwork: lastSegment(nic?.subnetwork) || undefined,
            disks: instance.disks?.map((disk) => ({
                name: lastSegment(disk.source),
                boot: disk.boot,
                sizeGb: disk.diskSizeGb,
                autoDelete: disk.autoDelete,
            })),
            tags: instance.tags?.items,
            labels: instance.labels,
        },
    }
}

/** Compute addresses a zonal instance by zone and name, so the id carries both. */
function parseId(id: string): {zone: string; name: string} {
    const [zone, ...rest] = id.split('/')
    const name = rest.join('/')
    if (!zone || !name) throw new ValidationError(`Instance id must be "zone/name", got "${id}"`)
    return {zone, name}
}

function lastSegment(value?: string): string {
    return value?.split('/').pop() ?? ''
}

function regionOfZone(zone: string): string {
    return zone.slice(0, zone.lastIndexOf('-'))
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
    return value.trim()
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    const text = requiredString(value, field)
    if (!(allowed as readonly string[]).includes(text)) {
        throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
    }
    return text as T
}

function diskSize(value: unknown): number {
    if (value === undefined || value === null || value === '') return DEFAULT_DISK_SIZE_GB
    const size = Number(value)
    if (!Number.isInteger(size) || size < 1) throw new ValidationError('diskSizeGb must be a positive whole number')
    return size
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
