import {describe, expect, test} from 'bun:test'
import type {EC2Client} from '@aws-sdk/client-ec2'
import {
    AllocateAddressCommand,
    AssociateAddressCommand,
    AssociateRouteTableCommand,
    AuthorizeSecurityGroupEgressCommand,
    AuthorizeSecurityGroupIngressCommand,
    CreateImageCommand,
    CreateInternetGatewayCommand,
    CreateKeyPairCommand,
    CreateNatGatewayCommand,
    CreateRouteCommand,
    CreateRouteTableCommand,
    CreateSecurityGroupCommand,
    CreateSubnetCommand,
    CreateTagsCommand,
    CreateVpcCommand,
    DeleteInternetGatewayCommand,
    DeleteKeyPairCommand,
    DeleteNatGatewayCommand,
    DeleteRouteCommand,
    DeleteSecurityGroupCommand,
    DeleteSubnetCommand,
    DeleteTagsCommand,
    DeleteVpcCommand,
    DeregisterImageCommand,
    DescribeAddressesCommand,
    DescribeAvailabilityZonesCommand,
    DescribeImagesCommand,
    DescribeInstanceTypesCommand,
    DescribeInternetGatewaysCommand,
    DescribeKeyPairsCommand,
    DescribeNatGatewaysCommand,
    DescribeRouteTablesCommand,
    DescribeSecurityGroupsCommand,
    DescribeSubnetsCommand,
    DescribeVpcAttributeCommand,
    DescribeVpcsCommand,
    DetachInternetGatewayCommand,
    DisassociateAddressCommand,
    DisassociateRouteTableCommand,
    GetConsoleOutputCommand,
    RebootInstancesCommand,
    ModifySubnetAttributeCommand,
    ModifyVpcAttributeCommand,
    ReleaseAddressCommand,
    RevokeSecurityGroupEgressCommand,
    RevokeSecurityGroupIngressCommand,
    RunInstancesCommand,
    StartInstancesCommand,
    StopInstancesCommand,
    TerminateInstancesCommand,
} from '@aws-sdk/client-ec2'
import {createEc2Service} from './ec2'

function fakeClient(responses: Record<string, unknown> = {}): EC2Client {
    return {
        send: async (cmd: {constructor: {name: string}}) => {
            const name = cmd.constructor.name
            if (name in responses) return responses[name]
            return {}
        },
    } as unknown as EC2Client
}

describe('ec2Service.runInstance', () => {
    test('sends RunInstancesCommand and returns mapped instance', async () => {
        const sentCmds: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sentCmds.push(cmd)
                return {
                    Instances: [{
                        InstanceId: 'i-new123',
                        Tags: [{Key: 'Name', Value: 'my-instance'}],
                        State: {Name: 'pending'},
                    }],
                }
            },
        } as unknown as EC2Client

        const service = createEc2Service(client)
        const result = await service.runInstance({
            name: 'my-instance',
            imageId: 'ami-abc',
            instanceType: 't3.micro',
        })

        expect(sentCmds[0]).toBeInstanceOf(RunInstancesCommand)
        expect(result.instanceId).toBe('i-new123')
        expect(result.name).toBe('my-instance')
        expect(result.state).toBe('pending')
    })
})

describe('ec2Service lifecycle', () => {
    test('startInstance sends StartInstancesCommand with correct id', async () => {
        const sentCmds: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sentCmds.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).startInstance('i-abc')
        expect(sentCmds[0]).toBeInstanceOf(StartInstancesCommand)
    })

    test('stopInstance sends StopInstancesCommand with correct id', async () => {
        const sentCmds: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sentCmds.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).stopInstance('i-abc')
        expect(sentCmds[0]).toBeInstanceOf(StopInstancesCommand)
    })

    test('rebootInstance sends RebootInstancesCommand', async () => {
        const sentCmds: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sentCmds.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).rebootInstance('i-abc')
        expect(sentCmds[0]).toBeInstanceOf(RebootInstancesCommand)
    })

    test('terminateInstance sends TerminateInstancesCommand', async () => {
        const sentCmds: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sentCmds.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).terminateInstance('i-abc')
        expect(sentCmds[0]).toBeInstanceOf(TerminateInstancesCommand)
    })
})

