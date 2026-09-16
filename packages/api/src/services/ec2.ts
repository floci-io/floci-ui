import {
    AllocateAddressCommand,
    AssociateAddressCommand,
    AssociateRouteTableCommand,
    AttachInternetGatewayCommand,
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
    DeleteRouteTableCommand,
    DeleteSecurityGroupCommand,
    DeleteSubnetCommand,
    DeleteTagsCommand,
    DeleteVpcCommand,
    DeregisterImageCommand,
    DescribeAddressesCommand,
    DescribeAvailabilityZonesCommand,
    DescribeImagesCommand,
    DescribeInstancesCommand,
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
    ModifySubnetAttributeCommand,
    ModifyVpcAttributeCommand,
    RebootInstancesCommand,
    ReleaseAddressCommand,
    RevokeSecurityGroupEgressCommand,
    RevokeSecurityGroupIngressCommand,
    RunInstancesCommand,
    StartInstancesCommand,
    StopInstancesCommand,
    TerminateInstancesCommand,
    type Address,
    type EC2Client,
    type Image,
    type Instance,
    type InternetGateway,
    type IpPermission,
    type KeyPairInfo,
    type NatGateway,
    type RouteTable,
    type SecurityGroup,
    type Subnet,
    type Vpc,
} from '@aws-sdk/client-ec2'
import {awsClients} from '../aws'

export type Ec2Tag = {
    key: string
    value: string
}

export type Ec2SecurityGroupRef = {
    id?: string
    name?: string
}

export type Ec2IpPermission = {
    protocol: string
    fromPort: number | null
    toPort: number | null
    ipRanges: string[]
    ipv6Ranges: string[]
}

export type Ec2SecurityGroup = {
    groupId: string
    groupName: string
    description: string
    vpcId?: string
    inboundRules: Ec2IpPermission[]
    outboundRules: Ec2IpPermission[]
    tags: Ec2Tag[]
}

export type Ec2Image = {
    imageId: string
    name: string
    description?: string
    state?: string
    architecture?: string
    platform?: string
    virtualizationType?: string
    rootDeviceType?: string
    createdAt?: string
    ownerId?: string
    public?: boolean
    tags: Ec2Tag[]
}

export type Ec2Instance = {
    instanceId: string
    name: string
    state?: string
    instanceType?: string
    availabilityZone?: string
    publicIpAddress?: string
    privateIpAddress?: string
    vpcId?: string
    subnetId?: string
    imageId?: string
    keyName?: string
    launchTime?: string
    architecture?: string
    platform?: string
    securityGroups: Ec2SecurityGroupRef[]
    tags: Ec2Tag[]
}

export type Ec2KeyPair = {
    keyPairId: string
    keyName: string
    keyFingerprint?: string
    tags: Ec2Tag[]
}

export type Ec2KeyPairMaterial = {
    keyPairId: string
    keyName: string
    keyMaterial: string
}

export type Ec2Vpc = {
    vpcId: string
    cidrBlock: string
    state?: string
    isDefault: boolean
    tags: Ec2Tag[]
}

export type Ec2Subnet = {
    subnetId: string
    vpcId: string
    cidrBlock: string
    availabilityZone: string
    availableIpAddressCount?: number
    mapPublicIpOnLaunch: boolean
    state?: string
    tags: Ec2Tag[]
}

export type Ec2InternetGateway = {
    internetGatewayId: string
    attachments: Array<{vpcId: string; state: string}>
    tags: Ec2Tag[]
}

export type Ec2NatGateway = {
    natGatewayId: string
    subnetId: string
    vpcId: string
    state?: string
    publicIp?: string
    privateIp?: string
    eipAllocationId?: string
    tags: Ec2Tag[]
}

export type Ec2Route = {
    destinationCidrBlock?: string
    gatewayId?: string
    natGatewayId?: string
    vpcPeeringConnectionId?: string
    state?: string
    origin?: string
}

export type Ec2RouteTableAssociation = {
    associationId: string
    subnetId?: string
    isMain: boolean
}

export type Ec2RouteTable = {
    routeTableId: string
    vpcId: string
    routes: Ec2Route[]
    associations: Ec2RouteTableAssociation[]
    tags: Ec2Tag[]
}

export type Ec2ElasticIp = {
    allocationId: string
    publicIp: string
    domain?: string
    associationId?: string
    instanceId?: string
    networkInterfaceId?: string
    tags: Ec2Tag[]
}

export type CreateNatGatewayInput = {
    name?: string
    subnetId: string
    allocationId?: string
}

export type CreateRouteInput = {
    destinationCidrBlock: string
    gatewayId?: string
    natGatewayId?: string
    vpcPeeringConnectionId?: string
}

export type Ec2ConsoleOutput = {
    instanceId: string
    output: string
    timestamp?: string
}

export type RunInstanceInput = {
    name: string
    imageId: string
    instanceType: string
    keyName?: string
    subnetId?: string
    securityGroupIds?: string[]
    userData?: string
    iamInstanceProfileName?: string
    associatePublicIpAddress?: boolean
    rootVolumeSize?: number
    rootVolumeType?: string
}

export type CreateAmiInput = {
    instanceId: string
    name: string
    description?: string
    noReboot?: boolean
}

export type IpPermissionInput = {
    protocol: string
    fromPort: number
    toPort: number
    cidr: string
}

export type Ec2AvailabilityZone = {
    zoneName: string
    zoneId: string
    state: string
}

