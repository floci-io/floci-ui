import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Info, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCloudResource,
  clearEmailInbox,
  deleteCloudResource,
  getServiceSchema,
  listCloudResources,
  updateCloudResource,
} from "@/api/cloudProxyClient";
import { DynamicFormRenderer } from "@/components/DynamicFormRenderer";
import { ResourceInspector } from "@/components/ResourceInspector";
import { ResourceTable } from "@/components/ResourceTable";
import { StorageObjectBrowser } from "@/components/StorageObjectBrowser";
import { ComputePanel, LaunchInstanceForm } from "@/components/ComputePanel";
import { NetworkingPanel } from "@/components/NetworkingPanel";
import { getPath } from "@/lib/resourcePath";
import {
  capabilityEnabled,
  capabilityFor,
  normalizeCapabilities,
  withRuntimeState,
  withServiceAvailability,
} from "@/lib/capabilities";
import type {
  CloudAvailability,
  CloudProvider,
  CloudServiceType,
  CloudStatus,
} from "@/types/cloud";
import type { CloudResource, StorageObject } from "@/types/resource";
import type { ServiceSchema } from "@/types/schema";
import { CosmosNoSqlPanel } from "@/components/CosmosNoSqlPanel";
import { AzureSqlPanel } from "@/components/AzureSqlPanel";
import { ServerlessInvokePanel } from "@/components/ServerlessInvokePanel";
import { DynamoDbTableExplorer } from "@/components/DynamoDbTableExplorer";
import { DatabaseSnapshotsPanel } from "@/components/DatabaseSnapshotsPanel";
import { CreateRdsInstanceForm } from "@/components/CreateRdsInstanceForm";

interface DynamicResourceViewProps {
  cloud: CloudProvider;
  service: CloudServiceType;
  serviceAvailability?: CloudAvailability;
  /** Server-supplied explanation, shown instead of generic coming-soon copy. */
  serviceReason?: string;
  cloudStatus?: CloudStatus;
  statusLoading?: boolean;
  onOpenInfo: () => void;
}

