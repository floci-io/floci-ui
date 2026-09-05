import {
  CreateDBInstanceCommand,
  CreateDBSnapshotCommand,
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  DescribeOrderableDBInstanceOptionsCommand,
  type CreateDBInstanceCommandInput,
  type DBInstance,
  type DBSnapshot,
  type RDSClient,
} from "@aws-sdk/client-rds";
import { awsClients } from "../aws";

export type RdsEndpoint = {
  address?: string;
  port?: number;
  hostedZoneId?: string;
};

export type RdsVpcSecurityGroup = {
  id?: string;
  status?: string;
};

export type RdsSubnet = {
  identifier?: string;
  availabilityZone?: string;
  status?: string;
};

export type RdsDbSubnetGroup = {
  name?: string;
  vpcId?: string;
  status?: string;
  subnets: RdsSubnet[];
};

export type RdsInstance = {
  identifier: string;
  arn?: string;
  resourceId?: string;
  createdAt?: string;
  status?: string;
  engine?: string;
  engineVersion?: string;
  instanceClass?: string;
  dbName?: string;
  masterUsername?: string;
  allocatedStorage?: number;
  storageType?: string;
  availabilityZone?: string;
  multiAz?: boolean;
  publiclyAccessible?: boolean;
  iamDatabaseAuthenticationEnabled?: boolean;
  preferredBackupWindow?: string;
  preferredMaintenanceWindow?: string;
  endpoint?: RdsEndpoint;
  vpcSecurityGroups: RdsVpcSecurityGroup[];
  subnetGroup?: RdsDbSubnetGroup;
};

export type RdsSnapshot = {
  identifier: string;
  instanceIdentifier?: string;
  arn?: string;
  status?: string;
  engine?: string;
  engineVersion?: string;
  allocatedStorage?: number;
  snapshotType?: string;
  createdAt?: string;
  port?: number;
  availabilityZone?: string;
  vpcId?: string;
};

function toRdsInstance(instance: DBInstance): RdsInstance {
  return {
    identifier: instance.DBInstanceIdentifier ?? "",
    arn: instance.DBInstanceArn,
    resourceId: instance.DbiResourceId,
    createdAt: instance.InstanceCreateTime?.toISOString(),
    status: instance.DBInstanceStatus,
    engine: instance.Engine,
    engineVersion: instance.EngineVersion,
    instanceClass: instance.DBInstanceClass,
    dbName: instance.DBName,
    masterUsername: instance.MasterUsername,
    allocatedStorage: instance.AllocatedStorage,
    storageType: instance.StorageType,
    availabilityZone: instance.AvailabilityZone,
    multiAz: instance.MultiAZ,
    publiclyAccessible: instance.PubliclyAccessible,
    iamDatabaseAuthenticationEnabled: instance.IAMDatabaseAuthenticationEnabled,
    preferredBackupWindow: instance.PreferredBackupWindow,
    preferredMaintenanceWindow: instance.PreferredMaintenanceWindow,
    endpoint: instance.Endpoint
      ? {
          address: instance.Endpoint.Address,
          port: instance.Endpoint.Port,
          hostedZoneId: instance.Endpoint.HostedZoneId,
        }
      : undefined,
    vpcSecurityGroups: (instance.VpcSecurityGroups ?? []).map((group) => ({
      id: group.VpcSecurityGroupId,
      status: group.Status,
    })),
    subnetGroup: instance.DBSubnetGroup
      ? {
          name: instance.DBSubnetGroup.DBSubnetGroupName,
          vpcId: instance.DBSubnetGroup.VpcId,
          status: instance.DBSubnetGroup.SubnetGroupStatus,
          subnets: (instance.DBSubnetGroup.Subnets ?? []).map((subnet) => ({
            identifier: subnet.SubnetIdentifier,
            availabilityZone: subnet.SubnetAvailabilityZone?.Name,
            status: subnet.SubnetStatus,
          })),
        }
      : undefined,
  };
}

function toRdsSnapshot(snapshot: DBSnapshot): RdsSnapshot {
  return {
    identifier: snapshot.DBSnapshotIdentifier ?? "",
    instanceIdentifier: snapshot.DBInstanceIdentifier,
    arn: snapshot.DBSnapshotArn,
    status: snapshot.Status,
    engine: snapshot.Engine,
    engineVersion: snapshot.EngineVersion,
    allocatedStorage: snapshot.AllocatedStorage,
    snapshotType: snapshot.SnapshotType,
    createdAt: snapshot.SnapshotCreateTime?.toISOString(),
    port: snapshot.Port,
    availabilityZone: snapshot.AvailabilityZone,
    vpcId: snapshot.VpcId,
  };
}

export function createRdsService(client: RDSClient = awsClients.rds) {
  return {
    async listInstances(): Promise<RdsInstance[]> {
      const instances: RdsInstance[] = [];
      let marker: string | undefined;

      do {
        const res = await client.send(
          new DescribeDBInstancesCommand({ Marker: marker }),
        );
        instances.push(...(res.DBInstances ?? []).map(toRdsInstance));
        marker = res.Marker;
      } while (marker);

      return instances;
    },

    async describeInstance(identifier: string): Promise<RdsInstance> {
      const res = await client.send(
        new DescribeDBInstancesCommand({ DBInstanceIdentifier: identifier }),
      );
      return toRdsInstance(res.DBInstances?.[0] ?? {});
    },

    async createInstance(input: CreateDBInstanceCommandInput): Promise<RdsInstance> {
      const res = await client.send(new CreateDBInstanceCommand(input));
      return toRdsInstance(res.DBInstance ?? {});
    },

    async deleteInstance(identifier: string): Promise<void> {
      await client.send(
        new DeleteDBInstanceCommand({
          DBInstanceIdentifier: identifier,
          SkipFinalSnapshot: true,
        }),
      );
    },

    async listSnapshots(instanceIdentifier?: string): Promise<RdsSnapshot[]> {
      const snapshots: RdsSnapshot[] = [];
      let marker: string | undefined;

      do {
        const res = await client.send(
          new DescribeDBSnapshotsCommand({
            DBInstanceIdentifier: instanceIdentifier,
            Marker: marker,
          }),
        );
        snapshots.push(...(res.DBSnapshots ?? []).map(toRdsSnapshot));
        marker = res.Marker;
      } while (marker);

      return snapshots;
    },

    async createSnapshot(instanceIdentifier: string, snapshotIdentifier: string): Promise<RdsSnapshot> {
      const res = await client.send(
        new CreateDBSnapshotCommand({
          DBInstanceIdentifier: instanceIdentifier,
          DBSnapshotIdentifier: snapshotIdentifier,
        }),
      );
      return toRdsSnapshot(res.DBSnapshot ?? {});
    },

    async listOrderableInstanceClasses(engine: string): Promise<string[]> {
      const classes = new Set<string>();
      let marker: string | undefined;

      do {
        const res = await client.send(
          new DescribeOrderableDBInstanceOptionsCommand({
            Engine: engine,
            Marker: marker,
          }),
        );
        for (const option of res.OrderableDBInstanceOptions ?? []) {
          if (option.DBInstanceClass) {
            classes.add(option.DBInstanceClass);
          }
        }
        marker = res.Marker;
      } while (marker);

      return Array.from(classes);
    },
  };
}

export const rdsService = createRdsService();
