import { useEffect, useMemo, useState } from "react";
import {Icon, Boxes, InfoSquared as Info, RefreshCwSquared as RefreshCw, ServerSquared as Server, ShieldCheck, Tags} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import { EmptyState } from "@/components/EmptyState";
import type { EksCluster, EksNodegroup } from "@/api/aws/eks.api";
import {
  useEksClustersQuery,
  useEksNodegroupsQuery,
} from "@/api/aws/eks.queries";
import {RowsSkeleton} from '@/components/PageSkeleton'

function statusClass(status?: string) {
  const normalized = status?.toLowerCase();
  if (normalized === "active") return "healthy";
  if (normalized === "creating" || normalized === "updating") return "degraded";
  if (normalized === "failed" || normalized === "deleting") return "unavailable";
  return "unknown";
}

function formatDate(value?: string) {
  if (!value) return ", ";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function yesNo(value?: boolean) {
  if (value === undefined) return ", ";
  return value ? "Enabled" : "Disabled";
}

function ClusterListItem({
  cluster,
  active,
  onSelect,
}: {
  cluster: EksCluster;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button variant="secondary"
      className={`list-item ${active ? "active" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <strong>{cluster.name}</strong>
      <span>
        Kubernetes {cluster.version ?? ", "} · {cluster.nodegroupCount ?? 0} nodegroups
      </span>
    </Button>
  );
}

function ClusterSummary({ cluster }: { cluster: EksCluster }) {
  const vpc = cluster.resourcesVpcConfig;

  return (
    <div className="grid two">
      <div className="widget">
        <div className="widget-header">
          <Icon icon={Boxes} size={14} color="var(--accent)" />
          <h3>Cluster</h3>
        </div>
        <div className="widget-body">
          <div className="meta-grid">
            <Meta label="Status" value={cluster.status ?? "unknown"} />
            <Meta label="Kubernetes version" value={cluster.version ?? ", "} />
            <Meta label="Platform version" value={cluster.platformVersion ?? ", "} />
            <Meta label="Created" value={formatDate(cluster.createdAt)} />
            <Meta label="Endpoint" value={cluster.endpoint ?? ", "} />
            <Meta label="Role ARN" value={cluster.roleArn ?? ", "} />
          </div>
        </div>
      </div>

      <div className="widget">
        <div className="widget-header">
          <Icon icon={ShieldCheck} size={14} color="var(--accent)" />
          <h3>Networking</h3>
        </div>
        <div className="widget-body">
          <div className="meta-grid">
            <Meta label="VPC" value={vpc?.vpcId ?? ", "} />
            <Meta label="Public endpoint" value={yesNo(vpc?.endpointPublicAccess)} />
            <Meta label="Private endpoint" value={yesNo(vpc?.endpointPrivateAccess)} />
            <Meta label="Subnets" value={String(vpc?.subnetIds.length ?? 0)} />
            <Meta
              label="Security groups"
              value={String(vpc?.securityGroupIds.length ?? 0)}
            />
            <Meta
              label="Public CIDRs"
              value={vpc?.publicAccessCidrs.join(", ") || ", "}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ClusterTags({ tags }: { tags: Record<string, string> }) {
  const entries = Object.entries(tags);

  return (
    <div className="widget section-space">
      <div className="widget-header">
        <Icon icon={Tags} size={14} color="var(--accent)" />
        <h3>Tags</h3>
        <span className="badge neutral">{entries.length}</span>
      </div>
      <div className="widget-body">
        {entries.length === 0 ? (
          <p className="muted compact-text">No tags returned for this cluster.</p>
        ) : (
          <div className="metadata-tags">
            {entries.map(([key, value]) => (
              <span className="metadata-tag" key={`${key}:${value}`}>
                <strong>{key}</strong>
                <span>{value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

function NodegroupTable({ nodegroups }: { nodegroups: EksNodegroup[] }) {
  if (nodegroups.length === 0) {
    return (
      <EmptyState
        icon={Server}
        title="No nodegroups"
        description="This cluster did not return any managed nodegroups."
      />
    );
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Capacity</th>
          <th>Instances</th>
          <th>Scaling</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {nodegroups.map((nodegroup) => (
          <tr key={nodegroup.arn ?? nodegroup.name}>
            <td className="mono">{nodegroup.name}</td>
            <td>
              <span className={`status ${statusClass(nodegroup.status)}`}>
                {nodegroup.status ?? "unknown"}
              </span>
            </td>
            <td>{nodegroup.capacityType ?? ", "}</td>
            <td className="mono">{nodegroup.instanceTypes.join(", ") || ", "}</td>
            <td className="mono">
              {nodegroup.scalingConfig
                ? `${nodegroup.scalingConfig.minSize ?? "?"}/${nodegroup.scalingConfig.desiredSize ?? "?"}/${nodegroup.scalingConfig.maxSize ?? "?"}`
                : ", "}
            </td>
            <td>{formatDate(nodegroup.modifiedAt ?? nodegroup.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EKSPage() {
  const clustersQuery = useEksClustersQuery();
  const clusters = useMemo(() => clustersQuery.data ?? [], [clustersQuery.data]);
  const [selectedClusterName, setSelectedClusterName] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedClusterName && clusters[0]) {
      setSelectedClusterName(clusters[0].name);
    }
  }, [clusters, selectedClusterName]);

  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.name === selectedClusterName) ?? null,
    [clusters, selectedClusterName],
  );
  const nodegroupsQuery = useEksNodegroupsQuery(selectedClusterName);

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h1>EKS</h1>
          <span className="info-link">
            <Icon icon={Info} size={14} />
            Kubernetes clusters
          </span>
        </div>
        <Button variant="secondary"
          onClick={() => {
            void clustersQuery.refetch();
            void nodegroupsQuery.refetch();
          }}
          type="button"
        >
          <Icon icon={RefreshCw} size={14} />
          Refresh
        </Button>
      </div>

      <div className="split">
        <aside className="list-pane">
          <div className="widget-header">
            <Icon icon={Boxes} size={14} color="var(--text-2)" />
            <h2>Clusters ({clusters.length})</h2>
          </div>

          {clustersQuery.isLoading ? (
            <RowsSkeleton rows={4} label="Loading clusters"/>
          ) : clustersQuery.isError ? (
            <EmptyState
              icon={Boxes}
              title="Cannot load clusters"
              description="EKS did not respond from the Floci endpoint."
            />
          ) : clusters.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No EKS clusters"
              description="No Kubernetes clusters were returned by Floci."
            />
          ) : (
            clusters.map((cluster) => (
              <ClusterListItem
                key={cluster.arn ?? cluster.name}
                cluster={cluster}
                active={selectedClusterName === cluster.name}
                onSelect={() => setSelectedClusterName(cluster.name)}
              />
            ))
          )}
        </aside>

        <section className="detail-pane">
          {!selectedCluster ? (
            <EmptyState
              icon={Boxes}
              title="Select a cluster"
              description="Choose an EKS cluster to inspect its networking and nodegroups."
            />
          ) : (
            <div className="content">
              <div className="page-title mb-4">
                <Icon icon={Boxes}  color="var(--accent)" />
                <h2>{selectedCluster.name}</h2>
                <span className={`status ${statusClass(selectedCluster.status)}`}>
                  {selectedCluster.status ?? "unknown"}
                </span>
              </div>

              <ClusterSummary cluster={selectedCluster} />
              <ClusterTags tags={selectedCluster.tags} />

              <div className="table-panel section-space">
                <div className="widget-header">
                  <Icon icon={Server} size={14} color="var(--text-2)" />
                  <h3>Managed nodegroups</h3>
                </div>

                {nodegroupsQuery.isLoading ? (
                  <RowsSkeleton rows={3} label="Loading nodegroups"/>
                ) : nodegroupsQuery.isError ? (
                  <EmptyState
                    icon={Server}
                    title="Cannot load nodegroups"
                    description="EKS did not return nodegroup details for this cluster."
                  />
                ) : (
                  <NodegroupTable nodegroups={nodegroupsQuery.data ?? []} />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
