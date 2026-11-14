import {describe, expect, test} from 'bun:test'
import {EC2ServiceException} from '@aws-sdk/client-ec2'
import {createEc2Router} from './ec2'
import type {
    CreateAmiInput,
    CreateNatGatewayInput,
    CreateRouteInput,
    Ec2ConsoleOutput,
    Ec2ElasticIp,
    Ec2Image,
    Ec2Instance,
    Ec2InternetGateway,
    Ec2IpPermission,
    Ec2KeyPair,
    Ec2KeyPairMaterial,
    Ec2NatGateway,
    Ec2RouteTable,
    Ec2SecurityGroup,
    Ec2Subnet,
    Ec2Tag,
    Ec2Vpc,
    IpPermissionInput,
    RunInstanceInput,
} from '../services/ec2'

const baseInstance: Ec2Instance = {
    instanceId: 'i-test1',
    name: 'test-instance',
    state: 'running',
    instanceType: 't3.micro',
    availabilityZone: 'us-east-1a',
    securityGroups: [],
    tags: [],
}

const baseIgw: Ec2InternetGateway = {
    internetGatewayId: 'igw-0a1b2c3d4e5f6a7b',
    attachments: [],
    tags: [],
}

const baseNatGw: Ec2NatGateway = {
    natGatewayId: 'nat-0a1b2c3d4e5f6a7b',
    subnetId: 'subnet-0a1b2c3d4e5f0001',
    vpcId: 'vpc-0a1b2c3d4e5f6a7b',
    state: 'available',
    tags: [],
}

const baseRtb: Ec2RouteTable = {
    routeTableId: 'rtb-0a1b2c3d4e5f6a7b',
    vpcId: 'vpc-0a1b2c3d4e5f6a7b',
    routes: [{destinationCidrBlock: '10.0.0.0/16', gatewayId: 'local', state: 'active', origin: 'CreateRouteTable'}],
    associations: [],
    tags: [],
}

const baseEip: Ec2ElasticIp = {
    allocationId: 'eipalloc-0a1b2c3d4e5f6a7b',
    publicIp: '54.0.0.1',
    domain: 'vpc',
    tags: [],
}