export type Ec2InstanceType = {
    instanceType: string
    vcpu: number
    memoryMiB: number
}

export type Ec2VpcAttributes = {
    enableDnsHostnames: boolean
    enableDnsSupport: boolean
}

function toTags(sdkTags: Array<{Key?: string; Value?: string}> | undefined): Ec2Tag[] {
    return (sdkTags ?? []).map((t) => ({key: t.Key ?? '', value: t.Value ?? ''}))
}

function nameFromTags(tags: Array<{Key?: string; Value?: string}> | undefined): string {
    return tags?.find((t) => t.Key === 'Name')?.Value ?? ''
}

function toEc2Instance(instance: Instance): Ec2Instance {
    const tags = toTags(instance.Tags)
    return {
        instanceId: instance.InstanceId ?? '',
        name: nameFromTags(instance.Tags) || (instance.InstanceId ?? ''),
        state: instance.State?.Name,
        instanceType: instance.InstanceType,
        availabilityZone: instance.Placement?.AvailabilityZone,
        publicIpAddress: instance.PublicIpAddress,
        privateIpAddress: instance.PrivateIpAddress,
        vpcId: instance.VpcId,
        subnetId: instance.SubnetId,
        imageId: instance.ImageId,
        keyName: instance.KeyName,
        launchTime: instance.LaunchTime?.toISOString(),
        architecture: instance.Architecture,
        platform: instance.Platform,
        securityGroups: (instance.SecurityGroups ?? []).map((sg) => ({
            id: sg.GroupId,
            name: sg.GroupName,
        })),
        tags,
    }
}

function toEc2Image(image: Image): Ec2Image {
    return {
        imageId: image.ImageId ?? '',
        name: image.Name ?? image.ImageId ?? '',
        description: image.Description,
        state: image.State,
        architecture: image.Architecture,
        platform: image.Platform,
        virtualizationType: image.VirtualizationType,
        rootDeviceType: image.RootDeviceType,
        createdAt: image.CreationDate,
        ownerId: image.OwnerId,
        public: image.Public,
        tags: toTags(image.Tags),
    }
}

function toEc2IpPermission(p: IpPermission): Ec2IpPermission {
    return {
        protocol: p.IpProtocol ?? '-1',
        fromPort: p.FromPort ?? null,
        toPort: p.ToPort ?? null,
        ipRanges: (p.IpRanges ?? []).map((r) => r.CidrIp ?? '').filter(Boolean),
        ipv6Ranges: (p.Ipv6Ranges ?? []).map((r) => r.CidrIpv6 ?? '').filter(Boolean),
    }
}

function toEc2SecurityGroup(sg: SecurityGroup): Ec2SecurityGroup {
    return {
        groupId: sg.GroupId ?? '',
        groupName: sg.GroupName ?? '',
        description: sg.Description ?? '',
        vpcId: sg.VpcId,
        inboundRules: (sg.IpPermissions ?? []).map(toEc2IpPermission),
        outboundRules: (sg.IpPermissionsEgress ?? []).map(toEc2IpPermission),
        tags: toTags(sg.Tags),
    }
}

function toEc2KeyPair(kp: KeyPairInfo): Ec2KeyPair {
    return {
        keyPairId: kp.KeyPairId ?? '',
        keyName: kp.KeyName ?? '',
        keyFingerprint: kp.KeyFingerprint,
        tags: toTags(kp.Tags),
    }
}

function toEc2Vpc(vpc: Vpc): Ec2Vpc {
    return {
        vpcId: vpc.VpcId ?? '',
        cidrBlock: vpc.CidrBlock ?? '',
        state: vpc.State,
        isDefault: vpc.IsDefault ?? false,
        tags: toTags(vpc.Tags),
    }
}

function toEc2Subnet(subnet: Subnet): Ec2Subnet {
    return {
        subnetId: subnet.SubnetId ?? '',
        vpcId: subnet.VpcId ?? '',
        cidrBlock: subnet.CidrBlock ?? '',
        availabilityZone: subnet.AvailabilityZone ?? '',
        availableIpAddressCount: subnet.AvailableIpAddressCount,
        mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch ?? false,
        state: subnet.State,
        tags: toTags(subnet.Tags),
    }
}

function toEc2InternetGateway(igw: InternetGateway): Ec2InternetGateway {
    return {
        internetGatewayId: igw.InternetGatewayId ?? '',
        attachments: (igw.Attachments ?? []).map((a) => ({
            vpcId: a.VpcId ?? '',
            state: a.State ?? '',
        })),
        tags: toTags(igw.Tags),
    }
}

function toEc2NatGateway(nat: NatGateway): Ec2NatGateway {
    const addr = nat.NatGatewayAddresses?.[0]
    return {
        natGatewayId: nat.NatGatewayId ?? '',
        subnetId: nat.SubnetId ?? '',
        vpcId: nat.VpcId ?? '',
        state: nat.State,
        publicIp: addr?.PublicIp,
        privateIp: addr?.PrivateIp,
        eipAllocationId: addr?.AllocationId,
        tags: toTags(nat.Tags),
    }
}

