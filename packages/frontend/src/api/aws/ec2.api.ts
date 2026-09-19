import { apiClient, apiEndpointKeys } from "@/api/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Ec2Tag = {
  key: string;
  value: string;
};

export type Ec2SecurityGroupRef = {
  id?: string;
  name?: string;
};

export type Ec2IpPermission = {
  protocol: string;
  fromPort: number | null;
  toPort: number | null;
  ipRanges: string[];
  ipv6Ranges: string[];
};

export type Ec2SecurityGroup = {
  groupId: string;
  groupName: string;
  description: string;
  vpcId?: string;
  inboundRules: Ec2IpPermission[];
  outboundRules: Ec2IpPermission[];
  tags: Ec2Tag[];
};

export type Ec2Image = {
  imageId: string;
  name: string;
  description?: string;
  state?: string;
  architecture?: string;
  platform?: string;
  virtualizationType?: string;
  rootDeviceType?: string;
  createdAt?: string;
  ownerId?: string;
  public?: boolean;
  tags: Ec2Tag[];
};

export type Ec2Instance = {
  instanceId: string;
  name: string;
  state?: string;
  instanceType?: string;
  availabilityZone?: string;
  publicIpAddress?: string;
  privateIpAddress?: string;
  vpcId?: string;
  subnetId?: string;
  imageId?: string;
  keyName?: string;
  launchTime?: string;
  architecture?: string;
  platform?: string;
  securityGroups: Ec2SecurityGroupRef[];
  tags: Ec2Tag[];
};

export type Ec2KeyPair = {
  keyPairId: string;
  keyName: string;
  keyFingerprint?: string;
  tags: Ec2Tag[];
};

export type Ec2KeyPairMaterial = {
  keyPairId: string;
  keyName: string;
  keyMaterial: string;
};

export type Ec2Vpc = {
  vpcId: string;
  cidrBlock: string;
  state?: string;
  isDefault: boolean;
  tags: Ec2Tag[];
};

export type Ec2Subnet = {
  subnetId: string;
  vpcId: string;
  cidrBlock: string;
  availabilityZone: string;
  availableIpAddressCount?: number;
  mapPublicIpOnLaunch: boolean;
  state?: string;
  tags: Ec2Tag[];
};

export type Ec2AvailabilityZone = {
  zoneName: string;
  zoneId: string;
  state: string;
};

export type Ec2InstanceType = {
  instanceType: string;
  vcpu: number;
  memoryMiB: number;
};

export type Ec2VpcAttributes = {
  enableDnsHostnames: boolean;
  enableDnsSupport: boolean;
};

export type Ec2ConsoleOutput = {
  instanceId: string;
  output: string;
  timestamp?: string;
};

export type RunEc2InstanceInput = {
  name: string;
  imageId: string;
  instanceType: string;
  keyName?: string;
  subnetId?: string;
  securityGroupIds?: string[];
  userData?: string;
  iamInstanceProfileName?: string;
  associatePublicIpAddress?: boolean;
  rootVolumeSize?: number;
  rootVolumeType?: string;
};

export type CreateAmiInput = {
  name: string;
  description?: string;
  noReboot?: boolean;
};

export type IpPermissionInput = {
  protocol: string;
  fromPort: number;
  toPort: number;
  cidr: string;
};

export type SubnetGroup = {
  name: string;
  count: number;
  isPublic: boolean;
  az?: string;
  prefix?: number;
};

export type VpcWizardInput = {
  name: string;
  cidrBlock: string;
  subnetGroups: SubnetGroup[];
  natGateway: boolean;
  availabilityZone?: string;
};

export type VpcWizardResult = {
  vpcId: string;
  igwId: string;
  publicSubnetIds: string[];
  privateSubnetIds: string[];
  subnetGroups: Array<{ name: string; isPublic: boolean; subnetIds: string[] }>;
  natGatewayId?: string;
  eipAllocationId?: string;
  publicRouteTableId: string;
  privateRouteTableId?: string;
};

export type Ec2InternetGateway = {
  internetGatewayId: string;
  attachments: Array<{ vpcId: string; state: string }>;
  tags: Ec2Tag[];
};

export type Ec2NatGateway = {
  natGatewayId: string;
  subnetId: string;
  vpcId: string;
  state?: string;
  publicIp?: string;
  privateIp?: string;
  eipAllocationId?: string;
  tags: Ec2Tag[];
};