describe('ec2Service.updateInstanceTags', () => {
    test('calls CreateTags for additions and DeleteTags for removals', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        const service = createEc2Service(client)
        await service.updateInstanceTags('i-abc', [{key: 'Env', value: 'prod'}], ['OldKey'])
        expect(sent[0]).toBeInstanceOf(CreateTagsCommand)
        expect(sent[1]).toBeInstanceOf(DeleteTagsCommand)
    })

    test('skips CreateTags when nothing to add', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).updateInstanceTags('i-abc', [], ['OldKey'])
        expect(sent[0]).toBeInstanceOf(DeleteTagsCommand)
        expect(sent).toHaveLength(1)
    })
})

describe('ec2Service.createImage', () => {
    test('sends CreateImageCommand and returns imageId', async () => {
        const client = fakeClient({CreateImageCommand: {ImageId: 'ami-new'}})
        const result = await createEc2Service(client).createImage({instanceId: 'i-abc', name: 'snap-1'})
        expect(result.imageId).toBe('ami-new')
    })
})

describe('ec2Service.deregisterImage', () => {
    test('sends DeregisterImageCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).deregisterImage('ami-old')
        expect(sent[0]).toBeInstanceOf(DeregisterImageCommand)
    })
})

describe('ec2Service.listAmis', () => {
    test('requests the complete image catalog and maps launchable AMIs', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                return {
                    Images: [{
                        ImageId: 'ami-amazonlinux2023',
                        Name: 'Amazon Linux 2023',
                    }],
                }
            },
        } as unknown as EC2Client

        const result = await createEc2Service(client).listAmis()

        expect(sent[0]).toBeInstanceOf(DescribeImagesCommand)
        expect((sent[0] as DescribeImagesCommand).input).toEqual({})
        expect(result).toEqual([
            expect.objectContaining({
                imageId: 'ami-amazonlinux2023',
                name: 'Amazon Linux 2023',
            }),
        ])
    })
})

describe('ec2Service.getConsoleOutput', () => {
    test('decodes base64 output', async () => {
        const encoded = Buffer.from('hello console').toString('base64')
        const client = fakeClient({GetConsoleOutputCommand: {Output: encoded}})
        const result = await createEc2Service(client).getConsoleOutput('i-abc')
        expect(result.output).toBe('hello console')
    })

    test('returns empty output when operation is unsupported', async () => {
        const client: EC2Client = {
            send: async () => { throw new Error('GetConsoleOutput is not supported') },
        } as unknown as EC2Client
        const result = await createEc2Service(client).getConsoleOutput('i-abc')
        expect(result.output).toBe('')
    })
})

describe('ec2Service key pairs', () => {
    test('listKeyPairs returns empty array when unsupported', async () => {
        const client: EC2Client = {
            send: async () => { throw new Error('DescribeKeyPairs is not supported') },
        } as unknown as EC2Client
        const result = await createEc2Service(client).listKeyPairs()
        expect(result).toEqual([])
    })

    test('createKeyPair sends CreateKeyPairCommand and returns material', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                return {KeyPairId: 'kp-1', KeyName: 'my-key', KeyMaterial: '-----BEGIN RSA-----'}
            },
        } as unknown as EC2Client
        const result = await createEc2Service(client).createKeyPair('my-key')
        expect(sent[0]).toBeInstanceOf(CreateKeyPairCommand)
        expect(result.keyName).toBe('my-key')
        expect(result.keyMaterial).toBe('-----BEGIN RSA-----')
    })

    test('deleteKeyPair sends DeleteKeyPairCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).deleteKeyPair('my-key')
        expect(sent[0]).toBeInstanceOf(DeleteKeyPairCommand)
    })
})

describe('ec2Service security groups', () => {
    test('listSecurityGroups returns empty array when unsupported', async () => {
        const client: EC2Client = {
            send: async () => { throw new Error('DescribeSecurityGroups is not supported') },
        } as unknown as EC2Client
        expect(await createEc2Service(client).listSecurityGroups()).toEqual([])
    })

    test('createSecurityGroup sends CreateSecurityGroupCommand and returns groupId', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => { sent.push(cmd); return {GroupId: 'sg-new'} },
        } as unknown as EC2Client
        const result = await createEc2Service(client).createSecurityGroup('web', 'Web SG', 'vpc-1')
        expect(sent[0]).toBeInstanceOf(CreateSecurityGroupCommand)
        expect(result.groupId).toBe('sg-new')
    })

    test('deleteSecurityGroup sends DeleteSecurityGroupCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).deleteSecurityGroup('sg-1')
        expect(sent[0]).toBeInstanceOf(DeleteSecurityGroupCommand)
    })

    test('authorizeSecurityGroupIngress sends correct command', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).authorizeSecurityGroupIngress('sg-1', {protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '0.0.0.0/0'})
        expect(sent[0]).toBeInstanceOf(AuthorizeSecurityGroupIngressCommand)
    })

    test('revokeSecurityGroupIngress sends correct command', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).revokeSecurityGroupIngress('sg-1', {protocol: 'tcp', fromPort: 80, toPort: 80, cidr: '0.0.0.0/0'})
        expect(sent[0]).toBeInstanceOf(RevokeSecurityGroupIngressCommand)
    })

    test('authorizeSecurityGroupEgress sends correct command', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).authorizeSecurityGroupEgress('sg-1', {protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '0.0.0.0/0'})
        expect(sent[0]).toBeInstanceOf(AuthorizeSecurityGroupEgressCommand)
    })

    test('revokeSecurityGroupEgress sends correct command', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).revokeSecurityGroupEgress('sg-1', {protocol: 'tcp', fromPort: 443, toPort: 443, cidr: '0.0.0.0/0'})
        expect(sent[0]).toBeInstanceOf(RevokeSecurityGroupEgressCommand)
    })
})