const fakeService = {
    listInstances: async (): Promise<Ec2Instance[]> => [baseInstance],
    describeInstance: async (id: string): Promise<Ec2Instance> => ({...baseInstance, instanceId: id}),
    runInstance: async (_input: RunInstanceInput): Promise<Ec2Instance> => ({...baseInstance, instanceId: 'i-new1', name: _input.name, state: 'pending'}),
    startInstance: async () => {},
    stopInstance: async () => {},
    rebootInstance: async () => {},
    terminateInstance: async () => {},
    updateInstanceTags: async (_id: string, _add: Ec2Tag[], _rem: string[]) => {},
    createImage: async (_input: CreateAmiInput): Promise<{imageId: string}> => ({imageId: 'ami-0a1b2c3d4e5f6a7b'}),
    deregisterImage: async () => {},
    getConsoleOutput: async (instanceId: string): Promise<Ec2ConsoleOutput> => ({instanceId, output: 'boot log'}),
    listAmis: async (): Promise<Ec2Image[]> => [],
    listKeyPairs: async (): Promise<Ec2KeyPair[]> => [],
    createKeyPair: async (name: string): Promise<Ec2KeyPairMaterial> => ({keyPairId: 'key-0a1b2c3d4e5f6a7b', keyName: name, keyMaterial: '---PEM---'}),
    deleteKeyPair: async () => {},
    listSecurityGroups: async (): Promise<Ec2SecurityGroup[]> => [],
    createSecurityGroup: async () => ({groupId: 'sg-0a1b2c3d4e5f6a7b'}),
    deleteSecurityGroup: async () => {},
    authorizeSecurityGroupIngress: async (_id: string, _p: IpPermissionInput) => {},
    revokeSecurityGroupIngress: async (_id: string, _p: IpPermissionInput) => {},
    authorizeSecurityGroupEgress: async (_id: string, _p: IpPermissionInput) => {},
    revokeSecurityGroupEgress: async (_id: string, _p: IpPermissionInput) => {},
    listVpcs: async (): Promise<Ec2Vpc[]> => [],
    createVpc: async (cidrBlock: string): Promise<Ec2Vpc> => ({vpcId: 'vpc-0a1b2c3d4e5f6a7b', cidrBlock, isDefault: false, tags: []}),
    deleteVpc: async () => {},
    listSubnets: async (): Promise<Ec2Subnet[]> => [],
    createSubnet: async (vpcId: string, cidrBlock: string): Promise<Ec2Subnet> => ({
        subnetId: 'subnet-0a1b2c3d4e5f6a7b',
        vpcId,
        cidrBlock,
        availabilityZone: 'us-east-1a',
        mapPublicIpOnLaunch: false,
        tags: [],
    }),
    deleteSubnet: async () => {},
    // Internet Gateways
    listInternetGateways: async (): Promise<Ec2InternetGateway[]> => [baseIgw],
    createInternetGateway: async (): Promise<Ec2InternetGateway> => baseIgw,
    attachInternetGateway: async () => {},
    detachInternetGateway: async () => {},
    deleteInternetGateway: async () => {},
    // NAT Gateways
    listNatGateways: async (): Promise<Ec2NatGateway[]> => [baseNatGw],
    createNatGateway: async (_input: CreateNatGatewayInput): Promise<Ec2NatGateway> => baseNatGw,
    deleteNatGateway: async () => {},
    // Route Tables
    listRouteTables: async (): Promise<Ec2RouteTable[]> => [baseRtb],
    createRouteTable: async (): Promise<Ec2RouteTable> => baseRtb,
    deleteRouteTable: async () => {},
    createRoute: async (_rtbId: string, _input: CreateRouteInput) => {},
    deleteRoute: async () => {},
    associateRouteTable: async (): Promise<string> => 'rtbassoc-0a1b2c3d4e5f6a7b',
    disassociateRouteTable: async () => {},
    // Elastic IPs
    listElasticIps: async (): Promise<Ec2ElasticIp[]> => [baseEip],
    allocateElasticIp: async (): Promise<Ec2ElasticIp> => baseEip,
    releaseElasticIp: async () => {},
    associateElasticIp: async (): Promise<{associationId: string}> => ({associationId: 'eipassoc-test'}),
    disassociateElasticIp: async () => {},
    // Meta
    listAvailabilityZones: async () => [{zoneName: 'us-east-1a', zoneId: 'use1-az1', state: 'available'}],
    listInstanceTypes: async () => [{instanceType: 't3.micro', vcpu: 2, memoryMiB: 1024}],
    // VPC attributes
    getVpcAttributes: async () => ({enableDnsHostnames: true, enableDnsSupport: true}),
    modifyVpcAttribute: async () => {},
    // Subnet attribute
    modifySubnetMapPublicIp: async () => {},
    // VPC Wizard
    createVpcWizard: async () => ({
        vpcId: 'vpc-0a1b2c3d4e5f6a7b',
        igwId: 'igw-0a1b2c3d4e5f6a7b',
        publicSubnetIds: ['subnet-0a1b2c3d4e5f0001', 'subnet-0a1b2c3d4e5f0002'],
        privateSubnetIds: ['subnet-0a1b2c3d4e5f0003', 'subnet-0a1b2c3d4e5f0004'],
        subnetGroups: [
            {name: 'public', isPublic: true, subnetIds: ['subnet-0a1b2c3d4e5f0001', 'subnet-0a1b2c3d4e5f0002']},
            {name: 'private', isPublic: false, subnetIds: ['subnet-0a1b2c3d4e5f0003', 'subnet-0a1b2c3d4e5f0004']},
        ],
        publicRouteTableId: 'rtb-0a1b2c3d4e5f6a7b',
        privateRouteTableId: 'rtb-0a1b2c3d4e5f6a7c',
        natGatewayId: 'nat-0a1b2c3d4e5f6a7b',
        eipAllocationId: 'eipalloc-0a1b2c3d4e5f6a7b',
    }),
}