export type Ec2Route = {
  destinationCidrBlock?: string;
  gatewayId?: string;
  natGatewayId?: string;
  vpcPeeringConnectionId?: string;
  state?: string;
  origin?: string;
};

export type Ec2RouteTableAssociation = {
  associationId: string;
  subnetId?: string;
  isMain: boolean;
};

export type Ec2RouteTable = {
  routeTableId: string;
  vpcId: string;
  routes: Ec2Route[];
  associations: Ec2RouteTableAssociation[];
  tags: Ec2Tag[];
};

export type Ec2ElasticIp = {
  allocationId: string;
  publicIp: string;
  domain?: string;
  associationId?: string;
  instanceId?: string;
  networkInterfaceId?: string;
  tags: Ec2Tag[];
};

export type CreateNatGatewayInput = {
  name?: string;
  subnetId: string;
  allocationId?: string;
};

export type CreateRouteInput = {
  destinationCidrBlock: string;
  gatewayId?: string;
  natGatewayId?: string;
  vpcPeeringConnectionId?: string;
};

export type ResourceSummary = {
  id: string;
  name: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

// ─── Functions ────────────────────────────────────────────────────────────────

export async function listEc2Instances(signal?: AbortSignal): Promise<Ec2Instance[]> {
  const res = await apiClient.call<Ec2Instance[]>(apiEndpointKeys.aws.ec2.instances.list, { signal });
  return res.data;
}

export async function describeEc2Instance(instanceId: string, signal?: AbortSignal): Promise<Ec2Instance> {
  const res = await apiClient.call<Ec2Instance>(
    apiEndpointKeys.aws.ec2.instances.describe,
    { signal },
    { instanceId },
  );
  return res.data;
}

export async function runEc2Instance(input: RunEc2InstanceInput): Promise<Ec2Instance> {
  const res = await apiClient.call<Ec2Instance>(
    apiEndpointKeys.aws.ec2.instances.create,
    { body: JSON.stringify(input), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function startEc2Instance(instanceId: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.instances.start,
    { body: "{}", headers: { "content-type": "application/json" } },
    { instanceId },
  );
}

export async function stopEc2Instance(instanceId: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.instances.stop,
    { body: "{}", headers: { "content-type": "application/json" } },
    { instanceId },
  );
}

export async function rebootEc2Instance(instanceId: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.instances.reboot,
    { body: "{}", headers: { "content-type": "application/json" } },
    { instanceId },
  );
}

export async function terminateEc2Instance(instanceId: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.instances.terminate,
    {},
    { instanceId },
  );
}

export async function updateEc2InstanceTags(
  instanceId: string,
  toAdd: Ec2Tag[],
  toRemove: string[],
): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.instances.tags,
    { body: JSON.stringify({ toAdd, toRemove }), headers: { "content-type": "application/json" } },
    { instanceId },
  );
}

export async function createEc2Ami(instanceId: string, input: CreateAmiInput): Promise<{ imageId: string }> {
  const res = await apiClient.call<{ imageId: string }>(
    apiEndpointKeys.aws.ec2.instances.createImage,
    { body: JSON.stringify(input), headers: { "content-type": "application/json" } },
    { instanceId },
  );
  return res.data;
}

export async function getEc2ConsoleOutput(instanceId: string, signal?: AbortSignal): Promise<Ec2ConsoleOutput> {
  const res = await apiClient.call<Ec2ConsoleOutput>(
    apiEndpointKeys.aws.ec2.instances.console,
    { signal },
    { instanceId },
  );
  return res.data;
}

export async function listEc2Amis(signal?: AbortSignal): Promise<Ec2Image[]> {
  const res = await apiClient.call<Ec2Image[]>(apiEndpointKeys.aws.ec2.amis.list, { signal });
  return res.data;
}

export async function deregisterEc2Ami(imageId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.amis.deregister, {}, { imageId });
}

export async function listEc2KeyPairs(signal?: AbortSignal): Promise<Ec2KeyPair[]> {
  const res = await apiClient.call<Ec2KeyPair[]>(apiEndpointKeys.aws.ec2.keyPairs.list, { signal });
  return res.data;
}

