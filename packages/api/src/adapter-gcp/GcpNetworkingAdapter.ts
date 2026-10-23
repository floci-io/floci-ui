import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    CIDR_PATTERN,
    GCP_NETWORK_KINDS,
    GCP_RESOURCE_NAME_PATTERN,
    gcpNetworkingSchema,
    type GcpNetworkKind,
} from '../cloud-spi/networkingSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * VPC networks, subnetworks and firewall rules as `networking` resources.
 * Verified against `floci/floci-gcp:nightly` (the 0.9.0 `latest` image has no
 * Compute service), which mirrors the Compute Engine v1 REST API:
 *
 *   GET    /compute/v1/projects/{p}/global/networks
 *   GET    /compute/v1/projects/{p}/aggregated/subnetworks      (every region at once)
 *   GET    /compute/v1/projects/{p}/global/firewalls
 *   POST   .../global/networks | .../regions/{r}/subnetworks | .../global/firewalls
 *   GET/DELETE  .../global/networks/{n} | .../regions/{r}/subnetworks/{n} | .../global/firewalls/{n}
 *
 * Mutations answer with a `compute#operation` in status PENDING, but the
 * resource is readable immediately, so create re-reads it instead of polling.
 * The runtime only accepts custom-mode networks and rejects a bare network
 * name: `network` must be `projects/{p}/global/networks/{n}`.
 *
 * Ids carry the kind so one flat list can route get and delete:
 * `network:{n}`, `subnetwork:{region}:{n}`, `firewall:{n}`.
 */

interface ComputeList<T> {
    items?: T[]
    nextPageToken?: string
}

interface ComputeAggregatedList {
    items?: Record<string, {subnetworks?: Subnetwork[]}>
    nextPageToken?: string
}

interface Network {
    name?: string
    id?: string
    description?: string
    selfLink?: string
    creationTimestamp?: string
    autoCreateSubnetworks?: boolean
    routingConfig?: {routingMode?: string}
    subnetworks?: string[]
    mtu?: number
}

interface Subnetwork {
    name?: string
    id?: string
    network?: string
    region?: string
    ipCidrRange?: string
    gatewayAddress?: string
    selfLink?: string
    creationTimestamp?: string
    stackType?: string
}

interface Firewall {
    name?: string
    id?: string
    network?: string
    direction?: string
    priority?: number
    selfLink?: string
    creationTimestamp?: string
    sourceRanges?: string[]
    destinationRanges?: string[]
    allowed?: Array<{IPProtocol?: string; ports?: string[]}>
    denied?: Array<{IPProtocol?: string; ports?: string[]}>
    disabled?: boolean
}

const PROTOCOLS = ['tcp', 'udp', 'icmp', 'all']
const DIRECTIONS = ['INGRESS', 'EGRESS']
const REGION_PATTERN = /^[a-z]+-[a-z]+\d+$/
const MAX_PAGES = 20