type FakeIpPermission = Ec2IpPermission  // keep import used

const app = createEc2Router(fakeService)

describe('GET /instances', () => {
    test('returns instance array', async () => {
        const res = await app.request('/instances')
        expect(res.status).toBe(200)
        const body = await res.json() as unknown[]
        expect(Array.isArray(body)).toBe(true)
        expect(body).toHaveLength(1)
    })
})

describe('GET /instances/:id', () => {
    test('returns single instance with correct id', async () => {
        const res = await app.request('/instances/i-test1')
        expect(res.status).toBe(200)
        const body = await res.json() as {instanceId: string}
        expect(body.instanceId).toBe('i-test1')
    })
})

describe('POST /instances', () => {
    test('creates instance and returns it', async () => {
        const res = await app.request('/instances', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'new-instance', imageId: 'ami-1', instanceType: 't3.micro'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {instanceId: string; state: string}
        expect(body.instanceId).toBe('i-new1')
        expect(body.state).toBe('pending')
    })
})

describe('POST /instances/:id/start', () => {
    test('returns ok', async () => {
        const res = await app.request('/instances/i-test1/start', {method: 'POST'})
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('POST /instances/:id/terminate', () => {
    test('terminates instance and returns ok', async () => {
        const res = await app.request('/instances/i-test1/terminate', {method: 'POST'})
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('POST /amis/:imageId/deregister', () => {
    test('deregisters AMI and returns ok', async () => {
        const res = await app.request('/amis/ami-0a1b2c3d4e5f6a7b/deregister', {method: 'POST'})
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('GET /instances/:id/console', () => {
    test('returns console output', async () => {
        const res = await app.request('/instances/i-test1/console')
        expect(res.status).toBe(200)
        const body = await res.json() as {output: string}
        expect(body.output).toBe('boot log')
    })
})

describe('GET /security-groups', () => {
    test('returns array', async () => {
        const res = await app.request('/security-groups')
        expect(res.status).toBe(200)
        expect(Array.isArray(await res.json())).toBe(true)
    })
})

describe('POST /vpcs', () => {
    test('creates vpc and returns it', async () => {
        const res = await app.request('/vpcs', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({cidrBlock: '10.0.0.0/16'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {vpcId: string}
        expect(body.vpcId).toBe('vpc-0a1b2c3d4e5f6a7b')
    })
})

describe('DELETE /vpcs/:id', () => {
    test('returns ok', async () => {
        const res = await app.request('/vpcs/vpc-0a1b2c3d4e5f6a7b', {method: 'DELETE'})
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('POST /key-pairs', () => {
    test('creates key pair and returns PEM material', async () => {
        const res = await app.request('/key-pairs', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'my-key'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {keyName: string; keyMaterial: string}
        expect(body.keyName).toBe('my-key')
        expect(body.keyMaterial).toBe('---PEM---')
    })
})

describe('GET /internet-gateways', () => {
    test('returns array with igw', async () => {
        const res = await app.request('/internet-gateways')
        expect(res.status).toBe(200)
        const body = await res.json() as {internetGatewayId: string}[]
        expect(body).toHaveLength(1)
        expect(body[0].internetGatewayId).toBe('igw-0a1b2c3d4e5f6a7b')
    })
})

describe('POST /internet-gateways', () => {
    test('creates igw and returns it', async () => {
        const res = await app.request('/internet-gateways', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'my-igw'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {internetGatewayId: string}
        expect(body.internetGatewayId).toBe('igw-0a1b2c3d4e5f6a7b')
    })
})

describe('DELETE /internet-gateways/:igwId', () => {
    test('returns ok', async () => {
        const res = await app.request('/internet-gateways/igw-0a1b2c3d4e5f6a7b', {method: 'DELETE'})
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('GET /nat-gateways', () => {
    test('returns array with nat gateway', async () => {
        const res = await app.request('/nat-gateways')
        expect(res.status).toBe(200)
        const body = await res.json() as {natGatewayId: string}[]
        expect(body).toHaveLength(1)
        expect(body[0].natGatewayId).toBe('nat-0a1b2c3d4e5f6a7b')
    })
})

describe('POST /nat-gateways', () => {
    test('creates nat gateway and returns it', async () => {
        const res = await app.request('/nat-gateways', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({name: 'my-nat', subnetId: 'subnet-0a1b2c3d4e5f0001'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {natGatewayId: string}
        expect(body.natGatewayId).toBe('nat-0a1b2c3d4e5f6a7b')
    })
})

describe('GET /route-tables', () => {
    test('returns array with route table', async () => {
        const res = await app.request('/route-tables')
        expect(res.status).toBe(200)
        const body = await res.json() as {routeTableId: string}[]
        expect(body).toHaveLength(1)
        expect(body[0].routeTableId).toBe('rtb-0a1b2c3d4e5f6a7b')
    })
})

describe('POST /route-tables/:rtbId/routes', () => {
    test('creates route and returns ok', async () => {
        const res = await app.request('/route-tables/rtb-0a1b2c3d4e5f6a7b/routes', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({destinationCidrBlock: '0.0.0.0/0', gatewayId: 'igw-0a1b2c3d4e5f6a7b'}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('POST /route-tables/:rtbId/associations', () => {
    test('associates subnet and returns associationId', async () => {
        const res = await app.request('/route-tables/rtb-0a1b2c3d4e5f6a7b/associations', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({subnetId: 'subnet-0a1b2c3d4e5f0001'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {associationId: string}
        expect(body.associationId).toBe('rtbassoc-0a1b2c3d4e5f6a7b')
    })
})

describe('GET /elastic-ips', () => {
    test('returns array with eip', async () => {
        const res = await app.request('/elastic-ips')
        expect(res.status).toBe(200)
        const body = await res.json() as {allocationId: string}[]
        expect(body).toHaveLength(1)
        expect(body[0].allocationId).toBe('eipalloc-0a1b2c3d4e5f6a7b')
    })
})

describe('POST /elastic-ips', () => {
    test('allocates eip and returns it', async () => {
        const res = await app.request('/elastic-ips', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {allocationId: string; publicIp: string}
        expect(body.allocationId).toBe('eipalloc-0a1b2c3d4e5f6a7b')
        expect(body.publicIp).toBe('54.0.0.1')
    })
})

describe('POST /elastic-ips/:allocationId/release', () => {
    test('releases eip and returns ok', async () => {
        const res = await app.request('/elastic-ips/eipalloc-0a1b2c3d4e5f6a7b/release', {method: 'POST'})
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('POST /security-groups/:groupId/ingress', () => {
    test('authorizes ingress rule and returns ok', async () => {
        const res = await app.request('/security-groups/sg-0a1b2c3d/ingress', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '0.0.0.0/0'}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('DELETE /security-groups/:groupId/ingress', () => {
    test('revokes ingress rule and returns ok', async () => {
        const res = await app.request('/security-groups/sg-0a1b2c3d/ingress', {
            method: 'DELETE',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '0.0.0.0/0'}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('POST /security-groups/:groupId/egress', () => {
    test('authorizes egress rule and returns ok', async () => {
        const res = await app.request('/security-groups/sg-0a1b2c3d/egress', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '0.0.0.0/0'}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('DELETE /security-groups/:groupId/egress', () => {
    test('revokes egress rule and returns ok', async () => {
        const res = await app.request('/security-groups/sg-0a1b2c3d/egress', {
            method: 'DELETE',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '0.0.0.0/0'}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('GET /availability-zones', () => {
    test('returns availability zones array', async () => {
        const res = await app.request('/availability-zones')
        expect(res.status).toBe(200)
        const body = await res.json() as {zoneName: string}[]
        expect(body).toHaveLength(1)
        expect(body[0].zoneName).toBe('us-east-1a')
    })
})

describe('GET /instance-types', () => {
    test('returns instance types array', async () => {
        const res = await app.request('/instance-types')
        expect(res.status).toBe(200)
        const body = await res.json() as {instanceType: string; vcpu: number}[]
        expect(body).toHaveLength(1)
        expect(body[0].instanceType).toBe('t3.micro')
        expect(body[0].vcpu).toBe(2)
    })
})

describe('PUT /subnets/:subnetId/attributes', () => {
    test('modifies subnet mapPublicIpOnLaunch and returns ok', async () => {
        const res = await app.request('/subnets/subnet-0a1b2c3d/attributes', {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({mapPublicIpOnLaunch: true}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('GET /vpcs/:vpcId/attributes', () => {
    test('returns vpc dns attributes', async () => {
        const res = await app.request('/vpcs/vpc-0a1b2c3d/attributes')
        expect(res.status).toBe(200)
        const body = await res.json() as {enableDnsHostnames: boolean; enableDnsSupport: boolean}
        expect(body).toHaveProperty('enableDnsHostnames', true)
        expect(body).toHaveProperty('enableDnsSupport', true)
    })
})

describe('PUT /vpcs/:vpcId/attributes', () => {
    test('modifies vpc dns attribute and returns ok', async () => {
        const res = await app.request('/vpcs/vpc-0a1b2c3d/attributes', {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({attribute: 'enableDnsHostnames', value: false}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

describe('POST /elastic-ips/:allocationId/associate', () => {
    test('associates eip to instance and returns associationId', async () => {
        const res = await app.request('/elastic-ips/eipalloc-0a1b2c3d4e5f6a7b/associate', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({instanceId: 'i-test1'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {associationId: string}
        expect(body.associationId).toBe('eipassoc-test')
    })
})

describe('POST /elastic-ips/:allocationId/disassociate', () => {
    test('disassociates eip and returns ok', async () => {
        const res = await app.request('/elastic-ips/eipalloc-0a1b2c3d4e5f6a7b/disassociate', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({associationId: 'eipassoc-test'}),
        })
        expect(res.status).toBe(200)
        expect((await res.json() as {ok: boolean}).ok).toBe(true)
    })
})

// Suppress unused-type lint warnings
void ({} as FakeIpPermission)

describe('AWS failures keep their status', () => {
    const awsError = (name: string, httpStatusCode: number, message: string) =>
        new EC2ServiceException({name, $fault: 'client', $metadata: {httpStatusCode}, message})
    const failing = createEc2Router({
        ...fakeService,
        stopInstance: async () => {
            throw awsError('UnauthorizedOperation', 403, 'User is not authorized to perform: ec2:StopInstances')
        },
        describeInstance: async () => {
            throw awsError('InvalidInstanceID.NotFound', 400, "The instance ID 'i-missing' does not exist")
        },
        createVpc: async () => {
            throw new Error('Invalid VPC CIDR: nope')
        },
    })

    test('an IAM denial is 403 access_denied with the runtime message', async () => {
        const res = await failing.request('/instances/i-prod/stop', {method: 'POST'})
        expect(res.status).toBe(403)
        expect(await res.json()).toEqual({
            error: 'Access denied by the runtime',
            code: 'access_denied',
            message: 'Access denied by the runtime',
            detail: 'User is not authorized to perform: ec2:StopInstances',
        })
    })

    test('a missing instance on an uncaught route is 404, not 500', async () => {
        const res = await failing.request('/instances/i-missing')
        expect(res.status).toBe(404)
        expect((await res.json() as {code: string}).code).toBe('resource_not_found')
    })

    test('a non-AWS failure stays a 400 carrying its message', async () => {
        const res = await failing.request('/vpcs', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({cidrBlock: 'nope'}),
        })
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({
            error: 'Invalid VPC CIDR: nope',
            code: 'invalid_request',
            message: 'Invalid VPC CIDR: nope',
        })
    })
})