export function DynamicResourceView({
  cloud,
  service,
  serviceAvailability = "coming_soon",
  serviceReason,
  cloudStatus,
  statusLoading = false,
  onOpenInfo,
}: DynamicResourceViewProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [databaseTab, setDatabaseTab] = useState<"instances" | "snapshots">("instances");
  const [selected, setSelected] = useState<CloudResource | undefined>();
  const [selectedObject, setSelectedObject] = useState<
    StorageObject | undefined
  >();
  const [createOpen, setCreateOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const handleDatabaseTabChange = (tab: "instances" | "snapshots") => {
    setDatabaseTab(tab);
    if (tab === "snapshots") {
      setSearch("");
    }
  };

  const resourcesKey = useMemo(
    () => ["cloud-resources", cloud, service, search],
    [cloud, service, search],
  );

  const schemaQuery = useQuery({
    queryKey: ["cloud-schema", cloud, service],
    queryFn: ({ signal }) => getServiceSchema(cloud, service, signal),
  });

  const resourcesQuery = useQuery({
    queryKey: resourcesKey,
    queryFn: ({ signal }) => listCloudResources(cloud, service, search, signal),
    enabled:
      schemaQuery.isSuccess &&
      serviceAvailability === "available" &&
      cloudStatus?.runtime === "reachable",
  });

  const createMut = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      createCloudResource(cloud, service, values),
    onSuccess: (resource) => {
      setSelected(resource);
      setCreateOpen(false);
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", cloud, service],
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (resource: CloudResource) =>
      deleteCloudResource(cloud, service, resource.id),
    onSuccess: (_, resource) => {
      if (selected?.id === resource.id) setSelected(undefined);
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", cloud, service],
      });
    },
  });

  const clearInboxMut = useMutation({
    mutationFn: () => clearEmailInbox(cloud),
    onSuccess: () => {
      setSelected(undefined);
      setClearConfirm(false);
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", cloud, service],
      });
    },
  });

  const [editingResource, setEditingResource] = useState<CloudResource | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    if (successToast) {
      const timer = setTimeout(() => setSuccessToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successToast]);

  const updateMut = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      updateCloudResource(cloud, service, id, values),
    onSuccess: (updatedResource) => {
      setEditingResource(null);
      setUpdateError(null);
      setSelected(updatedResource);
      setSuccessToast(`Successfully updated ${updatedResource.name || updatedResource.id}`);
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", cloud, service],
      });
    },
    onError: (err) => {
      setUpdateError(err instanceof Error ? err.message : "Failed to update resource");
    },
  });

  const initialEditValues = useMemo(() => {
    if (!editingResource || !schemaQuery.data?.updateFields) return {};
    const vals: Record<string, unknown> = {};
    for (const field of schemaQuery.data.updateFields) {
      const path = field.valuePath ?? field.name;
      const currentVal = getPath(editingResource, path);
      if (currentVal !== undefined && currentVal !== null) {
        vals[field.name] = currentVal;
      }
    }
    return vals;
  }, [editingResource, schemaQuery.data?.updateFields]);

  function handleEditSubmit(values: Record<string, unknown>) {
    if (!editingResource || !schemaQuery.data?.updateFields) return;
    setUpdateError(null);

    const diff: Record<string, unknown> = {};
    for (const field of schemaQuery.data.updateFields) {
      const rawVal = values[field.name];
      const initialVal = initialEditValues[field.name];

      if (rawVal === undefined) continue;

      if (typeof rawVal === "string") {
        const trimmed = rawVal.trim();
        if (!trimmed && !field.required) {
          continue;
        }
        const initialStr =
          initialVal !== undefined && initialVal !== null ? String(initialVal).trim() : "";
        if (trimmed !== initialStr) {
          diff[field.name] = trimmed;
        }
      } else if (rawVal !== initialVal) {
        diff[field.name] = rawVal;
      }
    }

    if (Object.keys(diff).length === 0) {
      setUpdateError("No fields changed.");
      return;
    }

    updateMut.mutate({ id: editingResource.id, values: diff });
  }

  useEffect(() => {
    setSelected(undefined);
    setSelectedObject(undefined);
    setCreateOpen(false);
    setClearConfirm(false);
    setEditingResource(null);
    setUpdateError(null);
    setSearch("");
    setDatabaseTab("instances");
  }, [cloud, service]);

  useEffect(() => {
    setSelectedObject(undefined);
  }, [selected?.id]);

  const adapterAvailable = serviceAvailability === "available";

  if (schemaQuery.isLoading) {
    return (
      <div className="dynamic-resource-view">
        <TopbarServiceInfo onOpenInfo={onOpenInfo} />
        <div className="empty compact">
          <h3>Loading schema</h3>
        </div>
      </div>
    );
  }

  if (schemaQuery.isError || !schemaQuery.data) {
    return (
      <div className="dynamic-resource-view">
        <TopbarServiceInfo onOpenInfo={onOpenInfo} />
        <div className="cloud-coming-soon">
          <div>
            <p className="eyebrow">Coming Soon</p>
            <h3>
              {cloud.toUpperCase()} {service}
            </h3>
            <p className="muted">
              The proxy already exposes this provider as a placeholder. No
              adapter is registered yet.
            </p>
          </div>
          <div className="coming-soon-grid">
            <StatusTile
              label="Cloud"
              value={cloud.toUpperCase()}
              state="placeholder"
            />
            <StatusTile label="Service" value={service} state="placeholder" />
            <StatusTile
              label="Adapter"
              value="Not registered"
              state="pending"
            />
            <StatusTile label="Runtime" value="Future" state="pending" />
          </div>
        </div>
      </div>
    );
  }

  const schema = schemaQuery.data;
  const resources = resourcesQuery.data ?? [];
  const canCreate = schema.actions.includes("create");
  const activeSelected =
    selected?.cloud === cloud && selected.service === service
      ? selected
      : undefined;
  const runtimeReachable = cloudStatus?.runtime === "reachable";
  const resourceCapabilityInputs =
    schema.capabilities?.resourceActions ?? schema.actions;
  const resourceCapabilities = withServiceAvailability(
    withRuntimeState(
      normalizeCapabilities(resourceCapabilityInputs),
      runtimeReachable,
    ),
    serviceAvailability,
  );
  const objectCapabilities = withServiceAvailability(
    withRuntimeState(
      normalizeCapabilities(schema.capabilities?.objectActions),
      runtimeReachable,
    ),
    serviceAvailability,
  );
  const createCapability = capabilityFor(resourceCapabilities, "create");
  const createResourceLabel = createCapability?.label ?? "Create resource";
  const databaseCapabilities = withServiceAvailability(
    withRuntimeState(
      normalizeCapabilities(schema.capabilities?.databaseActions),
      runtimeReachable,
    ),
    serviceAvailability,
  );
  const listSnapshotCapability = capabilityFor(
    databaseCapabilities,
    "listSnapshots",
  );
  const createSnapshotCapability = capabilityFor(
    databaseCapabilities,
    "createSnapshot",
  );
  const canUseRuntime = runtimeReachable && adapterAvailable;
  const canCreateResource =
    canUseRuntime && capabilityEnabled(createCapability);
  const isAwsDatabase = cloud === "aws" && service === "database";
  const showDatabaseSnapshots = isAwsDatabase && databaseTab === "snapshots";

  return (
    <div className="dynamic-resource-view">
      <TopbarServiceInfo onOpenInfo={onOpenInfo} />

      <div
        className={`resource-workbench${activeSelected && !showDatabaseSnapshots ? " with-inspector" : ""}`}
      >
        <section className="resource-main">
          {isAwsDatabase && (
            <div className="drawer-tabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`drawer-tab ${databaseTab === "instances" ? "active" : ""}`}
                onClick={() => handleDatabaseTabChange("instances")}
              >
                Instances
              </button>
              <button
                type="button"
                className={`drawer-tab ${databaseTab === "snapshots" ? "active" : ""}`}
                onClick={() => handleDatabaseTabChange("snapshots")}
              >
                Snapshots
              </button>
            </div>
          )}

          {showDatabaseSnapshots ? (
            <DatabaseSnapshotsPanel
              cloud={cloud}
              instances={resources}
              listCapability={listSnapshotCapability}
              createCapability={createSnapshotCapability}
              runtimeReachable={canUseRuntime}
            />
          ) : (
            <section className="table-panel">
            <div className="input-row resource-table-bar">
              <div>
                <p className="eyebrow">Resources</p>
                <span className="muted">
                  {resources.length} normalized resources
                </span>
              </div>
              <div className="resource-table-tools">
                <input
                  className="input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter resources"
                />
                {service === "email" && (
                  clearConfirm ? (
                    <>
                      <button
                        className="button danger"
                        type="button"
                        disabled={!canUseRuntime || clearInboxMut.isPending}
                        onClick={() => clearInboxMut.mutate()}
                      >
                        <Trash2 size={14} />
                        {clearInboxMut.isPending ? "Clearing" : "Confirm clear"}
                      </button>
                      <button className="button" type="button" disabled={clearInboxMut.isPending} onClick={() => setClearConfirm(false)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="button danger"
                      type="button"
                      disabled={!canUseRuntime}
                      onClick={() => setClearConfirm(true)}
                    >
                      <Trash2 size={14} />
                      Clear inbox
                    </button>
                  )
                )}
                {canCreate && (
                  <button
                    className="button"
                    type="button"
                    disabled={!canCreateResource}
                    title={createCapability?.reason}
                    onClick={() => setCreateOpen((open) => !open)}
                  >
                    <Plus size={14} />
                    {createResourceLabel}
                    {createOpen ? (
                      <ChevronUp size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                  </button>
                )}
                <button
                  className="button"
                  type="button"
                  disabled={!canUseRuntime || resourcesQuery.isFetching}
                  onClick={() => resourcesQuery.refetch()}
                >
                  <RefreshCw size={14} />
                  {resourcesQuery.isFetching ? "Loading" : "Refresh"}
                </button>
              </div>
            </div>
            {service === "email" && clearInboxMut.isError && (
              <p className="error-text compact-text" style={{ margin: "0 12px 10px" }}>
                {clearInboxMut.error instanceof Error
                  ? clearInboxMut.error.message
                  : "Unable to clear the inbox."}
              </p>
            )}
            {canCreate && createOpen && (
              <div className="resource-create-inline">
                {/*
                 * AWS only. LaunchInstanceForm is an EC2 form: it asks for an AMI id,
                 * populates its dropdowns from the legacy /api/ec2 routes, and submits
                 * imageId/instanceType. On any other cloud that is the wrong form
                 * entirely — the Azure adapter rejects it with "resourceGroup is
                 * required". Every other cloud falls through to DynamicFormRenderer,
                 * which builds the right form from the adapter's own schema.
                 */}
                {service === "compute" && cloud === "aws" ? (
                  <LaunchInstanceForm
                    cloud={cloud}
                    selectedResource={activeSelected}
                    onSuccess={(resource) => {
                      setSelected(resource);
                      setCreateOpen(false);
                    }}
                    onCancel={() => setCreateOpen(false)}
                  />
                ) : service === "database" && cloud === "aws" ? (
                  <CreateRdsInstanceForm
                    cloud={cloud}
                    onSuccess={(resource) => {
                      setSelected(resource);
                      setCreateOpen(false);
                    }}
                    onCancel={() => setCreateOpen(false)}
                  />
                ) : (
                  <DynamicFormRenderer
                    key={`${cloud}:${service}:create`}
                    schema={schema}
                    isSubmitting={createMut.isPending}
                    submitLabel={createResourceLabel}
                    pendingLabel="Creating"
                    submitError={
                      createMut.error instanceof Error
                        ? createMut.error.message
                        : null
                    }
                    onCancel={() => setCreateOpen(false)}
                    onSubmit={(values) => createMut.mutate(values)}
                  />
                )}
              </div>
            )}
            {renderResourceSurface({
              schema,
              resources,
              selectedId: activeSelected?.id,
              deletingId: deleteMut.variables?.id,
              cloudStatus,
              statusLoading,
              serviceAvailability,
              serviceReason,
              resourcesLoading: resourcesQuery.isLoading,
              resourcesError: resourcesQuery.error,
              isRetrying: resourcesQuery.isFetching,
              onSelect: setSelected,
              onEdit:
                schema.updateFields &&
                schema.updateFields.length > 0 &&
                schema.actions.includes("update")
                  ? (resource) => {
                      setEditingResource(resource);
                      setUpdateError(null);
                    }
                  : undefined,
              onDelete: (resource) => deleteMut.mutate(resource),
              onRetry: () => resourcesQuery.refetch(),
            })}
          </section>
          )}
        </section>
        {activeSelected && !showDatabaseSnapshots && (
          <ResourceInspector
            resource={activeSelected}
            object={selectedObject}
          />
        )}
      </div>
      {service === "storage" && (
        <StorageObjectBrowser
          cloud={cloud}
          resource={selected}
          capabilities={objectCapabilities}
          runtimeReachable={canUseRuntime}
          selectedObjectKey={selectedObject?.key}
          onSelectObject={setSelectedObject}
        />
      )}
      {service === "compute" && (
        <ComputePanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={runtimeReachable}
        />
      )}
      {service === "networking" && (
        <NetworkingPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={runtimeReachable}
        />
      )}
      {service === "nosql" && cloud === "azure" && activeSelected?.type === "cosmos-database" && (
        <CosmosNoSqlPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {service === "database" &&
        cloud === "azure" &&
        (activeSelected?.type === "sql-server" ||
          activeSelected?.type === "postgres-flexible-server") && (
        <AzureSqlPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {service === "serverless" && (
        <ServerlessInvokePanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {service === "nosql" && cloud === "aws" && (
        <DynamoDbTableExplorer
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {editingResource && schema.updateFields && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!updateMut.isPending) setEditingResource(null);
          }}
        >
          <div
            className="create-table-modal"
            style={{ width: 520, maxWidth: "90vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="modal-header"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3 style={{ margin: 0 }}>
                Edit {schema.displayName}: {editingResource.name || editingResource.id}
              </h3>
              <button
                className="icon-btn"
                type="button"
                disabled={updateMut.isPending}
                onClick={() => setEditingResource(null)}
              >
                <X size={14} />
              </button>
            </div>
            <DynamicFormRenderer
              key={editingResource.id}
              schema={schema}
              fields={schema.updateFields}
              initialValues={initialEditValues}
              isSubmitting={updateMut.isPending}
              submitLabel="Save Changes"
              pendingLabel="Saving"
              submitError={updateError}
              onCancel={() => setEditingResource(null)}
              onSubmit={handleEditSubmit}
            />
          </div>
        </div>
      )}
      {successToast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "var(--accent, #3b82f6)",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            zIndex: 1000,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {successToast}
        </div>
      )}
    </div>
  );
}

function TopbarServiceInfo({ onOpenInfo }: { onOpenInfo: () => void }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSlot(document.getElementById("topbar-status"));
  }, []);
  if (!slot) return null;
  return createPortal(
    <button
      className="icon-btn"
      type="button"
      onClick={onOpenInfo}
      title="Service information"
    >
      <Info size={14} />
    </button>,
    slot,
  );
}

function StatusTile({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "placeholder" | "pending";
}) {
  return (
    <div className={`status-tile ${state}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function renderResourceSurface({
  schema,
  resources,
  selectedId,
  deletingId,
  cloudStatus,
  statusLoading,
  serviceAvailability,
  serviceReason,
  resourcesLoading,
  resourcesError,
  isRetrying,
  onSelect,
  onEdit,
  onDelete,
  onRetry,
}: {
  schema: ServiceSchema;
  resources: CloudResource[];
  selectedId?: string;
  deletingId?: string;
  cloudStatus?: CloudStatus;
  statusLoading: boolean;
  serviceAvailability: CloudAvailability;
  serviceReason?: string;
  resourcesLoading: boolean;
  resourcesError: unknown;
  isRetrying: boolean;
  onSelect: (resource: CloudResource) => void;
  onEdit?: (resource: CloudResource) => void;
  onDelete: (resource: CloudResource) => void;
  onRetry?: () => void;
}) {
  if (statusLoading) {
    return (
      <RuntimeNotice
        title="Loading service"
        detail="Waiting for the proxy to describe this service and confirm its runtime."
        state="pending"
      />
    );
  }
  if (serviceAvailability !== "available") {
    return (
      <RuntimeNotice
        title="Adapter coming soon"
        detail={
          serviceReason ??
          `${schema.displayName} uses the same normalized schema, but a runtime adapter is not registered yet.`
        }
        state="pending"
      />
    );
  }
  if (cloudStatus?.runtime === "unavailable") {
    return (
      <RuntimeNotice
        title="Runtime unavailable"
        detail={`${cloudStatus.endpoint ?? "Runtime endpoint"} is not reachable. Start the selected runtime before loading resources.`}
        error={cloudStatus.error ?? undefined}
        state="unavailable"
      />
    );
  }
  if (resourcesError) {
    return (
      <RuntimeNotice
        title={`Unable to load ${schema.displayName}.`}
        detail={`The proxy could not fetch ${schema.displayName} resources from the runtime.`}
        error={
          resourcesError instanceof Error
            ? resourcesError.message
            : "Unknown resource error"
        }
        state="unavailable"
        isRetrying={isRetrying}
        onRetry={onRetry}
      />
    );
  }
  if (resourcesLoading) {
    return (
      <RuntimeNotice
        title={`Loading ${schema.displayName}...`}
        detail={`Reading ${schema.displayName} resources from the runtime.`}
        state="pending"
        showSpinner={true}
      />
    );
  }

  return (
    <ResourceTable
      schema={schema}
      resources={resources}
      selectedId={selectedId}
      deletingId={deletingId}
      onSelect={onSelect}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

function RuntimeNotice({
  title,
  detail,
  error,
  state,
  showSpinner,
  isRetrying,
  onRetry,
}: {
  title: string;
  detail: string;
  error?: string;
  state: "pending" | "unavailable";
  showSpinner?: boolean;
  isRetrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`runtime-notice ${state}`}>
      {(showSpinner || isRetrying) && (
        <Loader2
          size={24}
          className="spin"
          style={{ marginBottom: 8, color: "var(--accent)" }}
        />
      )}
      <h3>{title}</h3>
      <p>{detail}</p>
      {error && <code>{error}</code>}
      {onRetry && (
        <button
          className="button"
          type="button"
          style={{ marginTop: 12 }}
          disabled={isRetrying}
          onClick={() => { if (!isRetrying) onRetry(); }}
        >
          {isRetrying ? "Retrying\u2026" : "Retry"}
        </button>
      )}
    </div>
  );
}
