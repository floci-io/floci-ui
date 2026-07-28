import { useCreateRdsSnapshotMutation } from "@/api/aws/rds.mutations";
import { useRdsSnapshotsQuery } from "@/api/aws/rds.queries";
import { K8sEngineDetails } from "@/features/k8s/K8sEngineDetails";
import type { CloudResource, StorageObject } from "@/types/resource";
import {formatBytes} from "@/lib/format";

interface ResourceInspectorProps {
  resource?: CloudResource;
  object?: StorageObject;
}

export function ResourceInspector({
  resource,
  object,
}: ResourceInspectorProps) {
  if (!resource) {
    return (
      <div className="resource-inspector empty compact">
        <p className="eyebrow">Resource Inspector</p>
        <h3>Select a resource</h3>
        <p>Inspect normalized metadata returned by the cloud proxy.</p>
      </div>
    );
  }

  if (object) {
    return (
      <aside className="resource-inspector">
        <div className="widget-header">
          <h3>{object.name}</h3>
          <span className="badge neutral">{object.type}</span>
        </div>
        <div className="inspector-grid">
          <InspectorItem label="Cloud" value={resource.cloud} />
          <InspectorItem label="Resource" value={resource.name} />
          <InspectorItem label="Key" value={object.key} />
          <InspectorItem
            label="Size"
            value={object.size === null ? "-" : formatBytes(object.size)}
          />
          <InspectorItem
            label="Last Modified"
            value={object.lastModified ?? "-"}
          />
        </div>
        <MetadataPanel metadata={object.metadata} />
      </aside>
    );
  }

  const tags = getTags(resource.metadata.tags);
  const versioning = getStringMetadata(resource.metadata.versioning);
  const versioningEnabled = getBooleanMetadata(
    resource.metadata.versioningEnabled,
  );
  const isDatabase =
    resource.service === "database" || resource.type === "db-instance";
  const isAwsDatabase = isDatabase && resource.cloud === "aws";
  const isK8sEngine = resource.service === "k8s" || resource.type === "cluster";
  const isLambda =
    resource.service === "serverless" || resource.type === "lambda";

  return (
    <aside className="resource-inspector">
      <div className="widget-header">
        <h3>{resource.name}</h3>
        <span className="badge neutral">{resource.type}</span>
      </div>
      <div className="inspector-grid">
        <InspectorItem label="Cloud" value={resource.cloud} />
        <InspectorItem label="Service" value={resource.service} />
        <InspectorItem label="Region" value={resource.region ?? "-"} />
        <InspectorItem label="Created At" value={resource.createdAt ?? "-"} />
        {resource.status && (
          <InspectorItem label="Status" value={resource.status} />
        )}
        {resource.engine && (
          <InspectorItem label="Engine" value={resource.engine} />
        )}
        {resource.version && (
          <InspectorItem label="Version" value={resource.version} />
        )}
        {resource.instanceClass && (
          <InspectorItem label="Class" value={resource.instanceClass} />
        )}
        {versioning && <InspectorItem label="Versioning" value={versioning} />}
        {versioningEnabled !== null && (
          <InspectorItem
            label="Versioning Enabled"
            value={versioningEnabled ? "Yes" : "No"}
          />
        )}
        <InspectorItem label="Tags" value={`${tags.length}`} />
        {isLambda && (
          <>
            <InspectorItem
              label="Runtime"
              value={getStringMetadata(resource.metadata.runtime) ?? "-"}
            />
            <InspectorItem
              label="Handler"
              value={getStringMetadata(resource.metadata.handler) ?? "-"}
            />
            <InspectorItem
              label="Package Type"
              value={getStringMetadata(resource.metadata.packageType) ?? "-"}
            />
          </>
        )}
      </div>
      <section className="inspector-section">
        <p className="metric-label">Tags</p>
        {tags.length === 0 ? (
          <p className="muted compact-text">
            No tags returned for this resource.
          </p>
        ) : (
          <div className="metadata-tags">
            {tags.map((tag) => (
              <span className="metadata-tag" key={`${tag.key}:${tag.value}`}>
                <strong>{tag.key}</strong>
                <span>{tag.value}</span>
              </span>
            ))}
          </div>
        )}
      </section>
      {isDatabase && (
        <DatabaseConnectionsSection metadata={resource.metadata} />
      )}
      {isAwsDatabase && <DatabaseLifecycleSection status={resource.status} />}
      {isAwsDatabase && (
        <DatabaseSnapshotsSection instanceIdentifier={resource.name} />
      )}
      {isDatabase && !isAwsDatabase && (
        <ProviderDatabaseSection cloud={resource.cloud} />
      )}
      {isK8sEngine && (
        <K8sEngineDetails cloud={resource.cloud} clusterName={resource.name} />
      )}
      {isLambda && (
        <section className="inspector-section">
          <p className="metric-label">Lambda Details</p>
          <div className="inspector-grid compact-grid">
            <InspectorItem
              label="ARN"
              value={getStringMetadata(resource.metadata.arn) ?? "-"}
            />
            <InspectorItem
              label="Last Modified"
              value={getStringMetadata(resource.metadata.lastModified) ?? "-"}
            />
            <InspectorItem
              label="Memory"
              value={
                getNumberMetadata(resource.metadata.memorySize) === null
                  ? "-"
                  : `${getNumberMetadata(resource.metadata.memorySize)} MB`
              }
            />
            <InspectorItem
              label="Timeout"
              value={
                getNumberMetadata(resource.metadata.timeout) === null
                  ? "-"
                  : `${getNumberMetadata(resource.metadata.timeout)}s`
              }
            />
          </div>
        </section>
      )}
      <pre className="metadata-block">
        {JSON.stringify(resource.metadata, null, 2)}
      </pre>
      <MetadataPanel metadata={resource.metadata} />
    </aside>
  );
}