export async function createEc2KeyPair(name: string): Promise<Ec2KeyPairMaterial> {
  const res = await apiClient.call<Ec2KeyPairMaterial>(
    apiEndpointKeys.aws.ec2.keyPairs.create,
    { body: JSON.stringify({ name }), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function deleteEc2KeyPair(name: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.keyPairs.delete, {}, { name });
}

export async function listEc2SecurityGroups(vpcId?: string, signal?: AbortSignal): Promise<Ec2SecurityGroup[]> {
  const res = await apiClient.call<Ec2SecurityGroup[]>(
    apiEndpointKeys.aws.ec2.securityGroups.list,
    { params: { vpcId }, signal },
  );
  return res.data;
}

export async function createEc2SecurityGroup(
  name: string,
  description: string,
  vpcId?: string,
): Promise<{ groupId: string }> {
  const res = await apiClient.call<
    { groupId: string },
    { name: string; description: string; vpcId?: string }
  >(
    apiEndpointKeys.aws.ec2.securityGroups.create,
    { body: { name, description, vpcId } },
  );
  return res.data;
}

export async function deleteEc2SecurityGroup(groupId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.securityGroups.delete, {}, { groupId });
}

export async function authorizeEc2SecurityGroupIngress(
  groupId: string,
  permission: IpPermissionInput,
): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.securityGroups.authorize,
    { body: JSON.stringify(permission), headers: { "content-type": "application/json" } },
    { groupId },
  );
}

export async function revokeEc2SecurityGroupIngress(
  groupId: string,
  permission: IpPermissionInput,
): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.securityGroups.revoke,
    { body: JSON.stringify(permission), headers: { "content-type": "application/json" } },
    { groupId },
  );
}

export async function authorizeEc2SecurityGroupEgress(
  groupId: string,
  permission: IpPermissionInput,
): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.securityGroups.authorizeEgress,
    { body: JSON.stringify(permission), headers: { "content-type": "application/json" } },
    { groupId },
  );
}

export async function revokeEc2SecurityGroupEgress(
  groupId: string,
  permission: IpPermissionInput,
): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.securityGroups.revokeEgress,
    { body: JSON.stringify(permission), headers: { "content-type": "application/json" } },
    { groupId },
  );
}

export async function listEc2AvailabilityZones(signal?: AbortSignal): Promise<Ec2AvailabilityZone[]> {
  const res = await apiClient.call<Ec2AvailabilityZone[]>(apiEndpointKeys.aws.ec2.availabilityZones, { signal });
  return res.data;
}

export async function listEc2InstanceTypes(signal?: AbortSignal): Promise<Ec2InstanceType[]> {
  const res = await apiClient.call<Ec2InstanceType[]>(apiEndpointKeys.aws.ec2.instanceTypes, { signal });
  return res.data;
}

export async function modifyEc2SubnetAttribute(subnetId: string, mapPublicIpOnLaunch: boolean): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.subnets.modifyAttribute,
    { body: JSON.stringify({ mapPublicIpOnLaunch }), headers: { "content-type": "application/json" } },
    { subnetId },
  );
}

export async function getEc2VpcAttributes(vpcId: string, signal?: AbortSignal): Promise<Ec2VpcAttributes> {
  const res = await apiClient.call<Ec2VpcAttributes>(
    apiEndpointKeys.aws.ec2.vpcs.getAttributes,
    { signal },
    { vpcId },
  );
  return res.data;
}

export async function modifyEc2VpcAttribute(
  vpcId: string,
  attribute: "enableDnsHostnames" | "enableDnsSupport",
  value: boolean,
): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.vpcs.modifyAttribute,
    { body: JSON.stringify({ attribute, value }), headers: { "content-type": "application/json" } },
    { vpcId },
  );
}

export async function associateEc2ElasticIp(
  allocationId: string,
  instanceId: string,
): Promise<{ associationId: string }> {
  const res = await apiClient.call<{ associationId: string }>(
    apiEndpointKeys.aws.ec2.elasticIps.associate,
    { body: JSON.stringify({ instanceId }), headers: { "content-type": "application/json" } },
    { allocationId },
  );
  return res.data;
}

export async function disassociateEc2ElasticIp(allocationId: string, associationId: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.elasticIps.disassociate,
    { body: JSON.stringify({ associationId }), headers: { "content-type": "application/json" } },
    { allocationId },
  );
}

export async function listEc2Vpcs(signal?: AbortSignal): Promise<Ec2Vpc[]> {
  const res = await apiClient.call<Ec2Vpc[]>(apiEndpointKeys.aws.ec2.vpcs.list, { signal });
  return res.data;
}