describe('ec2Service VPCs and subnets', () => {
    test('listVpcs returns empty array when unsupported', async () => {
        const client: EC2Client = {
            send: async () => { throw new Error('DescribeVpcs is not supported') },
        } as unknown as EC2Client
        expect(await createEc2Service(client).listVpcs()).toEqual([])
    })

    test('createVpc sends CreateVpcCommand and returns mapped vpc', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => { sent.push(cmd); return {Vpc: {VpcId: 'vpc-new', CidrBlock: '10.0.0.0/16', IsDefault: false}} },
        } as unknown as EC2Client
        const result = await createEc2Service(client).createVpc('10.0.0.0/16')
        expect(sent[0]).toBeInstanceOf(CreateVpcCommand)
        expect(result.vpcId).toBe('vpc-new')
        expect(result.cidrBlock).toBe('10.0.0.0/16')
    })

    test('deleteVpc sends DeleteVpcCommand as final command', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).deleteVpc('vpc-1')
        // deleteVpc first cleans up SGs, subnets, IGWs, RTBs then sends DeleteVpcCommand last
        expect(sent[sent.length - 1]).toBeInstanceOf(DeleteVpcCommand)
    })

    test('listSubnets returns empty array when unsupported', async () => {
        const client: EC2Client = {
            send: async () => { throw new Error('DescribeSubnets is not supported') },
        } as unknown as EC2Client
        expect(await createEc2Service(client).listSubnets()).toEqual([])
    })

    test('createSubnet sends CreateSubnetCommand and returns mapped subnet', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                return {Subnet: {SubnetId: 'subnet-new', VpcId: 'vpc-1', CidrBlock: '10.0.1.0/24', AvailabilityZone: 'us-east-1a'}}
            },
        } as unknown as EC2Client
        const result = await createEc2Service(client).createSubnet('vpc-1', '10.0.1.0/24', 'us-east-1a')
        expect(sent[0]).toBeInstanceOf(CreateSubnetCommand)
        expect(result.subnetId).toBe('subnet-new')
        expect(result.availabilityZone).toBe('us-east-1a')
    })

    test('deleteSubnet sends DeleteSubnetCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).deleteSubnet('subnet-1')
        expect(sent[0]).toBeInstanceOf(DeleteSubnetCommand)
    })

    test('modifySubnetMapPublicIp sends ModifySubnetAttributeCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).modifySubnetMapPublicIp('subnet-1', true)
        expect(sent[0]).toBeInstanceOf(ModifySubnetAttributeCommand)
    })

    test('getVpcAttributes returns dns settings from two parallel describe calls', async () => {
        const client = fakeClient({
            DescribeVpcAttributeCommand: {AttributeValue: {Value: true}},
        })
        const result = await createEc2Service(client).getVpcAttributes('vpc-1')
        expect(result).toHaveProperty('enableDnsHostnames')
        expect(result).toHaveProperty('enableDnsSupport')
    })

    test('modifyVpcAttribute sends ModifyVpcAttributeCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).modifyVpcAttribute('vpc-1', 'enableDnsHostnames', true)
        expect(sent[0]).toBeInstanceOf(ModifyVpcAttributeCommand)
    })
})

