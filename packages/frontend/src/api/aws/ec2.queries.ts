import { useQuery } from "@tanstack/react-query";
import { useAccountId } from "@/lib/accountStore";
import { useRegion } from "@/lib/regionStore";
import { ec2Client } from "./ec2.api";

export const ec2QueryKeys = {
  instances: ["ec2", "instances"] as const,
  instance: (instanceId: string | null) => ["ec2", "instance", instanceId] as const,
  amis: ["ec2", "amis"] as const,
  keyPairs: ["ec2", "key-pairs"] as const,
  // Parameterized list queries — call with vpcId for scoped, omit for all
  securityGroups: (vpcId?: string) => ["ec2", "security-groups", vpcId ?? "all"] as const,
  subnets: (vpcId?: string) => ["ec2", "subnets", vpcId ?? "all"] as const,
  natGateways: (vpcId?: string) => ["ec2", "nat-gateways", vpcId ?? "all"] as const,
  routeTables: (vpcId?: string) => ["ec2", "route-tables", vpcId ?? "all"] as const,
  // Root keys — use in mutations to invalidate all variants of a parameterized query
  securityGroupsAll: ["ec2", "security-groups"] as const,
  subnetsAll: ["ec2", "subnets"] as const,
  natGatewaysAll: ["ec2", "nat-gateways"] as const,
  routeTablesAll: ["ec2", "route-tables"] as const,
  // Static list keys
  vpcs: ["ec2", "vpcs"] as const,
  consoleOutput: (instanceId: string | null) => ["ec2", "console", instanceId] as const,
  internetGateways: ["ec2", "internet-gateways"] as const,
  elasticIps: ["ec2", "elastic-ips"] as const,
  availabilityZones: ["ec2", "availability-zones"] as const,
  instanceTypes: ["ec2", "instance-types"] as const,
  vpcAttributes: (vpcId: string) => ["ec2", "vpc-attributes", vpcId] as const,
};

// Floci isolates resources per account and region, so every EC2 query is cached
// under the active account and region. They go last: invalidating a key above
// still matches every account's and region's copy by prefix.
function useAccountScoped<K extends readonly unknown[]>(key: K) {
  return [...key, useAccountId(), useRegion()] as const;
}

export function useEc2InstancesQuery() {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.instances),
    queryFn: ({ signal }) => ec2Client.listInstances(signal),
    refetchInterval: 30_000,
  });
}

export function useEc2InstanceQuery(instanceId: string | null) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.instance(instanceId)),
    queryFn: ({ signal }) => ec2Client.describeInstance(instanceId!, signal),
    enabled: Boolean(instanceId),
    refetchInterval: 30_000,
  });
}

export function useEc2AmisQuery() {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.amis),
    queryFn: ({ signal }) => ec2Client.listAmis(signal),
    refetchInterval: 30_000,
  });
}

export function useEc2KeyPairsQuery(enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.keyPairs),
    queryFn: ({ signal }) => ec2Client.listKeyPairs(signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useEc2SecurityGroupsQuery(vpcId?: string, enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.securityGroups(vpcId)),
    queryFn: ({ signal }) => ec2Client.listSecurityGroups(vpcId, signal),
    enabled,
    staleTime: 30_000,
  });
}

export function useEc2VpcsQuery(enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.vpcs),
    queryFn: ({ signal }) => ec2Client.listVpcs(signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useEc2SubnetsQuery(vpcId?: string, enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.subnets(vpcId)),
    queryFn: ({ signal }) => ec2Client.listSubnets(vpcId, signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useEc2ConsoleOutputQuery(instanceId: string | null) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.consoleOutput(instanceId)),
    queryFn: ({ signal }) => ec2Client.getConsoleOutput(instanceId!, signal),
    enabled: Boolean(instanceId),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useEc2InternetGatewaysQuery(enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.internetGateways),
    queryFn: ({ signal }) => ec2Client.listInternetGateways(signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useEc2NatGatewaysQuery(vpcId?: string, enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.natGateways(vpcId)),
    queryFn: ({ signal }) => ec2Client.listNatGateways(vpcId, signal),
    enabled,
    staleTime: 30_000,
  });
}

export function useEc2RouteTablesQuery(vpcId?: string, enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.routeTables(vpcId)),
    queryFn: ({ signal }) => ec2Client.listRouteTables(vpcId, signal),
    enabled,
    staleTime: 30_000,
  });
}

export function useEc2ElasticIpsQuery(enabled = true) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.elasticIps),
    queryFn: ({ signal }) => ec2Client.listElasticIps(signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useEc2AvailabilityZonesQuery() {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.availabilityZones),
    queryFn: ({ signal }) => ec2Client.listAvailabilityZones(signal),
    staleTime: Infinity,
  });
}

export function useEc2InstanceTypesQuery() {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.instanceTypes),
    queryFn: ({ signal }) => ec2Client.listInstanceTypes(signal),
    staleTime: Infinity,
  });
}

export function useEc2VpcAttributesQuery(vpcId: string | undefined) {
  return useQuery({
    queryKey: useAccountScoped(ec2QueryKeys.vpcAttributes(vpcId ?? "")),
    queryFn: ({ signal }) => ec2Client.getVpcAttributes(vpcId!, signal),
    enabled: Boolean(vpcId),
    staleTime: 30_000,
  });
}
