import { useState } from "react";
import { Camera, Loader2, Plus, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDatabaseSnapshot, listDatabaseSnapshots } from "@/api/cloudProxyClient";
import { HttpError } from "@/api/HttpClient";
import { EmptyState } from "@/components/EmptyState";
import { capabilityEnabled } from "@/lib/capabilities";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource } from "@/types/resource";
import type { CapabilitySchema, DatabaseActionName } from "@/types/schema";

export interface DatabaseSnapshotsPanelProps {
  cloud: CloudProvider;
  instances: CloudResource[];
  listCapability?: CapabilitySchema<DatabaseActionName>;
  createCapability?: CapabilitySchema<DatabaseActionName>;
  runtimeReachable: boolean;
}

export function DatabaseSnapshotsPanel({
  cloud,
  instances,
  listCapability,
  createCapability,
  runtimeReachable,
}: DatabaseSnapshotsPanelProps) {
  const qc = useQueryClient();
  const [sourceInstance, setSourceInstance] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const canList = runtimeReachable && capabilityEnabled(listCapability);
  const canCreate = runtimeReachable && capabilityEnabled(createCapability);

  const snapshotsQuery = useQuery({
    queryKey: ["database-snapshots", cloud],
    queryFn: ({ signal }) => listDatabaseSnapshots(cloud, undefined, signal),
    enabled: canList,
  });

  const createMut = useMutation({
    mutationFn: (input: { instanceIdentifier: string; snapshotIdentifier: string }) =>
      createDatabaseSnapshot(cloud, input),
    onSuccess: () => {
      setSourceInstance("");
      setSnapshotId("");
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["database-snapshots", cloud] });
    },
  });

  const handleSourceChange = (newInstance: string) => {
    setSourceInstance(newInstance);
    if (newInstance) {
      setSnapshotId(`${newInstance}-snapshot-${Date.now()}`);
    } else {
      setSnapshotId("");
    }
  };

  const isFormValid = Boolean(sourceInstance.trim() && snapshotId.trim());

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !canCreate || createMut.isPending) return;
    createMut.mutate({
      instanceIdentifier: sourceInstance.trim(),
      snapshotIdentifier: snapshotId.trim(),
    });
  };

  const getErrorMessage = (error: unknown): string => {
    if (
      error instanceof HttpError &&
      typeof error.body === "object" &&
      error.body !== null &&
      "code" in error.body &&
      (error.body as { code?: unknown }).code === "operation_not_implemented"
    ) {
      return "Snapshot creation is available in Floci UI, but the selected Floci runtime does not implement CreateDBSnapshot.";
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Snapshot creation failed.";
  };

  return (
    <section className="table-panel">
      <div className="input-row resource-table-bar">
        <div>
          <p className="eyebrow">Database Snapshots</p>
          <span className="muted">
            {snapshotsQuery.data ? `${snapshotsQuery.data.length} snapshots` : "Snapshots"}
          </span>
        </div>
        <div className="resource-table-tools">
          <button
            className="button"
            type="button"
            disabled={!canCreate}
            title={createCapability?.reason}
            onClick={() => setCreateOpen((open) => !open)}
          >
            <Plus size={14} />
            Create DB snapshot
          </button>
          <button
            className="button"
            type="button"
            disabled={!canList || snapshotsQuery.isFetching}
            onClick={() => snapshotsQuery.refetch()}
          >
            <RefreshCw size={14} />
            {snapshotsQuery.isFetching ? "Loading" : "Refresh"}
          </button>
        </div>
      </div>

      {createOpen && (
        <div className="resource-create-inline" style={{ margin: "10px 12px 16px" }}>
          <form onSubmit={handleCreateSubmit} className="dynamic-form">
            <div className="form-group">
              <label className="form-label" htmlFor="source-instance-select">
                Source Instance *
              </label>
              <select
                id="source-instance-select"
                className="input"
                required
                value={sourceInstance}
                onChange={(e) => handleSourceChange(e.target.value)}
              >
                <option value="">Select a DB instance</option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.name}>
                    {inst.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="snapshot-id-input">
                Snapshot Identifier *
              </label>
              <input
                id="snapshot-id-input"
                className="input"
                type="text"
                required
                value={snapshotId}
                onChange={(e) => setSnapshotId(e.target.value)}
                placeholder="e.g. my-db-snapshot-1"
              />
            </div>

            {createMut.isError && (
              <div role="alert" className="error-text compact-text" style={{ marginTop: 8 }}>
                {getErrorMessage(createMut.error)}
              </div>
            )}

            <div className="form-actions" style={{ marginTop: 12 }}>
              <button
                className="button primary"
                type="submit"
                disabled={!canCreate || !isFormValid || createMut.isPending}
                title={createCapability?.reason}
              >
                {createMut.isPending ? "Creating…" : "Create snapshot"}
              </button>
              <button
                className="button"
                type="button"
                disabled={createMut.isPending}
                onClick={() => {
                  setCreateOpen(false);
                  createMut.reset();
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {!canList ? (
        <p className="muted compact-text" style={{ padding: "16px" }}>
          {listCapability?.reason ?? "Snapshot listing is not available."}
        </p>
      ) : snapshotsQuery.isLoading ? (
        <div className="empty compact">
          <Loader2 size={18} className="spin" />
          <p>Loading snapshots…</p>
        </div>
      ) : snapshotsQuery.isError ? (
        <div role="alert" className="error-text compact-text" style={{ padding: "16px" }}>
          {snapshotsQuery.error instanceof Error
            ? snapshotsQuery.error.message
            : "Failed to load database snapshots."}
        </div>
      ) : (snapshotsQuery.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Camera}
          title="No snapshots"
          description="No snapshots returned for this account."
        />
      ) : (
        <div className="snapshot-list" style={{ padding: "0 12px 12px" }}>
          {snapshotsQuery.data?.map((snapshot) => (
            <div className="snapshot-row" key={snapshot.id || snapshot.name}>
              <div>
                <strong>{snapshot.name}</strong>
                <span>
                  {snapshot.instanceIdentifier
                    ? `Instance: ${snapshot.instanceIdentifier}`
                    : "Unknown instance"}
                  {snapshot.createdAt
                    ? ` · ${snapshot.createdAt}`
                    : " · No creation timestamp"}
                  {snapshot.engine ? ` · ${snapshot.engine}` : ""}
                  {snapshot.version ? ` (${snapshot.version})` : ""}
                </span>
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