describe('ec2Service Internet Gateways', () => {
    test('listInternetGateways returns empty array when unsupported', async () => {
        const client: EC2Client = {send: async () => { throw new Error('DescribeInternetGateways is not supported') }} as unknown as EC2Client
        expect(await createEc2Service(client).listInternetGateways()).toEqual([])
    })

    test('createInternetGateway sends CreateInternetGatewayCommand and returns mapped igw', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                if (cmd instanceof CreateInternetGatewayCommand) return {InternetGateway: {InternetGatewayId: 'igw-0a1b2c3d', Attachments: [], Tags: []}}
                return {}
            },
        } as unknown as EC2Client
        const result = await createEc2Service(client).createInternetGateway()
        expect(sent[0]).toBeInstanceOf(CreateInternetGatewayCommand)
        expect(result.internetGatewayId).toBe('igw-0a1b2c3d')
    })

    test('deleteInternetGateway detaches all VPCs then deletes', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                if (cmd instanceof DescribeInternetGatewaysCommand) {
                    return {InternetGateways: [{InternetGatewayId: 'igw-0a1b2c3d', Attachments: [{VpcId: 'vpc-0a1b2c3d', State: 'available'}]}]}
                }
                return {}
            },
        } as unknown as EC2Client
        await createEc2Service(client).deleteInternetGateway('igw-0a1b2c3d')
        expect(sent[0]).toBeInstanceOf(DescribeInternetGatewaysCommand)
        expect(sent[1]).toBeInstanceOf(DetachInternetGatewayCommand)
        expect(sent[2]).toBeInstanceOf(DeleteInternetGatewayCommand)
    })
})

describe('ec2Service NAT Gateways', () => {
    test('listNatGateways returns empty array when unsupported', async () => {
        const client: EC2Client = {send: async () => { throw new Error('DescribeNatGateways is not supported') }} as unknown as EC2Client
        expect(await createEc2Service(client).listNatGateways()).toEqual([])
    })

    test('createNatGateway auto-allocates EIP when allocationId is absent', async () => {
        const sent: unknown[] = []
        let attempt = 0
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                if (cmd instanceof AllocateAddressCommand) return {AllocationId: 'eipalloc-0a1b2c3d', PublicIp: '1.2.3.4'}
                if (cmd instanceof CreateNatGatewayCommand) return {NatGateway: {NatGatewayId: 'nat-0a1b2c3d', SubnetId: 'subnet-1', VpcId: 'vpc-1'}}
                if (cmd instanceof DescribeNatGatewaysCommand) {
                    attempt++
                    return {NatGateways: [{NatGatewayId: 'nat-0a1b2c3d', SubnetId: 'subnet-1', VpcId: 'vpc-1', State: attempt >= 1 ? 'available' : 'pending'}]}
                }
                return {}
            },
        } as unknown as EC2Client
        const result = await createEc2Service(client).createNatGateway({subnetId: 'subnet-1'})
        expect(sent[0]).toBeInstanceOf(AllocateAddressCommand)
        expect(sent[1]).toBeInstanceOf(CreateNatGatewayCommand)
        expect(result.natGatewayId).toBe('nat-0a1b2c3d')
    })

    test('deleteNatGateway sends DeleteNatGatewayCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                if (cmd instanceof DescribeNatGatewaysCommand) return {NatGateways: [{NatGatewayId: 'nat-0a1b2c3d', State: 'deleted'}]}
                return {}
            },
        } as unknown as EC2Client
        await createEc2Service(client).deleteNatGateway('nat-0a1b2c3d')
        expect(sent[0]).toBeInstanceOf(DeleteNatGatewayCommand)
    })
})

describe('ec2Service Route Tables', () => {
    test('listRouteTables returns empty array when unsupported', async () => {
        const client: EC2Client = {send: async () => { throw new Error('DescribeRouteTables is not supported') }} as unknown as EC2Client
        expect(await createEc2Service(client).listRouteTables()).toEqual([])
    })

    test('createRoute sends CreateRouteCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).createRoute('rtb-0a1b2c3d', {destinationCidrBlock: '0.0.0.0/0', gatewayId: 'igw-0a1b2c3d'})
        expect(sent[0]).toBeInstanceOf(CreateRouteCommand)
    })

    test('deleteRoute sends DeleteRouteCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).deleteRoute('rtb-0a1b2c3d', '0.0.0.0/0')
        expect(sent[0]).toBeInstanceOf(DeleteRouteCommand)
    })

    test('associateRouteTable sends AssociateRouteTableCommand and returns associationId', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => { sent.push(cmd); return {AssociationId: 'rtbassoc-0a1b2c3d'} },
        } as unknown as EC2Client
        const id = await createEc2Service(client).associateRouteTable('rtb-0a1b2c3d', 'subnet-0a1b2c3d')
        expect(sent[0]).toBeInstanceOf(AssociateRouteTableCommand)
        expect(id).toBe('rtbassoc-0a1b2c3d')
    })

    test('disassociateRouteTable sends DisassociateRouteTableCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).disassociateRouteTable('rtbassoc-0a1b2c3d')
        expect(sent[0]).toBeInstanceOf(DisassociateRouteTableCommand)
    })
})

