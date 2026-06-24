import { EndpointRegistry, HttpClient } from "./HttpClient";
import { ACCOUNT_HEADER, getAccountId } from "@/lib/accountStore";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required before calling the API.");
    this.name = "AuthenticationRequiredError";
  }
}

export const apiEndpointKeys = {
  clouds: {
    list: "clouds.list",
    services: "clouds.services.list",
    status: "clouds.status.get",
    schema: "clouds.services.schema.get",
    resources: {
      list: "clouds.services.resources.list",
      get: "clouds.services.resources.get",
      create: "clouds.services.resources.create",
      delete: "clouds.services.resources.delete",
      invoke: "clouds.services.resources.invoke",
    },
    storage: {
      objects: {
        list: "clouds.services.storage.objects.list",
        upload: "clouds.services.storage.objects.upload",
        download: "clouds.services.storage.objects.download",
        delete: "clouds.services.storage.objects.delete",
        copy: "clouds.services.storage.objects.copy",
      },
    },
    database: {
      cosmos: {
        containers: {
          list: "clouds.services.database.cosmos.containers.list",
          create: "clouds.services.database.cosmos.containers.create",
          delete: "clouds.services.database.cosmos.containers.delete",
        },
        items: {
          list: "clouds.services.database.cosmos.items.list",
          upsert: "clouds.services.database.cosmos.items.upsert",
          delete: "clouds.services.database.cosmos.items.delete",
          query: "clouds.services.database.cosmos.items.query",
        },
      },
    },
  },
  aws: {
    eks: {
      clusters: {
        list: "aws.eks.clusters.list",
        describe: "aws.eks.clusters.describe",
      },
      nodegroups: {
        list: "aws.eks.nodegroups.list",
        describe: "aws.eks.nodegroups.describe",
        create: "aws.eks.nodegroups.create",
        delete: "aws.eks.nodegroups.delete",
      },
      fargateProfiles: {
        list: "aws.eks.fargate-profiles.list",
        describe: "aws.eks.fargate-profiles.describe",
        create: "aws.eks.fargate-profiles.create",
        delete: "aws.eks.fargate-profiles.delete",
      },
    },
    rds: {
      instances: {
        list: "aws.rds.instances.list",
        describe: "aws.rds.instances.describe",
      },
      snapshots: {
        list: "aws.rds.snapshots.list",
        create: "aws.rds.snapshots.create",
      },
    },
    secretsmanager: {
      secrets: {
        list: "aws.secretsmanager.secrets.list",
        create: "aws.secretsmanager.secrets.create",
        describe: "aws.secretsmanager.secrets.describe",
        delete: "aws.secretsmanager.secrets.delete",
        value: {
          get: "aws.secretsmanager.secrets.value.get",
          put: "aws.secretsmanager.secrets.value.put",
        },
      },
    },
    ec2: {
      instances: {
        list: "aws.ec2.instances.list",
        describe: "aws.ec2.instances.describe",
        create: "aws.ec2.instances.create",
        start: "aws.ec2.instances.start",
        stop: "aws.ec2.instances.stop",
        reboot: "aws.ec2.instances.reboot",
        terminate: "aws.ec2.instances.terminate",
        tags: "aws.ec2.instances.tags",
        createImage: "aws.ec2.instances.create-image",
        console: "aws.ec2.instances.console",
      },
      amis: {
        list: "aws.ec2.amis.list",
        deregister: "aws.ec2.amis.deregister",
      },
      keyPairs: {
        list: "aws.ec2.key-pairs.list",
        create: "aws.ec2.key-pairs.create",
        delete: "aws.ec2.key-pairs.delete",
      },
      securityGroups: {
        list: "aws.ec2.security-groups.list",
        create: "aws.ec2.security-groups.create",
        delete: "aws.ec2.security-groups.delete",
        authorize: "aws.ec2.security-groups.authorize",
        revoke: "aws.ec2.security-groups.revoke",
        authorizeEgress: "aws.ec2.security-groups.authorize-egress",
        revokeEgress: "aws.ec2.security-groups.revoke-egress",
      },
      vpcs: {
        list: "aws.ec2.vpcs.list",
        create: "aws.ec2.vpcs.create",
        delete: "aws.ec2.vpcs.delete",
        getAttributes: "aws.ec2.vpcs.get-attributes",
        modifyAttribute: "aws.ec2.vpcs.modify-attribute",
      },
      subnets: {
        list: "aws.ec2.subnets.list",
        create: "aws.ec2.subnets.create",
        delete: "aws.ec2.subnets.delete",
        modifyAttribute: "aws.ec2.subnets.modify-attribute",
      },
      internetGateways: {
        list: "aws.ec2.igw.list",
        create: "aws.ec2.igw.create",
        attach: "aws.ec2.igw.attach",
        detach: "aws.ec2.igw.detach",
        delete: "aws.ec2.igw.delete",
      },
      natGateways: {
        list: "aws.ec2.nat.list",
        create: "aws.ec2.nat.create",
        delete: "aws.ec2.nat.delete",
      },
      routeTables: {
        list: "aws.ec2.rtb.list",
        create: "aws.ec2.rtb.create",
        delete: "aws.ec2.rtb.delete",
        createRoute: "aws.ec2.rtb.route.create",
        deleteRoute: "aws.ec2.rtb.route.delete",
        associate: "aws.ec2.rtb.associate",
        disassociate: "aws.ec2.rtb.disassociate",
      },
      elasticIps: {
        list: "aws.ec2.eip.list",
        create: "aws.ec2.eip.create",
        release: "aws.ec2.eip.release",
        associate: "aws.ec2.eip.associate",
        disassociate: "aws.ec2.eip.disassociate",
      },
      availabilityZones: "aws.ec2.availability-zones",
      instanceTypes: "aws.ec2.instance-types",
      vpcWizard: "aws.ec2.vpc-wizard",
    },
  },
} as const;

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const endpointRegistry: EndpointRegistry = new Map([
  // Cloud Proxy
  [
    apiEndpointKeys.clouds.list,
    {
      path: "/clouds",
      method: "GET",
      telemetry: { provider: "system", service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.services,
    {
      path: "/clouds/:cloud/services",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.status,
    {
      path: "/clouds/:cloud/status",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.schema,
    {
      path: "/clouds/:cloud/services/:service/schema",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.resources.list,
    {
      path: "/clouds/:cloud/services/:service/resources",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
  apiEndpointKeys.clouds.resources.invoke,
  {
    path: "/clouds/:cloud/services/:service/resources/:id/invoke",
    method: "POST",
    telemetry: { service: "cloud-proxy" },
  },
],
  [
    apiEndpointKeys.clouds.resources.get,
    {
      path: "/clouds/:cloud/services/:service/resources/:id",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.resources.create,
    {
      path: "/clouds/:cloud/services/:service/resources",
      method: "POST",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.resources.delete,
    {
      path: "/clouds/:cloud/services/:service/resources/:id",
      method: "DELETE",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.storage.objects.list,
    {
      path: "/clouds/:cloud/services/storage/resources/:id/objects",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.storage.objects.upload,
    {
      path: "/clouds/:cloud/services/storage/resources/:id/object",
      method: "PUT",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.storage.objects.download,
    {
      path: "/clouds/:cloud/services/storage/resources/:id/object",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.storage.objects.delete,
    {
      path: "/clouds/:cloud/services/storage/resources/:id/object",
      method: "DELETE",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.storage.objects.copy,
    {
      path: "/clouds/:cloud/services/storage/resources/:id/object/copy",
      method: "POST",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.database.cosmos.containers.list,
    {
      path: "/clouds/:cloud/services/database/resources/:id/containers",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.database.cosmos.containers.create,
    {
      path: "/clouds/:cloud/services/database/resources/:id/containers",
      method: "POST",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.database.cosmos.containers.delete,
    {
      path: "/clouds/:cloud/services/database/resources/:id/containers/:containerId",
      method: "DELETE",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.database.cosmos.items.list,
    {
      path: "/clouds/:cloud/services/database/resources/:id/containers/:containerId/items",
      method: "GET",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.database.cosmos.items.upsert,
    {
      path: "/clouds/:cloud/services/database/resources/:id/containers/:containerId/items",
      method: "POST",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.database.cosmos.items.delete,
    {
      path: "/clouds/:cloud/services/database/resources/:id/containers/:containerId/items/:itemId",
      method: "DELETE",
      telemetry: { service: "cloud-proxy" },
    },
  ],
  [
    apiEndpointKeys.clouds.database.cosmos.items.query,
    {
      path: "/clouds/:cloud/services/database/resources/:id/containers/:containerId/query",
      method: "POST",
      telemetry: { service: "cloud-proxy" },
    },
  ],

  // AWS EKS
  [
    apiEndpointKeys.aws.eks.clusters.list,
    {
      path: "/eks/clusters",
      method: "GET",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.clusters.describe,
    {
      path: "/eks/clusters/:name",
      method: "GET",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.nodegroups.list,
    {
      path: "/eks/clusters/:name/nodegroups",
      method: "GET",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.nodegroups.describe,
    {
      path: "/eks/clusters/:name/nodegroups/:nodegroup",
      method: "GET",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.nodegroups.create,
    {
      path: "/eks/clusters/:name/nodegroups",
      method: "POST",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.nodegroups.delete,
    {
      path: "/eks/clusters/:name/nodegroups/:nodegroup",
      method: "DELETE",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.fargateProfiles.list,
    {
      path: "/eks/clusters/:name/fargate-profiles",
      method: "GET",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.fargateProfiles.describe,
    {
      path: "/eks/clusters/:name/fargate-profiles/:profile",
      method: "GET",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.fargateProfiles.create,
    {
      path: "/eks/clusters/:name/fargate-profiles",
      method: "POST",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],
  [
    apiEndpointKeys.aws.eks.fargateProfiles.delete,
    {
      path: "/eks/clusters/:name/fargate-profiles/:profile",
      method: "DELETE",
      telemetry: { provider: "aws", service: "eks" },
    },
  ],

  // AWS RDS
  [
    apiEndpointKeys.aws.rds.instances.list,
    {
      path: "/rds/instances",
      method: "GET",
      telemetry: { provider: "aws", service: "rds" },
    },
  ],
  [
    apiEndpointKeys.aws.rds.instances.describe,
    {
      path: "/rds/instances/:identifier",
      method: "GET",
      telemetry: { provider: "aws", service: "rds" },
    },
  ],
  [
    apiEndpointKeys.aws.rds.snapshots.list,
    {
      path: "/rds/snapshots",
      method: "GET",
      telemetry: { provider: "aws", service: "rds" },
    },
  ],
  [
    apiEndpointKeys.aws.rds.snapshots.create,
    {
      path: "/rds/snapshots",
      method: "POST",
      telemetry: { provider: "aws", service: "rds" },
    },
  ],

  // AWS Secrets Manager
  [
    apiEndpointKeys.aws.secretsmanager.secrets.list,
    {
      path: "/secretsmanager/secrets",
      method: "GET",
      telemetry: { provider: "aws", service: "secretsmanager" },
    },
  ],
  [
    apiEndpointKeys.aws.secretsmanager.secrets.create,
    {
      path: "/secretsmanager/secrets",
      method: "POST",
      telemetry: { provider: "aws", service: "secretsmanager" },
    },
  ],
  [
    apiEndpointKeys.aws.secretsmanager.secrets.describe,
    {
      path: "/secretsmanager/secret",
      method: "GET",
      telemetry: { provider: "aws", service: "secretsmanager" },
    },
  ],
  [
    apiEndpointKeys.aws.secretsmanager.secrets.delete,
    {
      path: "/secretsmanager/secret",
      method: "DELETE",
      telemetry: { provider: "aws", service: "secretsmanager" },
    },
  ],
  [
    apiEndpointKeys.aws.secretsmanager.secrets.value.get,
    {
      path: "/secretsmanager/secret/value",
      method: "GET",
      telemetry: { provider: "aws", service: "secretsmanager" },
    },
  ],
  [
    apiEndpointKeys.aws.secretsmanager.secrets.value.put,
    {
      path: "/secretsmanager/secret/value",
      method: "PUT",
      telemetry: { provider: "aws", service: "secretsmanager" },
    },
  ],

  // AWS EC2
  [apiEndpointKeys.aws.ec2.instances.list,     { path: "/ec2/instances", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.describe, { path: "/ec2/instances/:instanceId", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.create,   { path: "/ec2/instances", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.start,    { path: "/ec2/instances/:instanceId/start", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.stop,     { path: "/ec2/instances/:instanceId/stop", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.reboot,   { path: "/ec2/instances/:instanceId/reboot", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.terminate,{ path: "/ec2/instances/:instanceId/terminate", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.tags,     { path: "/ec2/instances/:instanceId/tags", method: "PUT", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.createImage, { path: "/ec2/instances/:instanceId/image", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instances.console,  { path: "/ec2/instances/:instanceId/console", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.amis.list,          { path: "/ec2/amis", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.amis.deregister,    { path: "/ec2/amis/:imageId/deregister", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.keyPairs.list,      { path: "/ec2/key-pairs", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.keyPairs.create,    { path: "/ec2/key-pairs", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.keyPairs.delete,    { path: "/ec2/key-pairs/:name", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.securityGroups.list,   { path: "/ec2/security-groups", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.securityGroups.create, { path: "/ec2/security-groups", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.securityGroups.delete, { path: "/ec2/security-groups/:groupId", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.securityGroups.authorize,     { path: "/ec2/security-groups/:groupId/ingress", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.securityGroups.revoke,        { path: "/ec2/security-groups/:groupId/ingress", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.securityGroups.authorizeEgress, { path: "/ec2/security-groups/:groupId/egress", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.securityGroups.revokeEgress,    { path: "/ec2/security-groups/:groupId/egress", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.vpcs.list,          { path: "/ec2/vpcs", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.vpcs.create,        { path: "/ec2/vpcs", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.vpcs.delete,        { path: "/ec2/vpcs/:vpcId", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.vpcs.getAttributes,    { path: "/ec2/vpcs/:vpcId/attributes", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.vpcs.modifyAttribute,  { path: "/ec2/vpcs/:vpcId/attributes", method: "PUT", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.subnets.list,       { path: "/ec2/subnets", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.subnets.create,     { path: "/ec2/subnets", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.subnets.delete,     { path: "/ec2/subnets/:subnetId", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.subnets.modifyAttribute, { path: "/ec2/subnets/:subnetId/attributes", method: "PUT", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.internetGateways.list,   { path: "/ec2/internet-gateways", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.internetGateways.create, { path: "/ec2/internet-gateways", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.internetGateways.attach, { path: "/ec2/internet-gateways/:igwId/attach", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.internetGateways.detach, { path: "/ec2/internet-gateways/:igwId/detach", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.internetGateways.delete, { path: "/ec2/internet-gateways/:igwId", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.natGateways.list,   { path: "/ec2/nat-gateways", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.natGateways.create, { path: "/ec2/nat-gateways", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.natGateways.delete, { path: "/ec2/nat-gateways/:natId", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.routeTables.list,        { path: "/ec2/route-tables", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.routeTables.create,      { path: "/ec2/route-tables", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.routeTables.delete,      { path: "/ec2/route-tables/:rtbId", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.routeTables.createRoute, { path: "/ec2/route-tables/:rtbId/routes", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.routeTables.deleteRoute, { path: "/ec2/route-tables/:rtbId/routes", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.routeTables.associate,   { path: "/ec2/route-tables/:rtbId/associations", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.routeTables.disassociate,{ path: "/ec2/route-table-associations/:associationId", method: "DELETE", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.elasticIps.list,         { path: "/ec2/elastic-ips", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.elasticIps.create,       { path: "/ec2/elastic-ips", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.elasticIps.release,      { path: "/ec2/elastic-ips/:allocationId/release", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.elasticIps.associate,    { path: "/ec2/elastic-ips/:allocationId/associate", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.elasticIps.disassociate, { path: "/ec2/elastic-ips/:allocationId/disassociate", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.availabilityZones, { path: "/ec2/availability-zones", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.instanceTypes,     { path: "/ec2/instance-types", method: "GET", telemetry: { provider: "aws", service: "ec2" } }],
  [apiEndpointKeys.aws.ec2.vpcWizard,         { path: "/ec2/vpc-wizard", method: "POST", telemetry: { provider: "aws", service: "ec2" } }],

]);

// ─── Client Factory ───────────────────────────────────────────────────────────

export function createApiClient(
  getToken?: () => string | null | Promise<string | null>,
) {
  const client = new HttpClient(
    {
      baseUrl: API_BASE_URL,
      defaultHeaders: { Accept: "application/json" },
      timeout: 10_000,
    },
    endpointRegistry,
  );

  // Account scope — every request carries the active AWS account so Floci can
  // isolate resources per account (the API maps this header to its SDK creds).
  client.addRequestInterceptor((url, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    headers[ACCOUNT_HEADER] = getAccountId();
    init.headers = headers;
    return { url, init };
  });

  // Auth interceptor — attaches Bearer token if available
  if (getToken) {
    client.addRequestInterceptor(async (url, init) => {
      const token = await getToken();
      if (token) {
        (init.headers as Record<string, string>)["Authorization"] =
          `Bearer ${token}`;
      }
      return { url, init };
    });
  }

  // Logging interceptor (dev only)
  if (import.meta.env.DEV) {
    client.addResponseInterceptor((res) => {
      console.debug(`[HTTP] ${res.status} ${res.url}`);
      return res;
    });
  }

  //  client.addResponseInterceptor((res) => {
  //    if (res.status === 401) {
  //      handleUnauthorizedApiResponse();
  //    }
  //    return res;
  //  });

  return client;
}

export const apiClient = createApiClient();