function toEc2RouteTable(rt: RouteTable): Ec2RouteTable {
    return {
        routeTableId: rt.RouteTableId ?? '',
        vpcId: rt.VpcId ?? '',
        routes: (rt.Routes ?? []).map((r) => ({
            destinationCidrBlock: r.DestinationCidrBlock,
            gatewayId: r.GatewayId,
            natGatewayId: r.NatGatewayId,
            vpcPeeringConnectionId: r.VpcPeeringConnectionId,
            state: r.State,
            origin: r.Origin,
        })),
        associations: (rt.Associations ?? []).map((a) => ({
            associationId: a.RouteTableAssociationId ?? '',
            subnetId: a.SubnetId,
            isMain: a.Main ?? false,
        })),
        tags: toTags(rt.Tags),
    }
}

function toEc2ElasticIp(addr: Address): Ec2ElasticIp {
    return {
        allocationId: addr.AllocationId ?? '',
        publicIp: addr.PublicIp ?? '',
        domain: addr.Domain,
        associationId: addr.AssociationId,
        instanceId: addr.InstanceId,
        networkInterfaceId: addr.NetworkInterfaceId,
        tags: toTags(addr.Tags),
    }
}

function isUnsupportedOperation(error: unknown) {
    return error instanceof Error && error.message.includes('is not supported')
}