export async function createEc2Vpc(cidrBlock: string): Promise<Ec2Vpc> {
  const res = await apiClient.call<Ec2Vpc>(
    apiEndpointKeys.aws.ec2.vpcs.create,
    { body: JSON.stringify({ cidrBlock }), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function deleteEc2Vpc(vpcId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.vpcs.delete, {}, { vpcId });
}

export async function listEc2Subnets(vpcId?: string, signal?: AbortSignal): Promise<Ec2Subnet[]> {
  const res = await apiClient.call<Ec2Subnet[]>(
    apiEndpointKeys.aws.ec2.subnets.list,
    { params: { vpcId }, signal },
  );
  return res.data;
}

export async function createEc2Subnet(
  vpcId: string,
  cidrBlock: string,
  availabilityZone?: string,
): Promise<Ec2Subnet> {
  const res = await apiClient.call<Ec2Subnet>(
    apiEndpointKeys.aws.ec2.subnets.create,
    { body: JSON.stringify({ vpcId, cidrBlock, availabilityZone }), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function deleteEc2Subnet(subnetId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.subnets.delete, {}, { subnetId });
}

export async function listEc2InternetGateways(signal?: AbortSignal): Promise<Ec2InternetGateway[]> {
  const res = await apiClient.call<Ec2InternetGateway[]>(apiEndpointKeys.aws.ec2.internetGateways.list, { signal });
  return res.data;
}

export async function createEc2InternetGateway(name?: string): Promise<Ec2InternetGateway> {
  const res = await apiClient.call<Ec2InternetGateway>(
    apiEndpointKeys.aws.ec2.internetGateways.create,
    { body: JSON.stringify({ name }), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function attachEc2InternetGateway(igwId: string, vpcId: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.internetGateways.attach,
    { body: JSON.stringify({ vpcId }), headers: { "content-type": "application/json" } },
    { igwId },
  );
}

export async function detachEc2InternetGateway(igwId: string, vpcId: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.internetGateways.detach,
    { body: JSON.stringify({ vpcId }), headers: { "content-type": "application/json" } },
    { igwId },
  );
}

export async function deleteEc2InternetGateway(igwId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.internetGateways.delete, {}, { igwId });
}

export async function listEc2NatGateways(vpcId?: string, signal?: AbortSignal): Promise<Ec2NatGateway[]> {
  const res = await apiClient.call<Ec2NatGateway[]>(
    apiEndpointKeys.aws.ec2.natGateways.list,
    { params: { vpcId }, signal },
  );
  return res.data;
}

export async function createEc2NatGateway(input: CreateNatGatewayInput): Promise<Ec2NatGateway> {
  const res = await apiClient.call<Ec2NatGateway>(
    apiEndpointKeys.aws.ec2.natGateways.create,
    { body: JSON.stringify(input), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function deleteEc2NatGateway(natId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.natGateways.delete, {}, { natId });
}

export async function listEc2RouteTables(vpcId?: string, signal?: AbortSignal): Promise<Ec2RouteTable[]> {
  const res = await apiClient.call<Ec2RouteTable[]>(
    apiEndpointKeys.aws.ec2.routeTables.list,
    { params: { vpcId }, signal },
  );
  return res.data;
}

export async function createEc2RouteTable(vpcId: string, name?: string): Promise<Ec2RouteTable> {
  const res = await apiClient.call<Ec2RouteTable>(
    apiEndpointKeys.aws.ec2.routeTables.create,
    { body: JSON.stringify({ vpcId, name }), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function deleteEc2RouteTable(rtbId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.routeTables.delete, {}, { rtbId });
}

export async function createEc2Route(rtbId: string, input: CreateRouteInput): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.routeTables.createRoute,
    { body: JSON.stringify(input), headers: { "content-type": "application/json" } },
    { rtbId },
  );
}

export async function deleteEc2Route(rtbId: string, cidr: string): Promise<void> {
  await apiClient.call(
    apiEndpointKeys.aws.ec2.routeTables.deleteRoute,
    { params: { cidr } },
    { rtbId },
  );
}

export async function associateEc2RouteTable(rtbId: string, subnetId: string): Promise<string> {
  const res = await apiClient.call<{ associationId: string }>(
    apiEndpointKeys.aws.ec2.routeTables.associate,
    { body: JSON.stringify({ subnetId }), headers: { "content-type": "application/json" } },
    { rtbId },
  );
  return res.data.associationId;
}

export async function disassociateEc2RouteTable(associationId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.routeTables.disassociate, {}, { associationId });
}

export async function listEc2ElasticIps(signal?: AbortSignal): Promise<Ec2ElasticIp[]> {
  const res = await apiClient.call<Ec2ElasticIp[]>(apiEndpointKeys.aws.ec2.elasticIps.list, { signal });
  return res.data;
}

export async function allocateEc2ElasticIp(name?: string): Promise<Ec2ElasticIp> {
  const res = await apiClient.call<Ec2ElasticIp>(
    apiEndpointKeys.aws.ec2.elasticIps.create,
    { body: JSON.stringify({ name }), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function releaseEc2ElasticIp(allocationId: string): Promise<void> {
  await apiClient.call(apiEndpointKeys.aws.ec2.elasticIps.release, {}, { allocationId });
}

export async function createVpcWizard(input: VpcWizardInput): Promise<VpcWizardResult> {
  const res = await apiClient.call<VpcWizardResult>(
    apiEndpointKeys.aws.ec2.vpcWizard,
    { body: JSON.stringify(input), headers: { "content-type": "application/json" } },
  );
  return res.data;
}

export async function listEc2Resources(signal?: AbortSignal): Promise<ResourceSummary[]> {
  const instances = await listEc2Instances(signal);
  return instances.map((instance) => ({
    id: instance.instanceId,
    name: instance.name,
    status: instance.state,
    metadata: {
      instanceType: instance.instanceType,
      az: instance.availabilityZone,
      publicIp: instance.publicIpAddress,
      privateIp: instance.privateIpAddress,
    },
  }));
}

// ─── Client ───────────────────────────────────────────────────────────────────

export const ec2Client = {
  listInstances: listEc2Instances,
  describeInstance: describeEc2Instance,
  runInstance: runEc2Instance,
  startInstance: startEc2Instance,
  stopInstance: stopEc2Instance,
  rebootInstance: rebootEc2Instance,
  terminateInstance: terminateEc2Instance,
  updateInstanceTags: updateEc2InstanceTags,
  createAmi: createEc2Ami,
  getConsoleOutput: getEc2ConsoleOutput,
  listAmis: listEc2Amis,
  deregisterAmi: deregisterEc2Ami,
  listResources: listEc2Resources,
  listKeyPairs: listEc2KeyPairs,
  createKeyPair: createEc2KeyPair,
  deleteKeyPair: deleteEc2KeyPair,
  listSecurityGroups: listEc2SecurityGroups,
  createSecurityGroup: createEc2SecurityGroup,
  deleteSecurityGroup: deleteEc2SecurityGroup,
  authorizeSecurityGroupIngress: authorizeEc2SecurityGroupIngress,
  revokeSecurityGroupIngress: revokeEc2SecurityGroupIngress,
  authorizeSecurityGroupEgress: authorizeEc2SecurityGroupEgress,
  revokeSecurityGroupEgress: revokeEc2SecurityGroupEgress,
  listAvailabilityZones: listEc2AvailabilityZones,
  listInstanceTypes: listEc2InstanceTypes,
  modifySubnetAttribute: modifyEc2SubnetAttribute,
  getVpcAttributes: getEc2VpcAttributes,
  modifyVpcAttribute: modifyEc2VpcAttribute,
  associateElasticIp: associateEc2ElasticIp,
  disassociateElasticIp: disassociateEc2ElasticIp,
  listVpcs: listEc2Vpcs,
  createVpc: createEc2Vpc,
  deleteVpc: deleteEc2Vpc,
  listSubnets: listEc2Subnets,
  createSubnet: createEc2Subnet,
  deleteSubnet: deleteEc2Subnet,
  listInternetGateways: listEc2InternetGateways,
  createInternetGateway: createEc2InternetGateway,
  attachInternetGateway: attachEc2InternetGateway,
  detachInternetGateway: detachEc2InternetGateway,
  deleteInternetGateway: deleteEc2InternetGateway,
  listNatGateways: listEc2NatGateways,
  createNatGateway: createEc2NatGateway,
  deleteNatGateway: deleteEc2NatGateway,
  listRouteTables: listEc2RouteTables,
  createRouteTable: createEc2RouteTable,
  deleteRouteTable: deleteEc2RouteTable,
  createRoute: createEc2Route,
  deleteRoute: deleteEc2Route,
  associateRouteTable: associateEc2RouteTable,
  disassociateRouteTable: disassociateEc2RouteTable,
  listElasticIps: listEc2ElasticIps,
  allocateElasticIp: allocateEc2ElasticIp,
  releaseElasticIp: releaseEc2ElasticIp,
  createVpcWizard,
};
