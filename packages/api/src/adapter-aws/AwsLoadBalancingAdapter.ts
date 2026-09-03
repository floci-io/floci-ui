import {
    CreateLoadBalancerCommand,
    DeleteLoadBalancerCommand,
    DescribeLoadBalancersCommand,
    type ElasticLoadBalancingV2Client,
    type LoadBalancer,
} from '@aws-sdk/client-elastic-load-balancing-v2'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {ELB_NAME_PATTERN, ELB_SCHEMES, ELB_TYPES, awsLoadBalancingSchema} from '../cloud-spi/loadBalancingSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Talks to Elastic Load Balancing — verified against Floci core 1.5.33.
 *
 * Notes from probing the runtime:
 *  - **Only ELBv2 is implemented.** A `Version=2012-06-01` request comes back in the
 *    `2015-12-01` namespace, so there is no separate classic ELB to model.
 *  - `State` is **nested** (`<State><Code>provisioning</Code></State>`). Reading
 *    `State` directly yields an object and the column renders blank.
 *  - A missing load balancer is `LoadBalancerNotFound` with HTTP **400**, not 404,
 *    so `get` matches on the error name. `awsErrors.ts` now maps that name (and
 *    `TargetGroupNotFound`) so the route reports 404 rather than a validation error.
 *  - The runtime returns `<NextMarker></NextMarker>` at the end of the list, which
 *    the SDK surfaces as an empty string — paging must stop on falsy, not on
 *    undefined, or it spins forever.
 *  - A new load balancer reports `provisioning` and then reaches `active`; the
 *    state is surfaced as-is rather than waited on.
 *
 * Target groups are deliberately excluded: they are a second resource kind in this
 * category and would need the `kind` facet from `ResourceQuery.filters` (#162).
 * Shipping load balancers alone keeps this PR independent of that one.
 */
export class AwsLoadBalancingAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'loadbalancing' as const

    constructor(private readonly elb: ElasticLoadBalancingV2Client) {}

    schema(): ServiceSchema {
        return awsLoadBalancingSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const balancers: LoadBalancer[] = []
        let marker: string | undefined

        do {
            const res = await this.elb.send(new DescribeLoadBalancersCommand(marker ? {Marker: marker} : {}))
            balancers.push(...(res.LoadBalancers ?? []))
            marker = res.NextMarker || undefined
        } while (marker)

        return filterBySearch(balancers.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const res = await this.elb.send(new DescribeLoadBalancersCommand({LoadBalancerArns: [id]}))
            const balancer = res.LoadBalancers?.[0]
            return balancer ? toResource(balancer) : null
        } catch (error) {
            if (isMissing(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!new RegExp(ELB_NAME_PATTERN).test(name)) {
            throw new ValidationError(
                'name must be up to 32 characters of letters, digits and hyphens, not starting or ending with a hyphen',
            )
        }

        // Only the count is enforced. Whether the subnets sit in different
        // availability zones is ELB's rule, and checking it here would mean calling
        // EC2 DescribeSubnets from the load balancing adapter — real coupling for a
        // validation nicety. So the message claims only what this check does; the
        // schema field carries the AZ requirement as guidance.
        const subnets = splitIds(requiredString(input.values.subnets, 'subnets'))
        if (subnets.length < 2) {
            throw new ValidationError('subnets must list at least two subnet ids')
        }

        const type = optionalOneOf(input.values.type, ELB_TYPES, 'type') ?? 'application'
        const scheme = optionalOneOf(input.values.scheme, ELB_SCHEMES, 'scheme') ?? 'internet-facing'

        const res = await this.elb.send(
            new CreateLoadBalancerCommand({Name: name, Subnets: subnets, Type: type, Scheme: scheme}),
        )
        const created = res.LoadBalancers?.[0]
        if (!created) throw new RuntimeError(`ELB did not return the created load balancer for ${name}`)
        return toResource(created)
    }

    async delete(id: string): Promise<void> {
        await this.elb.send(new DeleteLoadBalancerCommand({LoadBalancerArn: id}))
    }
}

function toResource(balancer: LoadBalancer): CloudResource {
    const arn = balancer.LoadBalancerArn ?? ''
    const zones = balancer.AvailabilityZones ?? []

    return {
        id: arn,
        name: balancer.LoadBalancerName ?? '',
        cloud: 'aws',
        service: 'loadbalancing',
        type: 'load-balancer',
        region: regionFromArn(arn),
        createdAt: balancer.CreatedTime ? balancer.CreatedTime.toISOString() : null,
        status: balancer.State?.Code ?? null,
        metadata: {
            arn,
            dnsName: balancer.DNSName,
            /** `type` is taken by CloudResource, so the ELB type lives here. */
            lbType: balancer.Type,
            scheme: balancer.Scheme,
            vpcId: balancer.VpcId,
            stateReason: balancer.State?.Reason,
            subnets: zones.map((zone) => zone.SubnetId).filter((id): id is string => Boolean(id)),
            availabilityZones: zones.map((zone) => zone.ZoneName).filter((z): z is string => Boolean(z)),
            securityGroups: balancer.SecurityGroups,
            ipAddressType: balancer.IpAddressType,
            canonicalHostedZoneId: balancer.CanonicalHostedZoneId,
        },
    }
}

/** `arn:aws:elasticloadbalancing:us-east-1:...` — region is field 4. */
function regionFromArn(arn: string): string | null {
    return arn.split(':')[3] || null
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter(
        (resource) =>
            resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized),
    )
}

/** Accepts the comma separated form the schema asks for, ignoring blanks. */
function splitIds(raw: string): string[] {
    return raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
}

/**
 * The wire `<Code>` is `LoadBalancerNotFound`, but the SDK names the modelled error
 * `LoadBalancerNotFoundException`. Matching only the wire code passed every stubbed
 * test and still returned 400 against the live runtime, so both are accepted.
 */
function isMissing(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const name = (error as {name?: string}).name
    return name === 'LoadBalancerNotFound' || name === 'LoadBalancerNotFoundException'
}

function requiredString(value: unknown, field: string): string {
    if (value === undefined || value === null || value === '') throw new ValidationError(`${field} is required`)
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    const trimmed = value.trim()
    if (!trimmed) throw new ValidationError(`${field} is required`)
    return trimmed
}

function optionalOneOf<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    const raw = value.trim()
    if (!allowed.includes(raw)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
    return raw as T[number]
}
