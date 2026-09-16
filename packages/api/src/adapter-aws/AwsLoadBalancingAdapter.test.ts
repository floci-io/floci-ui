import {describe, expect, test} from 'bun:test'
import {
    CreateLoadBalancerCommand,
    DeleteLoadBalancerCommand,
    DescribeLoadBalancersCommand,
    type ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2'
import {AwsLoadBalancingAdapter} from './AwsLoadBalancingAdapter'
import {ValidationError} from '../cloud-spi/errors'

type SendResult = Record<string, unknown>

function stubElb(handler: (command: object) => SendResult | Promise<SendResult>) {
    const sent: object[] = []
    const client = {
        async send(command: object) {
            sent.push(command)
            return handler(command)
        },
    } as unknown as ElasticLoadBalancingV2Client
    return {client, sent}
}

const ARN = 'arn:aws:elasticloadbalancing:us-east-1:000000000000:loadbalancer/app/web/77aa388f69144785'

const balancer = {
    LoadBalancerArn: ARN,
    LoadBalancerName: 'web',
    DNSName: 'web-77aa388f69144785.elb.localhost.floci.io',
    // The runtime nests this: <State><Code>provisioning</Code></State>
    State: {Code: 'provisioning'},
    Type: 'application',
    Scheme: 'internet-facing',
    VpcId: 'vpc-default',
    CreatedTime: new Date('2026-07-28T17:04:35.028Z'),
    AvailabilityZones: [
        {ZoneName: 'us-east-1b', SubnetId: 'subnet-default-b'},
        {ZoneName: 'us-east-1c', SubnetId: 'subnet-default-c'},
    ],
    SecurityGroups: ['sg-1'],
}

function runtimeStub() {
    return stubElb((command) => {
        if (command instanceof CreateLoadBalancerCommand) return {LoadBalancers: [balancer]}
        if (command instanceof DescribeLoadBalancersCommand) return {LoadBalancers: [balancer]}
        return {}
    })
}

const validValues = {name: 'web', subnets: 'subnet-default-b, subnet-default-c'}

describe('AwsLoadBalancingAdapter', () => {
    test('identifies itself as the AWS load balancing adapter', () => {
        const adapter = new AwsLoadBalancingAdapter(runtimeStub().client)

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('loadbalancing')
        expect(adapter.schema().displayName).toBe('AWS Elastic Load Balancing')
    })

    test('lists load balancers and reads the nested state code', async () => {
        const {client, sent} = runtimeStub()
        const [resource] = await new AwsLoadBalancingAdapter(client).list()

        expect(sent[0]).toBeInstanceOf(DescribeLoadBalancersCommand)
        expect(resource).toMatchObject({
            // The ARN is the id: Describe and Delete both take one.
            id: ARN,
            name: 'web',
            cloud: 'aws',
            service: 'loadbalancing',
            type: 'load-balancer',
            region: 'us-east-1',
            // State is nested, not a flat field — reading State directly yields
            // an object and the column would render blank.
            status: 'provisioning',
            createdAt: '2026-07-28T17:04:35.028Z',
        })
        expect(resource?.metadata).toMatchObject({
            dnsName: 'web-77aa388f69144785.elb.localhost.floci.io',
            lbType: 'application',
            scheme: 'internet-facing',
            vpcId: 'vpc-default',
            subnets: ['subnet-default-b', 'subnet-default-c'],
            availabilityZones: ['us-east-1b', 'us-east-1c'],
        })
    })

    test('follows the pagination marker', async () => {
        let call = 0
        const {client, sent} = stubElb((command) => {
            if (!(command instanceof DescribeLoadBalancersCommand)) return {}
            call += 1
            if (call === 1) return {LoadBalancers: [balancer], NextMarker: 'page-2'}
            return {LoadBalancers: [{...balancer, LoadBalancerName: 'api', LoadBalancerArn: `${ARN}-2`}]}
        })

        const resources = await new AwsLoadBalancingAdapter(client).list()

        expect(resources.map((r) => r.name)).toEqual(['web', 'api'])
        expect((sent[1] as DescribeLoadBalancersCommand).input.Marker).toBe('page-2')
    })

    test('treats an empty NextMarker as the end of the list', async () => {
        // The runtime returns <NextMarker></NextMarker>, which the SDK surfaces as
        // an empty string; looping on truthiness alone would spin forever.
        let call = 0
        const {client} = stubElb((command) => {
            if (!(command instanceof DescribeLoadBalancersCommand)) return {}
            call += 1
            return {LoadBalancers: [balancer], NextMarker: ''}
        })

        await expect(new AwsLoadBalancingAdapter(client).list()).resolves.toHaveLength(1)
        expect(call).toBe(1)
    })

    test('filters by name and ARN', async () => {
        const adapter = new AwsLoadBalancingAdapter(runtimeStub().client)

        await expect(adapter.list({search: 'we'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'loadbalancer/app'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'nope'})).resolves.toHaveLength(0)
    })

    test('inspects a load balancer by ARN', async () => {
        const {client, sent} = runtimeStub()
        const resource = await new AwsLoadBalancingAdapter(client).get(ARN)

        expect((sent[0] as DescribeLoadBalancersCommand).input.LoadBalancerArns).toEqual([ARN])
        expect(resource?.id).toBe(ARN)
    })

    test('returns null on LoadBalancerNotFound even though the runtime answers 400', async () => {
        // ELB reports a missing load balancer as LoadBalancerNotFound with HTTP 400,
        // not 404, so matching on the status would rethrow instead of returning null.
        const {client} = stubElb(() => {
            throw Object.assign(new Error('One or more load balancers not found.'), {
                name: 'LoadBalancerNotFound',
                $metadata: {httpStatusCode: 400},
            })
        })
        await expect(new AwsLoadBalancingAdapter(client).get(ARN)).resolves.toBeNull()
    })

    test('also returns null for the SDK-modelled exception name', async () => {
        // The wire <Code> is LoadBalancerNotFound but the SDK calls the error
        // LoadBalancerNotFoundException. Matching only the wire code passed every
        // stubbed test here and still returned 400 against the live runtime.
        const {client} = stubElb(() => {
            throw Object.assign(new Error('One or more load balancers not found.'), {
                name: 'LoadBalancerNotFoundException',
                $metadata: {httpStatusCode: 400},
            })
        })
        await expect(new AwsLoadBalancingAdapter(client).get(ARN)).resolves.toBeNull()
    })

    test('returns null when the runtime answers with no load balancers', async () => {
        const {client} = stubElb(() => ({LoadBalancers: []}))
        await expect(new AwsLoadBalancingAdapter(client).get(ARN)).resolves.toBeNull()
    })

    test('rethrows a failure that is not a missing load balancer', async () => {
        const {client} = stubElb(() => {
            throw Object.assign(new Error('AccessDenied'), {
                name: 'AccessDeniedException',
                $metadata: {httpStatusCode: 403},
            })
        })
        await expect(new AwsLoadBalancingAdapter(client).get(ARN)).rejects.toThrow('AccessDenied')
    })

    test('creates a load balancer, splitting the comma separated subnets', async () => {
        const {client, sent} = runtimeStub()
        const resource = await new AwsLoadBalancingAdapter(client).create({values: validValues})

        const command = sent[0] as CreateLoadBalancerCommand
        expect(command).toBeInstanceOf(CreateLoadBalancerCommand)
        expect(command.input.Name).toBe('web')
        expect(command.input.Subnets).toEqual(['subnet-default-b', 'subnet-default-c'])
        expect(command.input.Type).toBe('application')
        expect(command.input.Scheme).toBe('internet-facing')
        expect(resource.id).toBe(ARN)
    })

    test('requires at least two subnet ids', async () => {
        // Only the count is enforced. The AZ requirement is ELB's, and checking it
        // would mean calling EC2 from this adapter, so the message must not claim it.
        const adapter = new AwsLoadBalancingAdapter(runtimeStub().client)

        await expect(adapter.create({values: {...validValues, subnets: 'subnet-only'}})).rejects.toThrow(
            new ValidationError('subnets must list at least two subnet ids'),
        )
    })

    test('requires the fields the schema marks required', async () => {
        const adapter = new AwsLoadBalancingAdapter(runtimeStub().client)

        await expect(adapter.create({values: {}})).rejects.toThrow(new ValidationError('name is required'))
        await expect(adapter.create({values: {name: 'web'}})).rejects.toThrow(
            new ValidationError('subnets is required'),
        )
    })

    test('rejects values the runtime would refuse', async () => {
        const adapter = new AwsLoadBalancingAdapter(runtimeStub().client)

        for (const name of ['-web', 'web-', 'has spaces', 'a'.repeat(33)]) {
            await expect(adapter.create({values: {...validValues, name}}), name).rejects.toThrow(ValidationError)
        }
        await expect(adapter.create({values: {...validValues, type: 'gateway'}})).rejects.toThrow(ValidationError)
        await expect(adapter.create({values: {...validValues, scheme: 'sideways'}})).rejects.toThrow(ValidationError)
    })

    test('deletes a load balancer by ARN', async () => {
        const {client, sent} = runtimeStub()
        await new AwsLoadBalancingAdapter(client).delete(ARN)

        expect((sent[0] as DeleteLoadBalancerCommand).input.LoadBalancerArn).toBe(ARN)
    })
})