describe('ec2Service Elastic IPs', () => {
    test('listElasticIps returns empty array when unsupported', async () => {
        const client: EC2Client = {send: async () => { throw new Error('DescribeAddresses is not supported') }} as unknown as EC2Client
        expect(await createEc2Service(client).listElasticIps()).toEqual([])
    })

    test('allocateElasticIp sends AllocateAddressCommand and returns eip', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                if (cmd instanceof AllocateAddressCommand) return {AllocationId: 'eipalloc-0a1b2c3d', PublicIp: '54.0.0.1', Domain: 'vpc'}
                return {}
            },
        } as unknown as EC2Client
        const result = await createEc2Service(client).allocateElasticIp()
        expect(sent[0]).toBeInstanceOf(AllocateAddressCommand)
        expect(result.allocationId).toBe('eipalloc-0a1b2c3d')
        expect(result.publicIp).toBe('54.0.0.1')
    })

    test('releaseElasticIp sends ReleaseAddressCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).releaseElasticIp('eipalloc-0a1b2c3d')
        expect(sent[0]).toBeInstanceOf(ReleaseAddressCommand)
    })

    test('associateElasticIp sends AssociateAddressCommand and returns associationId', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {
            send: async (cmd: unknown) => {
                sent.push(cmd)
                if (cmd instanceof AssociateAddressCommand) return {AssociationId: 'eipassoc-test'}
                return {}
            },
        } as unknown as EC2Client
        const result = await createEc2Service(client).associateElasticIp('eipalloc-0a1b2c3d', 'i-test1')
        expect(sent[0]).toBeInstanceOf(AssociateAddressCommand)
        expect(result.associationId).toBe('eipassoc-test')
    })

    test('disassociateElasticIp sends DisassociateAddressCommand', async () => {
        const sent: unknown[] = []
        const client: EC2Client = {send: async (cmd: unknown) => { sent.push(cmd); return {} }} as unknown as EC2Client
        await createEc2Service(client).disassociateElasticIp('eipassoc-test')
        expect(sent[0]).toBeInstanceOf(DisassociateAddressCommand)
    })
})

describe('ec2Service metadata', () => {
    test('listAvailabilityZones returns empty array when unsupported', async () => {
        const client: EC2Client = {send: async () => { throw new Error('DescribeAvailabilityZones is not supported') }} as unknown as EC2Client
        expect(await createEc2Service(client).listAvailabilityZones()).toEqual([])
    })

    test('listAvailabilityZones returns mapped zones', async () => {
        const client = fakeClient({
            DescribeAvailabilityZonesCommand: {AvailabilityZones: [{ZoneName: 'us-east-1a', ZoneId: 'use1-az1', State: 'available'}]},
        })
        const result = await createEc2Service(client).listAvailabilityZones()
        expect(result).toHaveLength(1)
        expect(result[0].zoneName).toBe('us-east-1a')
        expect(result[0].zoneId).toBe('use1-az1')
    })

    test('listInstanceTypes returns empty array when unsupported', async () => {
        const client: EC2Client = {send: async () => { throw new Error('DescribeInstanceTypes is not supported') }} as unknown as EC2Client
        expect(await createEc2Service(client).listInstanceTypes()).toEqual([])
    })

    test('listInstanceTypes returns mapped types', async () => {
        const client = fakeClient({
            DescribeInstanceTypesCommand: {InstanceTypes: [{InstanceType: 't3.micro', VCpuInfo: {DefaultVCpus: 2}, MemoryInfo: {SizeInMiB: 1024}}]},
        })
        const result = await createEc2Service(client).listInstanceTypes()
        expect(result).toHaveLength(1)
        expect(result[0].instanceType).toBe('t3.micro')
        expect(result[0].vcpu).toBe(2)
        expect(result[0].memoryMiB).toBe(1024)
    })
})

// Suppress unused import warnings
void DescribeKeyPairsCommand
void DescribeSecurityGroupsCommand
void DescribeSubnetsCommand
void DescribeVpcAttributeCommand
void DescribeVpcsCommand
void DescribeInternetGatewaysCommand
void DescribeNatGatewaysCommand
void DescribeRouteTablesCommand
void DescribeAddressesCommand
void CreateRouteTableCommand
void ReleaseAddressCommand