export function createEc2Service(client: EC2Client = awsClients.ec2) {
    return {
        async listInstances(): Promise<Ec2Instance[]> {
            const instances: Ec2Instance[] = []
            let nextToken: string | undefined

            do {
                const res = await client.send(new DescribeInstancesCommand({NextToken: nextToken}))
                for (const reservation of res.Reservations ?? []) {
                    instances.push(...(reservation.Instances ?? []).map(toEc2Instance))
                }
                nextToken = res.NextToken
            } while (nextToken)

            return instances
        },

        async describeInstance(instanceId: string): Promise<Ec2Instance> {
            const res = await client.send(new DescribeInstancesCommand({InstanceIds: [instanceId]}))
            const instance = res.Reservations?.[0]?.Instances?.[0]
            return toEc2Instance(instance ?? {})
        },

        async runInstance(input: RunInstanceInput): Promise<Ec2Instance> {
            const blockDeviceMappings = input.rootVolumeSize
                ? [{
                    DeviceName: '/dev/xvda',
                    Ebs: {
                        VolumeSize: input.rootVolumeSize,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        VolumeType: (input.rootVolumeType ?? 'gp3') as any,
                        DeleteOnTermination: true,
                    },
                }]
                : undefined
            const networkInterfaces = input.subnetId
                ? [{
                    DeviceIndex: 0,
                    SubnetId: input.subnetId,
                    AssociatePublicIpAddress: input.associatePublicIpAddress ?? false,
                    Groups: input.securityGroupIds?.length ? input.securityGroupIds : undefined,
                }]
                : undefined
            const res = await client.send(new RunInstancesCommand({
                ImageId: input.imageId,
                MinCount: 1,
                MaxCount: 1,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                InstanceType: input.instanceType as any,
                KeyName: input.keyName || undefined,
                ...(networkInterfaces
                    ? {NetworkInterfaces: networkInterfaces}
                    : {
                        SubnetId: input.subnetId || undefined,
                        SecurityGroupIds: input.securityGroupIds?.length ? input.securityGroupIds : undefined,
                    }),
                UserData: input.userData ? Buffer.from(input.userData).toString('base64') : undefined,
                IamInstanceProfile: input.iamInstanceProfileName
                    ? {Name: input.iamInstanceProfileName}
                    : undefined,
                BlockDeviceMappings: blockDeviceMappings,
                TagSpecifications: [{
                    ResourceType: 'instance',
                    Tags: [{Key: 'Name', Value: input.name}],
                }],
            }))
            const instance = res.Instances?.[0]
            if (!instance) throw new Error('RunInstances returned no instance')
            return toEc2Instance(instance)
        },

        async startInstance(instanceId: string): Promise<void> {
            await client.send(new StartInstancesCommand({InstanceIds: [instanceId]}))
        },

        async stopInstance(instanceId: string): Promise<void> {
            await client.send(new StopInstancesCommand({InstanceIds: [instanceId]}))
        },

        async rebootInstance(instanceId: string): Promise<void> {
            await client.send(new RebootInstancesCommand({InstanceIds: [instanceId]}))
        },

        async terminateInstance(instanceId: string): Promise<void> {
            await client.send(new TerminateInstancesCommand({InstanceIds: [instanceId]}))
        },

        async updateInstanceTags(instanceId: string, toAdd: Ec2Tag[], toRemove: string[]): Promise<void> {
            if (toAdd.length > 0) {
                await client.send(new CreateTagsCommand({
                    Resources: [instanceId],
                    Tags: toAdd.map((t) => ({Key: t.key, Value: t.value})),
                }))
            }
            if (toRemove.length > 0) {
                await client.send(new DeleteTagsCommand({
                    Resources: [instanceId],
                    Tags: toRemove.map((k) => ({Key: k})),
                }))
            }
        },

        async createImage(input: CreateAmiInput): Promise<{imageId: string}> {
            const res = await client.send(new CreateImageCommand({
                InstanceId: input.instanceId,
                Name: input.name,
                Description: input.description,
                NoReboot: input.noReboot,
            }))
            return {imageId: res.ImageId ?? ''}
        },

        async deregisterImage(imageId: string): Promise<void> {
            await client.send(new DeregisterImageCommand({ImageId: imageId}))
        },

        async listAmis(): Promise<Ec2Image[]> {
            try {
                const res = await client.send(new DescribeImagesCommand({}))
                return (res.Images ?? []).map(toEc2Image)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async getConsoleOutput(instanceId: string): Promise<Ec2ConsoleOutput> {
            try {
                const res = await client.send(new GetConsoleOutputCommand({InstanceId: instanceId}))
                const decoded = res.Output ? Buffer.from(res.Output, 'base64').toString('utf-8') : ''
                return {instanceId, output: decoded, timestamp: res.Timestamp?.toISOString()}
            } catch (error) {
                if (isUnsupportedOperation(error)) return {instanceId, output: ''}
                throw error
            }
        },

        async listKeyPairs(): Promise<Ec2KeyPair[]> {
            try {
                const res = await client.send(new DescribeKeyPairsCommand({}))
                return (res.KeyPairs ?? []).map(toEc2KeyPair)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async createKeyPair(name: string): Promise<Ec2KeyPairMaterial> {
            const res = await client.send(new CreateKeyPairCommand({KeyName: name}))
            return {
                keyPairId: res.KeyPairId ?? '',
                keyName: res.KeyName ?? name,
                keyMaterial: res.KeyMaterial ?? '',
            }
        },

        async deleteKeyPair(keyName: string): Promise<void> {
            await client.send(new DeleteKeyPairCommand({KeyName: keyName}))
        },

        async listSecurityGroups(vpcId?: string): Promise<Ec2SecurityGroup[]> {
            try {
                const res = await client.send(new DescribeSecurityGroupsCommand({
                    Filters: vpcId ? [{Name: 'vpc-id', Values: [vpcId]}] : undefined,
                }))
                return (res.SecurityGroups ?? []).map(toEc2SecurityGroup)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async createSecurityGroup(name: string, description: string, vpcId: string): Promise<{groupId: string}> {
            const res = await client.send(new CreateSecurityGroupCommand({
                GroupName: name,
                Description: description,
                VpcId: vpcId,
            }))
            return {groupId: res.GroupId ?? ''}
        },

        async deleteSecurityGroup(groupId: string): Promise<void> {
            await client.send(new DeleteSecurityGroupCommand({GroupId: groupId}))
        },

        async authorizeSecurityGroupIngress(groupId: string, permission: IpPermissionInput): Promise<void> {
            await client.send(new AuthorizeSecurityGroupIngressCommand({
                GroupId: groupId,
                IpPermissions: [{
                    IpProtocol: permission.protocol,
                    FromPort: permission.fromPort,
                    ToPort: permission.toPort,
                    IpRanges: [{CidrIp: permission.cidr}],
                }],
            }))
        },

        async revokeSecurityGroupIngress(groupId: string, permission: IpPermissionInput): Promise<void> {
            await client.send(new RevokeSecurityGroupIngressCommand({
                GroupId: groupId,
                IpPermissions: [{
                    IpProtocol: permission.protocol,
                    FromPort: permission.fromPort,
                    ToPort: permission.toPort,
                    IpRanges: [{CidrIp: permission.cidr}],
                }],
            }))
        },

        async authorizeSecurityGroupEgress(groupId: string, permission: IpPermissionInput): Promise<void> {
            await client.send(new AuthorizeSecurityGroupEgressCommand({
                GroupId: groupId,
                IpPermissions: [{
                    IpProtocol: permission.protocol,
                    FromPort: permission.fromPort,
                    ToPort: permission.toPort,
                    IpRanges: [{CidrIp: permission.cidr}],
                }],
            }))
        },

        async revokeSecurityGroupEgress(groupId: string, permission: IpPermissionInput): Promise<void> {
            await client.send(new RevokeSecurityGroupEgressCommand({
                GroupId: groupId,
                IpPermissions: [{
                    IpProtocol: permission.protocol,
                    FromPort: permission.fromPort,
                    ToPort: permission.toPort,
                    IpRanges: [{CidrIp: permission.cidr}],
                }],
            }))
        },

        async listAvailabilityZones(): Promise<Ec2AvailabilityZone[]> {
            try {
                const res = await client.send(new DescribeAvailabilityZonesCommand({}))
                return (res.AvailabilityZones ?? []).map((az) => ({
                    zoneName: az.ZoneName ?? '',
                    zoneId: az.ZoneId ?? '',
                    state: az.State ?? 'available',
                }))
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async listInstanceTypes(): Promise<Ec2InstanceType[]> {
            try {
                const res = await client.send(new DescribeInstanceTypesCommand({}))
                return (res.InstanceTypes ?? []).map((it) => ({
                    instanceType: it.InstanceType ?? '',
                    vcpu: it.VCpuInfo?.DefaultVCpus ?? 0,
                    memoryMiB: it.MemoryInfo?.SizeInMiB ?? 0,
                }))
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async modifySubnetMapPublicIp(subnetId: string, mapPublicIpOnLaunch: boolean): Promise<void> {
            await client.send(new ModifySubnetAttributeCommand({
                SubnetId: subnetId,
                MapPublicIpOnLaunch: {Value: mapPublicIpOnLaunch},
            }))
        },

        async getVpcAttributes(vpcId: string): Promise<Ec2VpcAttributes> {
            const [hostnamesRes, supportRes] = await Promise.all([
                client.send(new DescribeVpcAttributeCommand({VpcId: vpcId, Attribute: 'enableDnsHostnames'})),
                client.send(new DescribeVpcAttributeCommand({VpcId: vpcId, Attribute: 'enableDnsSupport'})),
            ])
            return {
                enableDnsHostnames: hostnamesRes.EnableDnsHostnames?.Value ?? false,
                enableDnsSupport: supportRes.EnableDnsSupport?.Value ?? false,
            }
        },

        async modifyVpcAttribute(vpcId: string, attribute: 'enableDnsHostnames' | 'enableDnsSupport', value: boolean): Promise<void> {
            const cmd = attribute === 'enableDnsHostnames'
                ? new ModifyVpcAttributeCommand({VpcId: vpcId, EnableDnsHostnames: {Value: value}})
                : new ModifyVpcAttributeCommand({VpcId: vpcId, EnableDnsSupport: {Value: value}})
            await client.send(cmd)
        },

        async associateElasticIp(allocationId: string, instanceId: string): Promise<{associationId: string}> {
            const res = await client.send(new AssociateAddressCommand({AllocationId: allocationId, InstanceId: instanceId}))
            return {associationId: res.AssociationId ?? ''}
        },

        async disassociateElasticIp(associationId: string): Promise<void> {
            await client.send(new DisassociateAddressCommand({AssociationId: associationId}))
        },

        async listVpcs(): Promise<Ec2Vpc[]> {
            try {
                const res = await client.send(new DescribeVpcsCommand({}))
                return (res.Vpcs ?? []).map(toEc2Vpc)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async createVpc(cidrBlock: string): Promise<Ec2Vpc> {
            const res = await client.send(new CreateVpcCommand({CidrBlock: cidrBlock}))
            return toEc2Vpc(res.Vpc ?? {})
        },

        async deleteVpc(vpcId: string): Promise<void> {
            const vpcFilter = [{Name: 'vpc-id', Values: [vpcId]}]

            // 1. Delete non-default security groups
            try {
                const sgsRes = await client.send(new DescribeSecurityGroupsCommand({Filters: vpcFilter}))
                for (const sg of sgsRes.SecurityGroups ?? []) {
                    if (sg.GroupName !== 'default' && sg.GroupId) {
                        try { await client.send(new DeleteSecurityGroupCommand({GroupId: sg.GroupId})) } catch { /* skip */ }
                    }
                }
            } catch (error) { if (!isUnsupportedOperation(error)) throw error }

            // 2. Delete subnets
            try {
                const subnetsRes = await client.send(new DescribeSubnetsCommand({Filters: vpcFilter}))
                for (const subnet of subnetsRes.Subnets ?? []) {
                    if (subnet.SubnetId) {
                        try { await client.send(new DeleteSubnetCommand({SubnetId: subnet.SubnetId})) } catch { /* skip */ }
                    }
                }
            } catch (error) { if (!isUnsupportedOperation(error)) throw error }

            // 3. Detach and delete internet gateways
            try {
                const igwRes = await client.send(new DescribeInternetGatewaysCommand({Filters: [{Name: 'attachment.vpc-id', Values: [vpcId]}]}))
                for (const igw of igwRes.InternetGateways ?? []) {
                    if (!igw.InternetGatewayId) continue
                    for (const att of igw.Attachments ?? []) {
                        if (att.VpcId) {
                            try { await client.send(new DetachInternetGatewayCommand({InternetGatewayId: igw.InternetGatewayId, VpcId: att.VpcId})) } catch { /* skip */ }
                        }
                    }
                    try { await client.send(new DeleteInternetGatewayCommand({InternetGatewayId: igw.InternetGatewayId})) } catch { /* skip */ }
                }
            } catch (error) { if (!isUnsupportedOperation(error)) throw error }

            // 4. Disassociate and delete non-main route tables
            try {
                const rtbRes = await client.send(new DescribeRouteTablesCommand({Filters: vpcFilter}))
                for (const rt of rtbRes.RouteTables ?? []) {
                    if (!rt.RouteTableId) continue
                    const isMain = (rt.Associations ?? []).some((a) => a.Main)
                    if (isMain) continue
                    for (const assoc of rt.Associations ?? []) {
                        if (!assoc.Main && assoc.RouteTableAssociationId) {
                            try { await client.send(new DisassociateRouteTableCommand({AssociationId: assoc.RouteTableAssociationId})) } catch { /* skip */ }
                        }
                    }
                    try { await client.send(new DeleteRouteTableCommand({RouteTableId: rt.RouteTableId})) } catch { /* skip */ }
                }
            } catch (error) { if (!isUnsupportedOperation(error)) throw error }

            // 5. Delete the VPC
            await client.send(new DeleteVpcCommand({VpcId: vpcId}))
        },

        async listSubnets(vpcId?: string): Promise<Ec2Subnet[]> {
            try {
                const res = await client.send(new DescribeSubnetsCommand({
                    Filters: vpcId ? [{Name: 'vpc-id', Values: [vpcId]}] : undefined,
                }))
                return (res.Subnets ?? []).map(toEc2Subnet)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async createSubnet(vpcId: string, cidrBlock: string, availabilityZone?: string): Promise<Ec2Subnet> {
            const res = await client.send(new CreateSubnetCommand({
                VpcId: vpcId,
                CidrBlock: cidrBlock,
                AvailabilityZone: availabilityZone || undefined,
            }))
            return toEc2Subnet(res.Subnet ?? {})
        },

        async deleteSubnet(subnetId: string): Promise<void> {
            await client.send(new DeleteSubnetCommand({SubnetId: subnetId}))
        },

        // ── Internet Gateways ──────────────────────────────────────────────────

        async listInternetGateways(): Promise<Ec2InternetGateway[]> {
            try {
                const res = await client.send(new DescribeInternetGatewaysCommand({}))
                return (res.InternetGateways ?? []).map(toEc2InternetGateway)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async createInternetGateway(name?: string): Promise<Ec2InternetGateway> {
            const res = await client.send(new CreateInternetGatewayCommand({}))
            const igw = res.InternetGateway ?? {}
            if (name && igw.InternetGatewayId) {
                await client.send(new CreateTagsCommand({
                    Resources: [igw.InternetGatewayId],
                    Tags: [{Key: 'Name', Value: name}],
                }))
                igw.Tags = [{Key: 'Name', Value: name}]
            }
            return toEc2InternetGateway(igw)
        },

        async attachInternetGateway(igwId: string, vpcId: string): Promise<void> {
            await client.send(new AttachInternetGatewayCommand({InternetGatewayId: igwId, VpcId: vpcId}))
        },

        async detachInternetGateway(igwId: string, vpcId: string): Promise<void> {
            await client.send(new DetachInternetGatewayCommand({InternetGatewayId: igwId, VpcId: vpcId}))
        },

        async deleteInternetGateway(igwId: string): Promise<void> {
            // Auto-detach from any attached VPCs before deleting
            const res = await client.send(new DescribeInternetGatewaysCommand({InternetGatewayIds: [igwId]}))
            const attachments = res.InternetGateways?.[0]?.Attachments ?? []
            for (const attachment of attachments) {
                if (attachment.VpcId) {
                    await client.send(new DetachInternetGatewayCommand({InternetGatewayId: igwId, VpcId: attachment.VpcId}))
                }
            }
            await client.send(new DeleteInternetGatewayCommand({InternetGatewayId: igwId}))
        },

        // ── NAT Gateways ───────────────────────────────────────────────────────

        async listNatGateways(vpcId?: string): Promise<Ec2NatGateway[]> {
            try {
                const res = await client.send(new DescribeNatGatewaysCommand({
                    Filter: vpcId ? [{Name: 'vpc-id', Values: [vpcId]}] : undefined,
                }))
                return (res.NatGateways ?? []).filter((n) => n.State !== 'deleted').map(toEc2NatGateway)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async createNatGateway(input: CreateNatGatewayInput): Promise<Ec2NatGateway> {
            let allocationId = input.allocationId
            if (!allocationId) {
                const eipRes = await client.send(new AllocateAddressCommand({Domain: 'vpc'}))
                allocationId = eipRes.AllocationId!
            }
            const natRes = await client.send(new CreateNatGatewayCommand({
                SubnetId: input.subnetId,
                AllocationId: allocationId,
                ConnectivityType: 'public',
            }))
            const natId = natRes.NatGateway!.NatGatewayId!
            if (input.name) {
                await client.send(new CreateTagsCommand({Resources: [natId], Tags: [{Key: 'Name', Value: input.name}]}))
            }
            // Poll until available
            for (let attempt = 0; attempt < 15; attempt++) {
                const st = await client.send(new DescribeNatGatewaysCommand({NatGatewayIds: [natId]}))
                const nat = st.NatGateways?.[0]
                if (nat?.State === 'available') return toEc2NatGateway(nat)
                if (nat?.State === 'failed') throw new Error(`NAT Gateway ${natId} failed to become available`)
                await new Promise((r) => setTimeout(r, 1000))
            }
            // Return last known state after polling
            const final = await client.send(new DescribeNatGatewaysCommand({NatGatewayIds: [natId]}))
            return toEc2NatGateway(final.NatGateways?.[0] ?? {NatGatewayId: natId, SubnetId: input.subnetId})
        },

        async deleteNatGateway(natId: string): Promise<void> {
            await client.send(new DeleteNatGatewayCommand({NatGatewayId: natId}))
            // Poll until deleted
            for (let attempt = 0; attempt < 15; attempt++) {
                const st = await client.send(new DescribeNatGatewaysCommand({NatGatewayIds: [natId]}))
                const state = st.NatGateways?.[0]?.State
                if (!state || state === 'deleted') return
                if (state === 'failed') throw new Error(`NAT Gateway ${natId} deletion failed`)
                await new Promise((r) => setTimeout(r, 1000))
            }
        },

        // ── Route Tables ───────────────────────────────────────────────────────

        async listRouteTables(vpcId?: string): Promise<Ec2RouteTable[]> {
            try {
                const res = await client.send(new DescribeRouteTablesCommand({
                    Filters: vpcId ? [{Name: 'vpc-id', Values: [vpcId]}] : undefined,
                }))
                return (res.RouteTables ?? []).map(toEc2RouteTable)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async createRouteTable(vpcId: string, name?: string): Promise<Ec2RouteTable> {
            const res = await client.send(new CreateRouteTableCommand({VpcId: vpcId}))
            const rt = res.RouteTable ?? {}
            if (name && rt.RouteTableId) {
                await client.send(new CreateTagsCommand({
                    Resources: [rt.RouteTableId],
                    Tags: [{Key: 'Name', Value: name}],
                }))
                rt.Tags = [{Key: 'Name', Value: name}]
            }
            return toEc2RouteTable(rt)
        },

        async deleteRouteTable(rtbId: string): Promise<void> {
            // Describe first to check associations and main flag
            const res = await client.send(new DescribeRouteTablesCommand({RouteTableIds: [rtbId]}))
            const rt = res.RouteTables?.[0]
            if (!rt) throw new Error(`Route table ${rtbId} not found`)
            const isMain = (rt.Associations ?? []).some((a) => a.Main)
            if (isMain) throw new Error(`Cannot delete the main route table ${rtbId}. Detach subnets and update the VPC's main route table first.`)
            // Disassociate all non-main associations
            for (const assoc of rt.Associations ?? []) {
                if (!assoc.Main && assoc.RouteTableAssociationId) {
                    await client.send(new DisassociateRouteTableCommand({AssociationId: assoc.RouteTableAssociationId}))
                }
            }
            await client.send(new DeleteRouteTableCommand({RouteTableId: rtbId}))
        },

        async createRoute(rtbId: string, input: CreateRouteInput): Promise<void> {
            await client.send(new CreateRouteCommand({
                RouteTableId: rtbId,
                DestinationCidrBlock: input.destinationCidrBlock,
                GatewayId: input.gatewayId || undefined,
                NatGatewayId: input.natGatewayId || undefined,
                VpcPeeringConnectionId: input.vpcPeeringConnectionId || undefined,
            }))
        },

        async deleteRoute(rtbId: string, destinationCidr: string): Promise<void> {
            await client.send(new DeleteRouteCommand({
                RouteTableId: rtbId,
                DestinationCidrBlock: destinationCidr,
            }))
        },

        async associateRouteTable(rtbId: string, subnetId: string): Promise<string> {
            const res = await client.send(new AssociateRouteTableCommand({
                RouteTableId: rtbId,
                SubnetId: subnetId,
            }))
            return res.AssociationId ?? ''
        },

        async disassociateRouteTable(associationId: string): Promise<void> {
            await client.send(new DisassociateRouteTableCommand({AssociationId: associationId}))
        },

        // ── Elastic IPs ────────────────────────────────────────────────────────

        async listElasticIps(): Promise<Ec2ElasticIp[]> {
            try {
                const res = await client.send(new DescribeAddressesCommand({}))
                return (res.Addresses ?? []).map(toEc2ElasticIp)
            } catch (error) {
                if (isUnsupportedOperation(error)) return []
                throw error
            }
        },

        async allocateElasticIp(name?: string): Promise<Ec2ElasticIp> {
            const res = await client.send(new AllocateAddressCommand({Domain: 'vpc'}))
            const allocationId = res.AllocationId ?? ''
            if (name && allocationId) {
                await client.send(new CreateTagsCommand({Resources: [allocationId], Tags: [{Key: 'Name', Value: name}]}))
            }
            return {
                allocationId,
                publicIp: res.PublicIp ?? '',
                domain: res.Domain,
                tags: name ? [{key: 'Name', value: name}] : [],
            }
        },

        async releaseElasticIp(allocationId: string): Promise<void> {
            await client.send(new ReleaseAddressCommand({AllocationId: allocationId}))
        },

        async createVpcWizard(input: VpcWizardInput): Promise<VpcWizardResult> {
            const {name, cidrBlock, subnetGroups, natGateway, availabilityZone} = input
            const groupCidrs = calculateSubnetCidrs(cidrBlock, subnetGroups)

            // 1. VPC
            const vpcRes = await client.send(new CreateVpcCommand({CidrBlock: cidrBlock}))
            const vpcId = vpcRes.Vpc!.VpcId!
            await client.send(new CreateTagsCommand({Resources: [vpcId], Tags: [{Key: 'Name', Value: name}]}))

            // 2. Internet Gateway
            const igwRes = await client.send(new CreateInternetGatewayCommand({}))
            const igwId = igwRes.InternetGateway!.InternetGatewayId!
            await client.send(new CreateTagsCommand({Resources: [igwId], Tags: [{Key: 'Name', Value: `${name}-igw`}]}))
            await client.send(new AttachInternetGatewayCommand({InternetGatewayId: igwId, VpcId: vpcId}))

            // 3. Create subnets per group
            const createdGroups: Array<{name: string; isPublic: boolean; subnetIds: string[]}> = []
            for (let gi = 0; gi < subnetGroups.length; gi++) {
                const group = subnetGroups[gi]
                const subnetIds: string[] = []
                for (let i = 0; i < group.count; i++) {
                    const res = await client.send(new CreateSubnetCommand({
                        VpcId: vpcId, CidrBlock: groupCidrs[gi][i],
                        AvailabilityZone: group.az || availabilityZone || undefined,
                    }))
                    const sid = res.Subnet!.SubnetId!
                    await client.send(new CreateTagsCommand({Resources: [sid], Tags: [{Key: 'Name', Value: `${name}-${group.name}-${i + 1}`}]}))
                    subnetIds.push(sid)
                }
                createdGroups.push({name: group.name, isPublic: group.isPublic, subnetIds})
            }

            const publicSubnetIds = createdGroups.filter((g) => g.isPublic).flatMap((g) => g.subnetIds)
            const privateSubnetIds = createdGroups.filter((g) => !g.isPublic).flatMap((g) => g.subnetIds)

            // 4. Public route table → 0.0.0.0/0 → IGW (if any public subnets)
            const pubRtRes = await client.send(new CreateRouteTableCommand({VpcId: vpcId}))
            const publicRtbId = pubRtRes.RouteTable!.RouteTableId!
            await client.send(new CreateTagsCommand({Resources: [publicRtbId], Tags: [{Key: 'Name', Value: `${name}-pub-rtb`}]}))
            if (publicSubnetIds.length > 0) {
                await client.send(new CreateRouteCommand({RouteTableId: publicRtbId, DestinationCidrBlock: '0.0.0.0/0', GatewayId: igwId}))
                for (const sid of publicSubnetIds) {
                    await client.send(new AssociateRouteTableCommand({RouteTableId: publicRtbId, SubnetId: sid}))
                }
            }

            // 5. NAT Gateway + private route table (if any private subnets and NAT requested)
            // NAT Gateway is skipped silently when not supported (e.g. LocalStack free tier).
            let natGatewayId: string | undefined
            let eipAllocationId: string | undefined
            let privateRtbId: string | undefined

            if (natGateway && privateSubnetIds.length > 0 && publicSubnetIds.length > 0) {
                try {
                    const eipRes = await client.send(new AllocateAddressCommand({Domain: 'vpc'}))
                    eipAllocationId = eipRes.AllocationId!

                    const natRes = await client.send(new CreateNatGatewayCommand({
                        SubnetId: publicSubnetIds[0], AllocationId: eipAllocationId, ConnectivityType: 'public',
                    }))
                    natGatewayId = natRes.NatGateway!.NatGatewayId!
                    await client.send(new CreateTagsCommand({Resources: [natGatewayId], Tags: [{Key: 'Name', Value: `${name}-nat`}]}))

                    // Poll until available
                    for (let attempt = 0; attempt < 15; attempt++) {
                        const st = await client.send(new DescribeNatGatewaysCommand({NatGatewayIds: [natGatewayId]}))
                        const state = st.NatGateways?.[0]?.State
                        if (state === 'available') break
                        if (state === 'failed') throw new Error(`NAT Gateway ${natGatewayId} failed to become available`)
                        await new Promise((r) => setTimeout(r, 1000))
                    }

                    const privRtRes = await client.send(new CreateRouteTableCommand({VpcId: vpcId}))
                    privateRtbId = privRtRes.RouteTable!.RouteTableId!
                    await client.send(new CreateTagsCommand({Resources: [privateRtbId], Tags: [{Key: 'Name', Value: `${name}-pri-rtb`}]}))
                    await client.send(new CreateRouteCommand({RouteTableId: privateRtbId, DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: natGatewayId}))
                    for (const sid of privateSubnetIds) {
                        await client.send(new AssociateRouteTableCommand({RouteTableId: privateRtbId, SubnetId: sid}))
                    }
                } catch (err) {
                    if (!isUnsupportedOperation(err)) throw err
                    // Not supported (e.g. LocalStack) — skip NAT GW silently
                    natGatewayId = undefined
                    eipAllocationId = undefined
                }
            }

            return {
                vpcId, igwId,
                publicSubnetIds, privateSubnetIds,
                subnetGroups: createdGroups,
                natGatewayId, eipAllocationId,
                publicRouteTableId: publicRtbId, privateRouteTableId: privateRtbId,
            }
        },
    }
}

// ─── VPC Wizard types and CIDR helpers ───────────────────────────────────────

export type SubnetGroup = {
    /** User-defined group name, e.g. "public", "private-app", "dmz". */
    name: string
    /** Number of subnets in this group (1–4). */
    count: number
    /** true → IGW route (public); false → NAT GW route (private). */
    isPublic: boolean
    /** Optional AZ override for subnets in this group, e.g. "us-east-1a". */
    az?: string
    /** Subnet prefix length override, e.g. 24 for /24. Defaults to min(vpcPrefix+4, 28). */
    prefix?: number
}

export type VpcWizardInput = {
    name: string
    cidrBlock: string
    subnetGroups: SubnetGroup[]
    natGateway: boolean
    availabilityZone?: string
}

export type VpcWizardResult = {
    vpcId: string
    igwId: string
    /** Flat list of all public-type subnet IDs (backward compat). */
    publicSubnetIds: string[]
    /** Flat list of all private-type subnet IDs (backward compat). */
    privateSubnetIds: string[]
    /** Named group breakdown with the subnets that belong to each. */
    subnetGroups: Array<{name: string; isPublic: boolean; subnetIds: string[]}>
    natGatewayId?: string
    eipAllocationId?: string
    publicRouteTableId: string
    privateRouteTableId?: string
}

/**
 * Allocates non-overlapping subnet CIDRs across named groups sequentially.
 * Each group gets `group.count` contiguous subnets. If `group.prefix` is set it is used
 * as the subnet prefix; otherwise defaults to min(vpcPrefix+4, 28). Groups with different
 * prefixes are laid out sequentially without gaps.
 */
export function calculateSubnetCidrs(
    vpcCidr: string,
    groups: SubnetGroup[],
): string[][] {
    const m = vpcCidr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/)
    if (!m) throw new Error(`Invalid VPC CIDR: ${vpcCidr}`)

    const vpcBase = Number(m[1]) * 16777216 + Number(m[2]) * 65536 + Number(m[3]) * 256 + Number(m[4])
    const vpcPrefix = Number(m[5])
    const defaultPrefix = Math.min(vpcPrefix + 4, 28)

    function baseToCidr(base: number, prefix: number): string {
        return `${Math.floor(base / 16777216)}.${Math.floor((base % 16777216) / 65536)}.${Math.floor((base % 65536) / 256)}.${base % 256}/${prefix}`
    }

    let currentBase = vpcBase
    return groups.map((g) => {
        const prefix = g.prefix ?? defaultPrefix
        const size = Math.pow(2, 32 - prefix)
        const cidrs = Array.from({length: g.count}, (_, i) => baseToCidr(currentBase + i * size, prefix))
        currentBase += g.count * size
        return cidrs
    })
}

export const ec2Service = createEc2Service()