function ProviderDatabaseSection({ cloud }: { cloud: string }) {
  const label =
    cloud === "azure"
      ? "Azure database"
      : cloud === "gcp"
        ? "Google Cloud SQL"
        : "Database";

  return (
    <section className="inspector-section">
      <p className="metric-label">Lifecycle</p>
      <p className="muted compact-text">
        {label} lifecycle and snapshot actions are exposed through the
        normalized resource metadata only.
      </p>
    </section>
  );
}

function DatabaseConnectionsSection({
  metadata,
}: {
  metadata: Record<string, unknown>;
}) {
  const endpoint = getRecordMetadata(metadata.endpoint);
  const subnetGroup = getRecordMetadata(metadata.subnetGroup);
  const securityGroups = getSecurityGroups(metadata.vpcSecurityGroups);
  const address = getStringMetadata(endpoint?.address);
  const port = getNumberMetadata(endpoint?.port);
  const vpcId = getStringMetadata(subnetGroup?.vpcId);
  const subnetGroupName = getStringMetadata(subnetGroup?.name);
  const subnetGroupStatus = getStringMetadata(subnetGroup?.status);

  return (
    <section className="inspector-section">
      <p className="metric-label">Connections</p>
      <div className="inspector-grid compact-grid">
        <InspectorItem label="Endpoint" value={address ?? "-"} />
        <InspectorItem
          label="Port"
          value={port === null ? "-" : String(port)}
        />
        <InspectorItem label="VPC" value={vpcId ?? "-"} />
        <InspectorItem label="Subnet Group" value={subnetGroupName ?? "-"} />
        <InspectorItem label="Subnet Status" value={subnetGroupStatus ?? "-"} />
        <InspectorItem
          label="Security Groups"
          value={`${securityGroups.length}`}
        />
      </div>
      {securityGroups.length > 0 && (
        <div className="metadata-tags">
          {securityGroups.map((group) => (
            <span className="metadata-tag" key={`${group.id}:${group.status}`}>
              <strong>{group.id}</strong>
              <span>{group.status}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function DatabaseLifecycleSection({ status }: { status?: string | null }) {
  return (
    <section className="inspector-section">
      <p className="metric-label">Lifecycle</p>
      <div className="lifecycle-actions">
        <button className="button compact" type="button" disabled>
          Start
        </button>
        <button className="button compact" type="button" disabled>
          Stop
        </button>
      </div>
      <p className="muted compact-text">
        Current status: {status ?? "unknown"}. Start and stop are not supported
        by the local Floci RDS runtime.
      </p>
    </section>
  );
}

function DatabaseSnapshotsSection({
  instanceIdentifier,
}: {
  instanceIdentifier: string;
}) {
  const snapshotsQuery = useRdsSnapshotsQuery(instanceIdentifier);
  const createSnapshot = useCreateRdsSnapshotMutation();

  return (
    <section className="inspector-section">
      <div className="inspector-section-header">
        <p className="metric-label">Snapshots</p>
        <button
          className="button compact"
          type="button"
          disabled={createSnapshot.isPending}
          onClick={() => createSnapshot.mutate({ instanceIdentifier })}
        >
          {createSnapshot.isPending ? "Creating" : "Create DB snapshot"}
        </button>
      </div>
      {createSnapshot.isError && (
        <p className="error-text compact-text">
          {createSnapshot.error instanceof Error
            ? createSnapshot.error.message
            : "Snapshot creation failed."}
        </p>
      )}
      {snapshotsQuery.isLoading ? (
        <p className="muted compact-text">Loading snapshots.</p>
      ) : snapshotsQuery.isError ? (
        <p className="error-text compact-text">
          {snapshotsQuery.error instanceof Error
            ? snapshotsQuery.error.message
            : "Failed to load snapshots."}
        </p>
      ) : (snapshotsQuery.data?.length ?? 0) === 0 ? (
        <p className="muted compact-text">
          No snapshots returned for this DB instance.
        </p>
      ) : (
        <div className="snapshot-list">
          {snapshotsQuery.data?.map((snapshot) => (
            <div
              className="snapshot-row"
              key={snapshot.arn ?? snapshot.identifier}
            >
              <div>
                <strong>{snapshot.identifier}</strong>
                <span>{snapshot.createdAt ?? "No creation timestamp"}</span>
              </div>
              <span className="badge neutral">
                {snapshot.status ?? "unknown"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InspectorItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="metric-label">{label}</p>
      <p className="metric-value mono">{value}</p>
    </div>
  );
}

function MetadataPanel({ metadata }: { metadata: Record<string, unknown> }) {
  const rows = Object.entries(metadata).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );

  if (rows.length === 0) {
    return (
      <div className="metadata-block empty-metadata">
        <span>No metadata returned</span>
      </div>
    );
  }

  return (
    <div className="metadata-block metadata-table">
      {rows.map(([key, value]) => (
        <div key={key}>
          <span>{humanizeKey(key)}</span>
          <code>{String(value)}</code>
        </div>
      ))}
    </div>
  );
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}


function getStringMetadata(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getBooleanMetadata(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getNumberMetadata(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function getRecordMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getTags(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tag = item as Record<string, unknown>;
    return typeof tag.key === "string" && typeof tag.value === "string"
      ? [{ key: tag.key, value: tag.value }]
      : [];
  });
}

function getSecurityGroups(
  value: unknown,
): Array<{ id: string; status: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const group = item as Record<string, unknown>;
    return typeof group.id === "string"
      ? [
          {
            id: group.id,
            status: typeof group.status === "string" ? group.status : "-",
          },
        ]
      : [];
  });
}