export class GcpNetworkingAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'networking' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpNetworkingSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const [networks, subnetworks, firewalls] = await Promise.all([
            !kind || kind === 'network' ? this.listNetworks() : [],
            !kind || kind === 'subnetwork' ? this.listSubnetworks() : [],
            !kind || kind === 'firewall' ? this.listFirewalls() : [],
        ])
        return filterBySearch([...networks, ...subnetworks, ...firewalls], query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const target = parseId(id)
        const options = {emptyOnNotFound: true}
        if (target.kind === 'network') {
            const network = await this.client.json<Network>(this.networkPath(target.name), {}, options)
            return network ? networkResource(network) : null
        }
        if (target.kind === 'subnetwork') {
            const subnet = await this.client.json<Subnetwork>(this.subnetworkPath(target.region, target.name), {}, options)
            return subnet ? subnetworkResource(subnet) : null
        }
        const firewall = await this.client.json<Firewall>(this.firewallPath(target.name), {}, options)
        return firewall ? firewallResource(firewall) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const kind = requiredKind(input.values.kind)
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(GCP_RESOURCE_NAME_PATTERN).test(name)) {
            throw new ValidationError(
                'name must be 1-63 lower case letters, digits or hyphens, starting with a letter and not ending with a hyphen',
            )
        }

        if (kind === 'network') {
            await this.post(this.networksPath(), {
                name,
                autoCreateSubnetworks: false,
                routingConfig: {routingMode: 'REGIONAL'},
            })
            return this.read(`network:${name}`)
        }

        if (kind === 'subnetwork') {
            const region = optionalString(input.values.region) || this.client.location
            if (!REGION_PATTERN.test(region)) throw new ValidationError(`region ${region} is not a valid GCP region`)
            const ipCidrRange = requiredString(input.values.ipCidrRange, 'ipCidrRange')
            requireCidr(ipCidrRange, 'ipCidrRange')
            await this.post(this.subnetworksPath(region), {
                name,
                network: this.networkRef(requiredString(input.values.subnetNetwork, 'subnetNetwork')),
                ipCidrRange,
            })
            return this.read(`subnetwork:${region}:${name}`)
        }

        await this.post(this.firewallsPath(), this.firewallBody(name, input.values))
        return this.read(`firewall:${name}`)
    }

    async delete(id: string): Promise<void> {
        const target = parseId(id)
        const path =
            target.kind === 'network'
                ? this.networkPath(target.name)
                : target.kind === 'subnetwork'
                  ? this.subnetworkPath(target.region, target.name)
                  : this.firewallPath(target.name)
        await this.client.fetch(path, {method: 'DELETE'})
    }

    async health(): Promise<void> {
        await this.client.json(this.networksPath())
    }

    private async listNetworks(): Promise<CloudResource[]> {
        return (await this.pages<Network>(this.networksPath())).map(networkResource)
    }

    private async listFirewalls(): Promise<CloudResource[]> {
        return (await this.pages<Firewall>(this.firewallsPath())).map(firewallResource)
    }

    private async listSubnetworks(): Promise<CloudResource[]> {
        const subnets: Subnetwork[] = []
        let pageToken: string | undefined
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const body = await this.client.json<ComputeAggregatedList>(
                `${this.projectPath()}/aggregated/subnetworks${tokenQuery(pageToken)}`,
            )
            for (const scope of Object.values(body?.items ?? {})) subnets.push(...(scope.subnetworks ?? []))
            pageToken = body?.nextPageToken
            if (!pageToken) return subnets.map(subnetworkResource)
        }
        throw pageLimitError('subnetworks')
    }

    private async pages<T>(path: string): Promise<T[]> {
        const items: T[] = []
        let pageToken: string | undefined
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const body = await this.client.json<ComputeList<T>>(`${path}${tokenQuery(pageToken)}`)
            items.push(...(body?.items ?? []))
            pageToken = body?.nextPageToken
            if (!pageToken) return items
        }
        throw pageLimitError(path)
    }

    private async post(path: string, body: unknown): Promise<void> {
        await this.client.fetch(path, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(body),
        })
    }

    private async read(id: string): Promise<CloudResource> {
        const resource = await this.get(id)
        if (!resource) throw new ValidationError(`${id} was created but cannot be read back`)
        return resource
    }

    private firewallBody(name: string, values: Record<string, unknown>): Record<string, unknown> {
        const direction = optionalString(values.direction) || 'INGRESS'
        if (!DIRECTIONS.includes(direction)) throw new ValidationError('direction must be INGRESS or EGRESS')

        const protocol = optionalString(values.protocol) || 'tcp'
        if (!PROTOCOLS.includes(protocol)) throw new ValidationError(`protocol must be one of ${PROTOCOLS.join(', ')}`)

        const ranges = csv(values.ranges)
        if (ranges.length === 0) throw new ValidationError('ranges is required')
        ranges.forEach((range) => requireCidr(range, 'ranges'))

        const ports = csv(values.ports)
        if (ports.length > 0 && (protocol === 'icmp' || protocol === 'all')) {
            throw new ValidationError(`ports cannot be set for protocol ${protocol}`)
        }

        const priorityText = optionalString(values.priority) || '1000'
        const priority = Number(priorityText)
        if (!/^\d+$/.test(priorityText) || priority > 65535) {
            throw new ValidationError('priority must be a whole number from 0 to 65535')
        }

        return {
            name,
            network: this.networkRef(requiredString(values.firewallNetwork, 'firewallNetwork')),
            direction,
            priority,
            [direction === 'INGRESS' ? 'sourceRanges' : 'destinationRanges']: ranges,
            allowed: [{IPProtocol: protocol, ...(ports.length > 0 ? {ports} : {})}],
        }
    }

    private networkRef(network: string): string {
        return network.includes('/') ? network : `projects/${this.client.project}/global/networks/${network}`
    }

    private projectPath(): string {
        return `/compute/v1/projects/${encodeURIComponent(this.client.project)}`
    }

    private networksPath(): string {
        return `${this.projectPath()}/global/networks`
    }

    private networkPath(name: string): string {
        return `${this.networksPath()}/${encodeURIComponent(name)}`
    }

    private subnetworksPath(region: string): string {
        return `${this.projectPath()}/regions/${encodeURIComponent(region)}/subnetworks`
    }

    private subnetworkPath(region: string, name: string): string {
        return `${this.subnetworksPath(region)}/${encodeURIComponent(name)}`
    }

    private firewallsPath(): string {
        return `${this.projectPath()}/global/firewalls`
    }

    private firewallPath(name: string): string {
        return `${this.firewallsPath()}/${encodeURIComponent(name)}`
    }
}

