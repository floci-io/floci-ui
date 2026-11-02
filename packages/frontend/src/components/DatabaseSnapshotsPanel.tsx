import { useState } from "react";
import {Icon, Camera, PlusSquared as Plus, RefreshCwSquared as RefreshCw} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDatabaseSnapshot, listDatabaseSnapshots } from "@/api/cloudProxyClient";
import { HttpError } from "@/api/HttpClient";
import { EmptyState } from "@/components/EmptyState";
import { capabilityEnabled } from "@/lib/capabilities";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource } from "@/types/resource";
import type { CapabilitySchema, DatabaseActionName } from "@/types/schema";
import {RowsSkeleton} from '@/components/PageSkeleton'

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
          <Button title={createCapability?.reason} variant="secondary"
            type="button"
            disabled={!canCreate}
            onClick={() => setCreateOpen((open) => !open)}
          >
            <Icon icon={Plus} size={14} />
            Create DB snapshot
          </Button>
          <Button variant="secondary"
            type="button"
            disabled={!canList || snapshotsQuery.isFetching}
            onClick={() => snapshotsQuery.refetch()}
          >
            <Icon icon={RefreshCw} size={14} />
            {snapshotsQuery.isFetching ? "Loading" : "Refresh"}
          </Button>
        </div>
      </div>

      {createOpen && (
        <div className="resource-create-inline mt-2.5 mx-3 mb-4">
          <form onSubmit={handleCreateSubmit} className="dynamic-form">
            <div className="form-group">
              <label className="form-label" htmlFor="source-instance-select">
                Source Instance *
              </label>
              <OptionSelect
                id="source-instance-select"
                required
                value={sourceInstance}
                onValueChange={(value) => handleSourceChange(value)}
              >
                <option value="">Select a DB instance</option>
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.name}>
                    {inst.name}
                  </option>
                ))}
              </OptionSelect>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="snapshot-id-input">
                Snapshot Identifier *
              </label>
              <Input
                id="snapshot-id-input"
                type="text"
                required
                value={snapshotId}
                onChange={(e) => setSnapshotId(e.target.value)}
                placeholder="e.g. my-db-snapshot-1"
              />
            </div>

            {createMut.isError && (
              <div role="alert" className="error-text compact-text mt-2">
                {getErrorMessage(createMut.error)}
              </div>
            )}

            <div className="form-actions mt-3">
              <Button title={createCapability?.reason}
                type="submit"
                disabled={!canCreate || !isFormValid || createMut.isPending}
              >
                {createMut.isPending ? "Creating…" : "Create snapshot"}
              </Button>
              <Button variant="secondary"
                type="button"
                disabled={createMut.isPending}
                onClick={() => {
                  setCreateOpen(false);
                  createMut.reset();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {!canList ? (
        <p className="muted compact-text p-4">
          {listCapability?.reason ?? "Snapshot listing is not available."}
        </p>
      ) : snapshotsQuery.isLoading ? (
        <RowsSkeleton rows={4} label="Loading snapshots"/>
      ) : snapshotsQuery.isError ? (
        <div role="alert" className="error-text compact-text p-4">
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
        <div className="snapshot-list pt-0 px-3 pb-3">
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
