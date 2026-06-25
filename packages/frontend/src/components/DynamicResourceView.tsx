import { type ElementType, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Filter,
  Plus,
  RefreshCw,
  Table2,
  Workflow,
} from "lucide-react";
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
  capabilitySummary,
  normalizeCapabilities,
  withRuntimeState,
} from "@/lib/capabilities";
import type {
  CloudAvailability,
  CloudProvider,
  CloudServiceType,
  CloudStatus,
} from "@/types/cloud";
import type { CloudResource, StorageObject } from "@/types/resource";
import type {
  CapabilitySchema,
  ResourceActionName,
  ServiceSchema,
} from "@/types/schema";
import { CosmosNoSqlPanel } from "@/components/CosmosNoSqlPanel";
import { ServerlessInvokePanel } from "@/components/ServerlessInvokePanel";

interface DynamicResourceViewProps {
  cloud: CloudProvider;
  service: CloudServiceType;
  serviceAvailability?: CloudAvailability;
  cloudStatus?: CloudStatus;
  statusLoading?: boolean;
}

export function DynamicResourceView({
  cloud,
  service,
  serviceAvailability = "coming_soon",
  cloudStatus,
  statusLoading = false,
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

  useEffect(() => {
    setSelected(undefined);
    setSelectedObject(undefined);
    setCreateOpen(false);
  }, [cloud, service]);

  if (schemaQuery.isLoading) {
    return (
      <div className="empty compact">
        <h3>Loading schema</h3>
      </div>
    );
  }

  if (schemaQuery.isError || !schemaQuery.data) {
    return (
      <div className="cloud-coming-soon">
        <div>
          <p className="eyebrow">Coming Soon</p>
          <h3>
            {cloud.toUpperCase()} {service}
          </h3>
          <p className="muted">
            The proxy already exposes this provider as a placeholder. No adapter
            is registered yet.
          </p>
        </div>
        <div className="coming-soon-grid">
          <StatusTile
            label="Cloud"
            value={cloud.toUpperCase()}
            state="placeholder"
          />
          <StatusTile label="Service" value={service} state="placeholder" />
          <StatusTile label="Adapter" value="Not registered" state="pending" />
          <StatusTile label="Runtime" value="Future" state="pending" />
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
  const capabilityState = capabilitySummary([
    ...resourceCapabilities,
    ...objectCapabilities,
  ]);
  const createCapability = capabilityFor(resourceCapabilities, "create");
  const createResourceLabel = resourceCreateLabel(schema);
  const runtimeState = statusLoading
    ? "Checking runtime"
    : cloudStatus?.runtime === "reachable"
      ? "Runtime reachable"
      : cloudStatus?.runtime === "unavailable"
        ? "Runtime unavailable"
        : "Coming soon";
  const runtimeClass =
    cloudStatus?.runtime === "unavailable"
      ? "unavailable"
      : cloudStatus?.runtime === "reachable"
        ? "ready"
        : "pending";
  const adapterAvailable = serviceAvailability === "available";
  const adapterState = adapterAvailable ? "Adapter ready" : "Adapter pending";
  const resourceState = resourceStateFor(
    cloudStatus,
    statusLoading,
    serviceAvailability,
    resourcesQuery.isLoading,
    resourcesQuery.isError,
  );
  const canUseRuntime = runtimeReachable && adapterAvailable;
  const canCreateResource =
    canUseRuntime && capabilityEnabled(createCapability);
  const capabilitiesLabel =
    capabilityState.blocked > 0
      ? `${capabilityState.blocked} blocked`
      : capabilityState.partial > 0
        ? `${capabilityState.partial} partial`
        : "Capabilities verified";
  const capabilitiesClass =
    capabilityState.blocked > 0
      ? "unavailable"
      : capabilityState.partial > 0
        ? "pending"
        : "ready";

  return (
    <div className="dynamic-resource-view">
      <section className="dynamic-stage">
        <div className="dynamic-stage-header">
          <div>
            <p className="eyebrow">Dynamic View</p>
            <h3>{schema.displayName}</h3>
          </div>
          <div className="schema-action-list">
            <span className={`runtime-state ${runtimeClass}`}>
              {runtimeState}
            </span>
            <span
              className={`runtime-state ${adapterAvailable ? "ready" : "pending"}`}
            >
              {adapterState}
            </span>
            <span className={`runtime-state ${capabilitiesClass}`}>
              {capabilitiesLabel}
            </span>
            <span className={`runtime-state ${resourceState.className}`}>
              {resourceState.label}
            </span>
            <span className="schema-action resource-count">
              {resources.length} resources
            </span>
          </div>
        </div>

        <div className="dynamic-stage-grid">
          <FeatureTile
            icon={Filter}
            title="Dynamic Filters"
            value={`${schema.filters.length}`}
            detail="Schema-driven search and future filters"
          />
          <FeatureTile
            icon={Table2}
            title="Resources Table"
            value={`${schema.columns.length} columns`}
            detail="Normalized across AWS and Azure"
          />
          <FeatureTile
            icon={Workflow}
            title="Dynamic Actions"
            value={`${capabilityState.ready}/${capabilityState.total} ready`}
            detail={capabilityDetail([
              ...resourceCapabilities,
              ...objectCapabilities,
            ])}
          />
          <FeatureTile
            icon={Eye}
            title="Resource Inspector"
            value="Enabled"
            detail="Same normalized resource contract"
          />
        </div>
        <CapabilityStrip
          capabilities={[...resourceCapabilities, ...objectCapabilities]}
        />
      </section>

      <div className="resource-workbench">
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
              onSelect: setSelected,
              onDelete: (resource) => deleteMut.mutate(resource),
            })}
          </section>
        </section>
        <ResourceInspector resource={activeSelected} object={selectedObject} />
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

function withServiceAvailability<
  TAction extends
    | ResourceActionName
    | "upload"
    | "download"
    | "createFolder"
    | "copy",
>(
  capabilities: Array<CapabilitySchema<TAction>>,
  serviceAvailability: CloudAvailability,
): Array<CapabilitySchema<TAction>> {
  if (serviceAvailability === "available") return capabilities;
  return capabilities.map((capability) => ({
    ...capability,
    enabled: false,
    status: "coming_soon",
    reason:
      "This provider service schema is available, but no runtime adapter is registered yet.",
  }));
}

function capabilityDetail(
  capabilities: ReturnType<typeof normalizeCapabilities>,
): string {
  const active = capabilities
    .filter(capabilityEnabled)
    .map((capability) => capability.label);
  return active.length ? active.join(", ") : "No runtime actions available";
}

function CapabilityStrip({
  capabilities,
}: {
  capabilities: ReturnType<typeof normalizeCapabilities>;
}) {
  return (
    <div className="capability-strip">
      {capabilities.map((capability) => (
        <span
          key={capability.name}
          className={`capability-pill ${capability.status}`}
          title={capability.reason}
        >
          {capability.label}
        </span>
      ))}
    </div>
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

function FeatureTile({
  icon,
  title,
  value,
  detail,
}: {
  icon: ElementType;
  title: string;
  value: string;
  detail: string;
}) {
  const Icon = icon;
  return (
    <div className="feature-tile">
      <Icon size={22} />
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
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

function resourceStateFor(
  status: CloudStatus | undefined,
  statusLoading: boolean,
  serviceAvailability: CloudAvailability,
  resourcesLoading: boolean,
  resourcesError: boolean,
): { label: string; className: "ready" | "pending" | "unavailable" } {
  if (statusLoading)
    return { label: "Checking resources", className: "pending" };
  if (serviceAvailability !== "available")
    return { label: "Adapter pending", className: "pending" };
  if (status?.runtime === "unavailable")
    return { label: "Resources blocked", className: "unavailable" };
  if (status?.runtime === "coming_soon")
    return { label: "Resources pending", className: "pending" };
  if (resourcesLoading)
    return { label: "Loading resources", className: "pending" };
  if (resourcesError)
    return { label: "Resource error", className: "unavailable" };
  return { label: "Resources loaded", className: "ready" };
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
  onSelect,
  onDelete,
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
  onSelect: (resource: CloudResource) => void;
  onDelete: (resource: CloudResource) => void;
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
        title="Resource load failed"
        detail="The adapter is registered, but the proxy could not load resources from the selected runtime."
        error={
          resourcesError instanceof Error
            ? resourcesError.message
            : "Unknown resource error"
        }
        state="unavailable"
      />
    );
  }
  if (resourcesLoading) {
    return (
      <RuntimeNotice
        title="Loading resources"
        detail="Reading normalized resources from the selected cloud adapter."
        state="pending"
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
}: {
  title: string;
  detail: string;
  error?: string;
  state: "pending" | "unavailable";
}) {
  return (
    <div className={`runtime-notice ${state}`}>
      <h3>{title}</h3>
      <p>{detail}</p>
      {error && <code>{error}</code>}
    </div>
  );
}
