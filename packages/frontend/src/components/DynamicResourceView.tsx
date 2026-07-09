import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Info, Loader2, Plus, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCloudResource,
  deleteCloudResource,
  getServiceSchema,
  listCloudResources,
} from "@/api/cloudProxyClient";
import { DynamicFormRenderer } from "@/components/DynamicFormRenderer";
import { ResourceInspector } from "@/components/ResourceInspector";
import { ResourceTable } from "@/components/ResourceTable";
import { StorageObjectBrowser } from "@/components/StorageObjectBrowser";
import { ComputePanel, LaunchInstanceForm } from "@/components/ComputePanel";
import { NetworkingPanel } from "@/components/NetworkingPanel";
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
import { ServerlessInvokePanel } from "@/components/ServerlessInvokePanel";

interface DynamicResourceViewProps {
  cloud: CloudProvider;
  service: CloudServiceType;
  serviceAvailability?: CloudAvailability;
  cloudStatus?: CloudStatus;
  statusLoading?: boolean;
  onOpenInfo: () => void;
}

export function DynamicResourceView({
  cloud,
  service,
  serviceAvailability = "coming_soon",
  cloudStatus,
  statusLoading = false,
  onOpenInfo,
}: DynamicResourceViewProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CloudResource | undefined>();
  const [selectedObject, setSelectedObject] = useState<
    StorageObject | undefined
  >();
  const [createOpen, setCreateOpen] = useState(false);
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

  useEffect(() => {
    setSelected(undefined);
    setSelectedObject(undefined);
    setCreateOpen(false);
    setSearch("");
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
  const createResourceLabel = resourceCreateLabel(schema);
  const canUseRuntime = runtimeReachable && adapterAvailable;
  const canCreateResource =
    canUseRuntime && capabilityEnabled(createCapability);

  return (
    <div className="dynamic-resource-view">
      <TopbarServiceInfo onOpenInfo={onOpenInfo} />

      <div
        className={`resource-workbench${activeSelected ? " with-inspector" : ""}`}
      >
        <section className="resource-main">
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
            {canCreate && createOpen && (
              <div className="resource-create-inline">
                {service === "compute" ? (
                  <LaunchInstanceForm
                    cloud={cloud}
                    selectedResource={activeSelected}
                    onSuccess={(resource) => {
                      setSelected(resource);
                      setCreateOpen(false);
                    }}
                    onCancel={() => setCreateOpen(false)}
                  />
                ) : (
                  <DynamicFormRenderer
                    schema={schema}
                    isSubmitting={createMut.isPending}
                    submitLabel={createResourceLabel}
                    pendingLabel="Creating"
                    submitError={
                      createMut.error instanceof Error
                        ? createMut.error.message
                        : null
                    }
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
              resourcesLoading: resourcesQuery.isLoading,
              resourcesError: resourcesQuery.error,
              isRetrying: resourcesQuery.isFetching,
              onSelect: setSelected,
              onDelete: (resource) => deleteMut.mutate(resource),
              onRetry: () => resourcesQuery.refetch(),
            })}
          </section>
        </section>
        {activeSelected && (
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
      {service === "database" && cloud === "azure" && (
        <CosmosNoSqlPanel
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

function resourceCreateLabel(schema: ServiceSchema): string {
  if (schema.cloud === "aws" && schema.service === "storage")
    return "Create bucket";
  if (schema.cloud === "azure" && schema.service === "storage")
    return "Create container";
  if (schema.cloud === "azure" && schema.service === "database")
    return "Create database";
  return "Create resource";
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
  resourcesLoading,
  resourcesError,
  isRetrying,
  onSelect,
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
  resourcesLoading: boolean;
  resourcesError: unknown;
  isRetrying: boolean;
  onSelect: (resource: CloudResource) => void;
  onDelete: (resource: CloudResource) => void;
  onRetry?: () => void;
}) {
  if (statusLoading) {
    return (
      <RuntimeNotice
        title="Checking runtime"
        detail="Waiting for the proxy to confirm the selected cloud runtime."
        state="pending"
      />
    );
  }
  if (serviceAvailability !== "available") {
    return (
      <RuntimeNotice
        title="Adapter coming soon"
        detail={`${schema.displayName} uses the same normalized schema, but a runtime adapter is not registered yet.`}
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