type Target =
    | {kind: 'network'; name: string}
    | {kind: 'firewall'; name: string}
    | {kind: 'subnetwork'; region: string; name: string}

function parseId(id: string): Target {
    const [kind, first, second] = id.split(':')
    if (kind === 'network' && first && !second) return {kind, name: first}
    if (kind === 'firewall' && first && !second) return {kind, name: first}
    if (kind === 'subnetwork' && first && second) return {kind, region: first, name: second}
    throw new ValidationError(`Unknown GCP networking resource id: ${id}`)
}

function lastSegment(path: string | undefined): string {
    return path?.split('/').pop() ?? ''
}

function networkResource(network: Network): CloudResource {
    const name = network.name ?? ''
    return {
        id: `network:${name}`,
        name,
        cloud: 'gcp',
        service: 'networking',
        type: 'network',
        region: null,
        createdAt: network.creationTimestamp ?? null,
        metadata: {
            provider: 'gcp',
            resourcePath: network.selfLink,
            autoCreateSubnetworks: network.autoCreateSubnetworks,
            routingMode: network.routingConfig?.routingMode,
            subnetworkCount: network.subnetworks?.length ?? 0,
            mtu: network.mtu,
            description: network.description,
        },
    }
}

function subnetworkResource(subnet: Subnetwork): CloudResource {
    const name = subnet.name ?? ''
    const region = lastSegment(subnet.region)
    return {
        id: `subnetwork:${region}:${name}`,
        name,
        cloud: 'gcp',
        service: 'networking',
        type: 'subnetwork',
        region: region || null,
        createdAt: subnet.creationTimestamp ?? null,
        metadata: {
            provider: 'gcp',
            resourcePath: subnet.selfLink,
            network: lastSegment(subnet.network),
            ipCidrRange: subnet.ipCidrRange,
            gatewayAddress: subnet.gatewayAddress,
            stackType: subnet.stackType,
        },
    }
}

function firewallResource(firewall: Firewall): CloudResource {
    const name = firewall.name ?? ''
    const rules = firewall.allowed ?? firewall.denied ?? []
    return {
        id: `firewall:${name}`,
        name,
        cloud: 'gcp',
        service: 'networking',
        type: 'firewall',
        region: null,
        status: firewall.disabled ? 'disabled' : null,
        createdAt: firewall.creationTimestamp ?? null,
        metadata: {
            provider: 'gcp',
            resourcePath: firewall.selfLink,
            network: lastSegment(firewall.network),
            direction: firewall.direction,
            priority: firewall.priority,
            action: firewall.allowed ? 'allow' : firewall.denied ? 'deny' : undefined,
            ipCidrRange: (firewall.sourceRanges ?? firewall.destinationRanges ?? []).join(', ') || undefined,
            rules: rules.map((rule) => `${rule.IPProtocol}${rule.ports?.length ? `:${rule.ports.join(',')}` : ''}`),
        },
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter(
        (resource) => resource.name.toLowerCase().includes(normalized) || resource.type.includes(normalized),
    )
}

function pageLimitError(what: string): RuntimeError {
    return new RuntimeError(`${what} still has more pages after ${MAX_PAGES}; refusing to show a partial list`)
}

function tokenQuery(pageToken: string | undefined): string {
    return pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''
}

function optionalKind(value: string | undefined): GcpNetworkKind | null {
    if (!value) return null
    return requiredKind(value)
}

function requiredKind(value: unknown): GcpNetworkKind {
    if (typeof value === 'string' && (GCP_NETWORK_KINDS as readonly string[]).includes(value)) {
        return value as GcpNetworkKind
    }
    throw new ValidationError(`kind must be one of ${GCP_NETWORK_KINDS.join(', ')}`)
}

function optionalString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function requiredString(value: unknown, field: string): string {
    const text = optionalString(value)
    if (!text) throw new ValidationError(`${field} is required`)
    return text
}

function csv(value: unknown): string[] {
    return optionalString(value)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
}

function requireCidr(value: string, field: string): void {
    if (!new RegExp(CIDR_PATTERN).test(value)) throw new ValidationError(`${field} must be an IPv4 CIDR such as 10.0.0.0/24`)
}
