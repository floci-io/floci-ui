import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Info, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCloudResource,
  clearEmailInbox,
  deleteCloudResource,
  emptyStorageBucket,
  getCloudResource,
  getServiceSchema,
  listCloudResources,
  updateCloudResource,
} from "@/api/cloudProxyClient";
import { DynamicFormRenderer } from "@/components/DynamicFormRenderer";
import { ResourceInspector } from "@/components/ResourceInspector";
import { ResourceTable } from "@/components/ResourceTable";
import { StorageObjectBrowser } from "@/components/StorageObjectBrowser";
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
import { dataExplorerPath } from "@/lib/dataExplorer";
import { useAccountId } from "@/lib/accountStore";
import { CreateRdsInstanceForm } from "@/components/CreateRdsInstanceForm";
import { lazyPanel } from "@/lib/lazyPanel";
import { ModalOverlay } from "@/components/ModalOverlay";
import {
  storageObjectsKey,
  storageObjectWriteKey,
  storageTargetKey as targetKey,
  writeLandsIn,
  type StorageTarget,
} from "@/lib/storageQueryKeys";

const ComputePanel = lazyPanel(() => import("@/components/ComputePanel").then((m) => m.ComputePanel));
const ComputePowerPanel = lazyPanel(() => import("@/components/ComputePowerPanel").then((m) => m.ComputePowerPanel));
const LaunchInstanceForm = lazyPanel(() => import("@/components/ComputePanel").then((m) => m.LaunchInstanceForm));
const NetworkingPanel = lazyPanel(() => import("@/components/NetworkingPanel").then((m) => m.NetworkingPanel));
const ServerlessInvokePanel = lazyPanel(() => import("@/components/ServerlessInvokePanel").then((m) => m.ServerlessInvokePanel));
const WorkflowExecutionsPanel = lazyPanel(() => import("@/components/WorkflowExecutionsPanel").then((m) => m.WorkflowExecutionsPanel));
const DatabaseSnapshotsPanel = lazyPanel(() => import("@/components/DatabaseSnapshotsPanel").then((m) => m.DatabaseSnapshotsPanel));
const AppConfigPanel = lazyPanel(() => import("@/components/AppConfigPanel").then((m) => m.AppConfigPanel));
const KmsCryptoPanel = lazyPanel(() => import("@/components/KmsCryptoPanel").then((m) => m.KmsCryptoPanel));
const AzureKeyVaultPanel = lazyPanel(() => import("@/components/AzureKeyVaultPanel").then((m) => m.AzureKeyVaultPanel));
const OciKmsActionsPanel = lazyPanel(() => import("@/components/OciKmsActionsPanel").then((m) => m.OciKmsActionsPanel));
const SqsMessagingPanel = lazyPanel(() => import("@/components/SqsMessagingPanel").then((m) => m.SqsMessagingPanel));
const StreamMessagesPanel = lazyPanel(() => import("@/components/StreamMessagesPanel").then((m) => m.StreamMessagesPanel));
const LogsQueryPanel = lazyPanel(() => import("@/components/LogsQueryPanel").then((m) => m.LogsQueryPanel));
const SageMakerDashboardPanel = lazyPanel(() => import("@/components/SageMakerDashboardPanel").then((m) => m.SageMakerDashboardPanel));

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
  const accountId = useAccountId();
  const [search, setSearch] = useState("");
  const [viewState, setViewState] = useState("active");
  const [databaseTab, setDatabaseTab] = useState<"instances" | "snapshots">("instances");
  const [logsTab, setLogsTab] = useState<"groups" | "insights">("groups");
  const [selection, setSelection] = useState<
    { accountId: string; resource: CloudResource } | undefined
  >();
  const selected = selection?.accountId === accountId ? selection.resource : undefined;
  const selectResource = (resource: CloudResource | undefined) => {
    setSelection(resource ? { accountId, resource } : undefined);
  };
  const [selectedObject, setSelectedObject] = useState<
    StorageObject | undefined
  >();
  const [createOpen, setCreateOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [isDeleteMulti, setIsDeleteMulti] = useState(false);
  const [selectedItems, setSelectedItems] = useState<CloudResource[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // Kept with the account it was for, like the single-delete refusal below.
  const [bulkDeleteError, setBulkDeleteError] = useState<
    { accountId: string; message: string } | null
  >(null);
  // A refused bucket delete, kept with the account and bucket it was for.
  const [bucketDeleteError, setBucketDeleteError] = useState<
    { accountId: string; bucketId: string; message: string } | null
  >(null);
  // The bucket the open Empty bucket dialog was opened for, captured at that moment.
  const [emptyConfirm, setEmptyConfirm] = useState<StorageTarget | null>(null);

  const handleDatabaseTabChange = (tab: "instances" | "snapshots") => {
    setDatabaseTab(tab);
    if (tab === "snapshots") {
      setSearch("");
    }
  };

  const handleLogsTabChange = (tab: "groups" | "insights") => {
    setLogsTab(tab);
    if (tab === "insights") {
      setSearch("");
    }
  };

  const schemaQuery = useQuery({
    queryKey: ["cloud-schema", cloud, service],
    queryFn: ({ signal }) => getServiceSchema(cloud, service, signal),
  });

  // A schema that declares a `state` select (Key Vault: active or soft-deleted
  // secrets) gets a view selector; every other service lists exactly as before.
  const viewStateFilter = schemaQuery.data?.filters.find(
    (filter) => filter.name === "state" && filter.type === "select",
  );
  const listFilters = viewStateFilter ? { state: viewState } : undefined;
  const viewingDeleted = viewStateFilter !== undefined && viewState === "deleted";

  useEffect(() => {
    setViewState("active");
  }, [accountId, cloud, service]);

  const resourcesKey = useMemo(
    () => ["cloud-resources", accountId, cloud, service, search, listFilters?.state ?? ""],
    [accountId, cloud, service, search, listFilters?.state],
  );

  const resourcesQuery = useQuery({
    queryKey: resourcesKey,
    queryFn: ({ signal }) => listCloudResources(cloud, service, search, signal, listFilters),
    enabled:
      schemaQuery.isSuccess &&
      serviceAvailability === "available" &&
      cloudStatus?.runtime === "reachable",
  });
  const selectedForService =
    selected?.cloud === cloud && selected.service === service
      ? selected
      : undefined;
  const resourceDetailQuery = useQuery({
    queryKey: ["cloud-resource", accountId, cloud, service, selectedForService?.id],
    queryFn: ({ signal }) =>
      getCloudResource(cloud, service, selectedForService!.id, signal),
    enabled:
      selectedForService !== undefined &&
      schemaQuery.data?.actions.includes("inspect") === true &&
      serviceAvailability === "available" &&
      cloudStatus?.runtime === "reachable",
  });
  const storageTarget: StorageTarget | undefined =
    service === "storage" && selectedForService
      ? { accountId, cloud, bucketId: selectedForService.id }
      : undefined;
  const storageTargetKey = storageTarget ? targetKey(storageTarget) : "";
  // Settlement callbacks compare against the target on screen now, not the one
  // their closure saw when the request was sent.
  const storageTargetKeyRef = useRef(storageTargetKey);
  useEffect(() => {
    storageTargetKeyRef.current = storageTargetKey;
  }, [storageTargetKey]);

  const emptyMut = useMutation({
    mutationFn: (target: StorageTarget) =>
      emptyStorageBucket(target.accountId, target.cloud, target.bucketId),
    // Earlier batches may have been deleted even when the call fails, so every
    // outcome refreshes the bucket it ran against.
    onSettled: (_result, _error, target) => {
      setEmptyConfirm(null);
      void qc.invalidateQueries({ queryKey: storageObjectsKey(target) });
      void qc.invalidateQueries({
        queryKey: ["cloud-resource", target.accountId, target.cloud, "storage", target.bucketId],
      });
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", target.accountId, target.cloud, "storage"],
      });
    },
    onSuccess: (result, target) => {
      if (storageTargetKeyRef.current !== targetKey(target)) return;
      setSelectedObject(undefined);
      // A "not empty" refusal for this bucket no longer holds.
      setBucketDeleteError((refusal) =>
        refusal?.accountId === target.accountId && refusal.bucketId === target.bucketId ? null : refusal,
      );
      setSuccessToast(
        `Emptied ${target.bucketId}: permanently deleted ${result.deleted} object version(s) and delete marker(s).`,
      );
    },
  });
  const emptyingKey =
    emptyMut.isPending && emptyMut.variables ? targetKey(emptyMut.variables) : undefined;
  // An upload, delete, copy or move already sent to this bucket could land
  // after Empty bucket's final check, so Empty bucket waits for it to settle.
  const objectWritesPending =
    useIsMutating({
      mutationKey: storageObjectWriteKey,
      predicate: (mutation) =>
        storageTarget !== undefined && writeLandsIn(mutation.state.variables, storageTarget),
    }) > 0;

  const isAwsSageMaker = cloud === "aws" && service === "sagemaker";
  const isGcpCompute = cloud === "gcp" && service === "compute";
  const canDeleteResource = viewingDeleted
    ? () => false
    : isAwsSageMaker
      ? (resource: CloudResource) => resource.type !== "sagemaker-training-job"
      : isGcpCompute
        ? (resource: CloudResource) => resource.type !== "disk"
        : emptyingKey !== undefined
          ? (resource: CloudResource) => targetKey({ accountId, cloud, bucketId: resource.id }) !== emptyingKey
          : undefined;
  const sagemakerDashboardResourcesQuery = useQuery({
    queryKey: ["sagemaker-dashboard-resources", accountId, cloud, service],
    queryFn: ({ signal }) => listCloudResources(cloud, service, "", signal),
    enabled:
      isAwsSageMaker &&
      schemaQuery.isSuccess &&
      serviceAvailability === "available" &&
      cloudStatus?.runtime === "reachable",
  });

  // Automatically reconcile selected items when resources query data changes
  useEffect(() => {
    setSelectedItems((prev) => {
      if (prev.length === 0) return prev;
      const currentIds = new Set((resourcesQuery.data || []).map((r) => r.id));
      const next = prev.filter((item) => currentIds.has(item.id));
      return next.length === prev.length ? prev : next;
    });
  }, [resourcesQuery.data]);

  const selectMultiple = (select?: CloudResource | boolean) => {
    const currentResources = (resourcesQuery.data || []).filter(
      (r) => canDeleteResource?.(r) ?? true,
    );
    if (typeof select === "boolean" || select === undefined) {
      const isAllCurrentlySelected =
        currentResources.length > 0 &&
        currentResources.every((r) =>
          selectedItems.some((item) => item.id === r.id),
        );
      const shouldSelectAll =
        typeof select === "boolean" ? select : !isAllCurrentlySelected;

      if (shouldSelectAll) {
        setSelectedItems(currentResources);
      } else {
        setSelectedItems([]);
      }
    } else {
      setSelectedItems((prev) => {
        const exists = prev.some((item) => item.id === select.id);
        return exists
          ? prev.filter((item) => item.id !== select.id)
          : [...prev, select];
      });
    }
  };

  const createMut = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      createCloudResource(cloud, service, values),
    onSuccess: (resource) => {
      selectResource(resource);
      setCreateOpen(false);
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, service],
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (resource: CloudResource) =>
      deleteCloudResource(cloud, service, resource.id),
    onMutate: () => {
      setBucketDeleteError(null);
      return { accountId };
    },
    onError: (error, resource, context) => {
      if (resource.service !== "storage" || !context) return;
      setBucketDeleteError({
        accountId: context.accountId,
        bucketId: resource.id,
        message: `Could not delete ${resource.name || resource.id}: ${errorMessage(error)}`,
      });
    },
    onSuccess: (_, resource) => {
      if (selected?.id === resource.id) selectResource(undefined);
      setSelectedItems((prev) => prev.filter((item) => item.id !== resource.id));
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, service],
      });
    },
  });

  const deleteMultipleMut = useMutation({
    mutationFn: async (items: CloudResource[]) => {
      const results = await Promise.allSettled(
        items.map(async (item) => {
          await deleteCloudResource(cloud, service, item.id);
          return item.id;
        }),
      );
      const succeededIds = new Set<string>();
      const failedItems: { id: string; error: unknown }[] = [];

      results.forEach((res, index) => {
        if (res.status === "fulfilled") {
          succeededIds.add(res.value);
        } else {
          failedItems.push({ id: items[index].id, error: res.reason });
        }
      });

      return { succeededIds, failedItems };
    },
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, service],
      });
    },
    onMutate: () => ({ accountId }),
    onSuccess: ({ succeededIds, failedItems }, _items, context) => {
      setDeleteConfirm(false);
      setSelectedItems((prev) =>
        prev.filter((item) => !succeededIds.has(item.id)),
      );
      if (selected && succeededIds.has(selected.id)) {
        selectResource(undefined);
      }

      if (failedItems.length > 0) {
        // A bucket refusing deletion usually still holds versions, so each
        // refused bucket is named with its reason (and its Empty bucket hint).
        const reasons =
          service === "storage"
            ? failedItems.map(({ id, error }) => `\n${id}: ${errorMessage(error)}`).join("")
            : "";
        setBulkDeleteError({
          accountId: context.accountId,
          message: `Failed to delete ${failedItems.length} of ${
            succeededIds.size + failedItems.length
          } selected resource(s).${reasons}`,
        });
      } else {
        setBulkDeleteError(null);
        setIsDeleteMulti(false);
        setSuccessToast(
          `Successfully deleted ${succeededIds.size} resource(s).`,
        );
      }
    },
  });

  const clearInboxMut = useMutation({
    mutationFn: () => clearEmailInbox(cloud),
    onSuccess: () => {
      selectResource(undefined);
      setClearConfirm(false);
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, service],
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
      selectResource(updatedResource);
      setSuccessToast(`Successfully updated ${updatedResource.name || updatedResource.id}`);
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", accountId, cloud, service],
      });
      void qc.resetQueries({
        queryKey: ["cloud-resource", accountId, cloud, service, updatedResource.id],
        exact: true,
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
    setSelection(undefined);
    setSelectedObject(undefined);
    setCreateOpen(false);
    setClearConfirm(false);
    setDeleteConfirm(false);
    setBulkDeleteError(null);
    setBucketDeleteError(null);
    setEditingResource(null);
    setUpdateError(null);
    setSearch("");
    setDatabaseTab("instances");
    setIsDeleteMulti(false);
    setSelectedItems([]);
  }, [accountId, cloud, service]);

  // A confirmation belongs to the bucket it was opened for. Once the selected
  // bucket, account or cloud changes it is stale, unless it is already running.
  useEffect(() => {
    if (emptyMut.isPending) return;
    setEmptyConfirm((open) =>
      open && targetKey(open) === storageTargetKey ? open : null,
    );
  }, [storageTargetKey, emptyMut.isPending]);

  useEffect(() => {
    if (selectedItems.length === 0 && deleteConfirm) {
      setDeleteConfirm(false);
    }
  }, [selectedItems.length, deleteConfirm]);

  useEffect(() => {
    setSelectedObject(undefined);
  }, [selected?.id]);

  const adapterAvailable = serviceAvailability === "available";

  if (schemaQuery.isLoading) {
    return (
      <div className="dynamic-resource-view">
        <TopbarServiceInfo onOpenInfo={onOpenInfo} />
        <div className="empty compact">
          <h2>Loading schema</h2>
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
            <h2>
              {cloud.toUpperCase()} {service}
            </h2>
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
  const canDelete = schema.actions.includes("delete");
  const selectableResources = resources.filter(
    (r) => canDeleteResource?.(r) ?? true,
  );
  const isAllSelected =
    selectableResources.length > 0 &&
    selectableResources.every((r) => selectedItems.some((s) => s.id === r.id));
  const activeSelected = selectedForService;
  const inspectedResource =
    !resourceDetailQuery.isFetching && resourceDetailQuery.data?.id === activeSelected?.id
      ? resourceDetailQuery.data
      : activeSelected;
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
  const emptyCapability =
    service === "storage" ? capabilityFor(resourceCapabilities, "emptyBucket") : undefined;
  const deletionPending = deleteMut.isPending || deleteMultipleMut.isPending;
  const canEmptyBucket =
    storageTarget !== undefined &&
    canUseRuntime &&
    capabilityEnabled(emptyCapability) &&
    !emptyMut.isPending &&
    !deletionPending &&
    !objectWritesPending;
  const showEmptyError =
    emptyMut.isError &&
    emptyMut.variables !== undefined &&
    targetKey(emptyMut.variables) === storageTargetKey;
  const isAwsDatabase = cloud === "aws" && service === "database";
  const showDatabaseSnapshots = isAwsDatabase && databaseTab === "snapshots";
  const isAwsLogs = cloud === "aws" && service === "logs";
  const showLogsInsights = isAwsLogs && logsTab === "insights";

  return (
    <div className="dynamic-resource-view">
      <TopbarServiceInfo onOpenInfo={onOpenInfo} />

      <div
        className={`resource-workbench${activeSelected && !showDatabaseSnapshots && !showLogsInsights ? " with-inspector" : ""}`}
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

          {isAwsLogs && (
            <div className="drawer-tabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`drawer-tab ${logsTab === "groups" ? "active" : ""}`}
                onClick={() => handleLogsTabChange("groups")}
              >
                Log groups
              </button>
              <button
                type="button"
                className={`drawer-tab ${logsTab === "insights" ? "active" : ""}`}
                onClick={() => handleLogsTabChange("insights")}
              >
                Logs Insights
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
            <>
            {isAwsSageMaker && (
              <SageMakerDashboardPanel
                resources={sagemakerDashboardResourcesQuery.data ?? []}
                isRefreshing={sagemakerDashboardResourcesQuery.isFetching || resourcesQuery.isFetching}
                updatedAt={sagemakerDashboardResourcesQuery.dataUpdatedAt}
                onRefresh={() => {
                  void sagemakerDashboardResourcesQuery.refetch()
                  void resourcesQuery.refetch()
                }}
              />
            )}
            <section className="table-panel" hidden={showLogsInsights}>
              <div className="input-row resource-table-bar">
                <div>
                  <p className="eyebrow">Resources</p>
                  <span className="muted">
                    {resources.length} normalized resources
                  </span>
                </div>
                <div className="resource-table-tools">
                  <div className="search-box">
                    <input aria-label="Filter resources"
                      className="input"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Filter resources"
                    />
                  </div>
                  {viewStateFilter && (
                    <select
                      aria-label={viewStateFilter.label}
                      className="input"
                      value={viewState}
                      onChange={(event) => {
                        setViewState(event.target.value);
                        selectResource(undefined);
                        setIsDeleteMulti(false);
                        setSelectedItems([]);
                      }}
                    >
                      {viewStateFilter.options?.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  )}
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
                    disabled={
                      !canUseRuntime || resourcesQuery.isFetching || resourceDetailQuery.isFetching
                    }
                    onClick={() => {
                      void resourcesQuery.refetch();
                      if (
                        selectedForService !== undefined &&
                        schema.actions.includes("inspect")
                      ) {
                        void qc.resetQueries({
                          queryKey: [
                            "cloud-resource",
                            accountId,
                            cloud,
                            service,
                            selectedForService.id,
                          ],
                          exact: true,
                        });
                      }
                    }}
                  >
                    <RefreshCw size={14} />
                    {resourcesQuery.isFetching || resourceDetailQuery.isFetching
                      ? "Loading"
                      : "Refresh"}
                  </button>
                  {emptyCapability && (
                    <button
                      className="button danger"
                      type="button"
                      disabled={!canEmptyBucket}
                      title={
                        !storageTarget
                          ? "Select a bucket to empty it."
                          : objectWritesPending
                            ? "Waiting for object writes to this bucket to finish."
                            : emptyCapability.reason
                      }
                      onClick={() => {
                        if (storageTarget) setEmptyConfirm(storageTarget);
                      }}
                    >
                      <Trash2 size={14} />
                      {emptyMut.isPending ? "Emptying" : "Empty bucket"}
                    </button>
                  )}
                  {canDelete && !viewingDeleted && (
                    deleteConfirm ? (
                      <>
                        <button
                          className="button danger"
                          type="button"
                          disabled={!canUseRuntime || deleteMultipleMut.isPending || emptyMut.isPending}
                          onClick={() => deleteMultipleMut.mutate(selectedItems)}
                        >
                          <Trash2 size={14} />
                          {deleteMultipleMut.isPending
                            ? "Deleting..."
                            : `Confirm Delete (${selectedItems.length})`}
                        </button>
                        <button
                          className="button"
                          type="button"
                          disabled={deleteMultipleMut.isPending}
                          onClick={() => setDeleteConfirm(false)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="button danger"
                        type="button"
                        disabled={
                          !canUseRuntime ||
                          resourcesQuery.isFetching ||
                          deleteMultipleMut.isPending ||
                          emptyMut.isPending
                        }
                        onClick={() => {
                          if (!isDeleteMulti) {
                            setIsDeleteMulti(true);
                          } else if (selectedItems.length > 0) {
                            setDeleteConfirm(true);
                          } else {
                            setIsDeleteMulti(false);
                            setSelectedItems([]);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                        {isDeleteMulti && selectedItems.length > 0
                          ? `Delete Selected (${selectedItems.length})`
                          : isDeleteMulti
                          ? "Cancel Selection"
                          : "Delete Multiple"}
                      </button>
                    )
                  )}
                </div>
              </div>
              {service === "email" && clearInboxMut.isError && (
                <p className="error-text compact-text" style={{ margin: "0 12px 10px" }}>
                  {clearInboxMut.error instanceof Error
                    ? clearInboxMut.error.message
                    : "Unable to clear the inbox."}
                </p>
              )}
              {bulkDeleteError?.accountId === accountId && (
                <p className="error-text compact-text" style={{ margin: "0 12px 10px", whiteSpace: "pre-line" }}>
                  {bulkDeleteError.message}
                </p>
              )}
              {bucketDeleteError?.accountId === accountId && (
                <p className="error-text compact-text" style={{ margin: "0 12px 10px" }}>
                  {bucketDeleteError.message}
                </p>
              )}
              {showEmptyError && (
                <p className="error-text compact-text" style={{ margin: "0 12px 10px", whiteSpace: "pre-line" }}>
                  Empty bucket did not finish for {emptyMut.variables?.bucketId}. The bucket was kept;
                  any versions deleted before the failure are gone. {errorMessage(emptyMut.error)}
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
                        selectResource(resource);
                        setCreateOpen(false);
                      }}
                      onCancel={() => setCreateOpen(false)}
                    />
                  ) : service === "database" && cloud === "aws" ? (
                    <CreateRdsInstanceForm
                      cloud={cloud}
                      onSuccess={(resource) => {
                        selectResource(resource);
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
                deletingId: deleteMut.isPending ? deleteMut.variables?.id : undefined,
                cloudStatus,
                statusLoading,
                serviceAvailability,
                serviceReason,
                resourcesLoading: resourcesQuery.isLoading,
                resourcesError: resourcesQuery.error,
                isRetrying: resourcesQuery.isFetching,
                onSelect: selectResource,
                onEdit:
                  !viewingDeleted &&
                    schema.updateFields &&
                    schema.updateFields.length > 0 &&
                    schema.actions.includes("update")
                    ? (resource) => {
                      setEditingResource(resource);
                      setUpdateError(null);
                    }
                    : undefined,
                onDelete: (resource) => deleteMut.mutate(resource),
                canDeleteResource,
                onRetry: () => resourcesQuery.refetch(),
                isDeleteMulti,
                selectedItems,
                onToggleSelect: (resource) => selectMultiple(resource),
                onToggleSelectAll: () => selectMultiple(!isAllSelected),
                isAllSelected,
              })}
            </section>
            </>
          )}
          {isAwsLogs && (
            <div hidden={!showLogsInsights}>
              <LogsQueryPanel cloud={cloud} allLogGroups={resources} runtimeReachable={canUseRuntime} />
            </div>
          )}
        </section>
        {activeSelected && !showDatabaseSnapshots && !showLogsInsights && (
          <ResourceInspector
            resource={inspectedResource}
            object={selectedObject}
            cloud={cloud}
            runtimeReachable={canUseRuntime}
            serviceName={schema.displayName}
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
          writesBlocked={emptyingKey !== undefined && emptyingKey === storageTargetKey}
        />
      )}
      {service === "compute" && (
        <ComputePanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={runtimeReachable}
        />
      )}
      {service === "compute" && cloud !== "aws" && (
        <ComputePowerPanel
          resource={inspectedResource}
          capabilities={resourceCapabilities}
          onChanged={() => {
            void qc.invalidateQueries({queryKey: ["cloud-resources", accountId, cloud, service]});
            if (activeSelected) {
              void qc.invalidateQueries({queryKey: ["cloud-resource", accountId, cloud, service, activeSelected.id]});
            }
          }}
        />
      )}
      {service === "networking" && (
        <NetworkingPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={runtimeReachable}
        />
      )}
      {service === "serverless" && (
        <ServerlessInvokePanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {service === "configuration" && cloud === "aws" && (
        <AppConfigPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {service === "kms" && !(cloud === "oci" && inspectedResource?.metadata.keyUsage === "SIGN_VERIFY") && (
        <KmsCryptoPanel
          cloud={cloud}
          resource={inspectedResource}
          runtimeReachable={canUseRuntime}
        />
      )}
      {service === "kms" && cloud === "oci" && (
        <OciKmsActionsPanel
          resource={inspectedResource}
          runtimeReachable={canUseRuntime}
          onChanged={() => {
            void qc.invalidateQueries({queryKey: ["cloud-resources", accountId, cloud, service]});
            if (activeSelected) {
              void qc.invalidateQueries({queryKey: ["cloud-resource", accountId, cloud, service, activeSelected.id]});
            }
          }}
        />
      )}
      {(service === "secrets" || service === "kms" || service === "certificates") && cloud === "azure" && (
        <AzureKeyVaultPanel
          resource={inspectedResource}
          runtimeReachable={canUseRuntime}
          onChanged={(change) => {
            void qc.invalidateQueries({queryKey: ["cloud-resources", accountId, cloud, service]});
            if (activeSelected) {
              void qc.invalidateQueries({queryKey: ["cloud-resource", accountId, cloud, service, activeSelected.id]});
            }
            if (change === "removed") selectResource(undefined);
          }}
        />
      )}
      {service === "messaging" && (cloud === "aws" || cloud === "oci") && (
        <SqsMessagingPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
          onMessagesChanged={() => {
            void qc.invalidateQueries({queryKey: ["cloud-resources", accountId, cloud, service]});
            if (activeSelected) {
              void qc.invalidateQueries({queryKey: ["cloud-resource", accountId, cloud, service, activeSelected.id]});
            }
          }}
        />
      )}
      {service === "streams" && cloud === "oci" && (
        <StreamMessagesPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {service === "workflows" && cloud === "aws" && (
        <WorkflowExecutionsPanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={canUseRuntime}
        />
      )}
      {editingResource && schema.updateFields && (
        <ModalOverlay
          onClose={() => {
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
              <h2 style={{ margin: 0 }}>
                Edit {schema.displayName}: {editingResource.name || editingResource.id}
              </h2>
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
        </ModalOverlay>
      )}
      {emptyConfirm && (
        <ModalOverlay
          onClose={() => {
            if (!emptyMut.isPending) setEmptyConfirm(null);
          }}
        >
          <div
            className="create-table-modal"
            style={{ width: 480, maxWidth: "90vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 style={{ margin: 0 }}>Empty bucket {emptyConfirm.bucketId}?</h2>
            </div>
            <p>
              This permanently deletes every object, every object version and
              every delete marker in <strong>{emptyConfirm.bucketId}</strong>{" "}
              (account {emptyConfirm.accountId}). It cannot be undone. The
              bucket itself is kept; delete it separately afterwards.
            </p>
            {emptyMut.isPending && (
              <p className="muted">
                Emptying. Closing the page does not stop deletions already sent.
              </p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="button"
                type="button"
                disabled={emptyMut.isPending}
                onClick={() => setEmptyConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                type="button"
                disabled={emptyMut.isPending || objectWritesPending}
                onClick={() => {
                  if (targetKey(emptyConfirm) !== storageTargetKey) {
                    setEmptyConfirm(null);
                    return;
                  }
                  emptyMut.mutate(emptyConfirm);
                }}
              >
                <Trash2 size={14} />
                {emptyMut.isPending ? "Emptying" : "Empty bucket"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {successToast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "var(--accent)",
            color: "var(--on-accent)",
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
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
  canDeleteResource,
  onRetry,
  isDeleteMulti,
  selectedItems,
  onToggleSelect,
  onToggleSelectAll,
  isAllSelected,
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
  canDeleteResource?: (resource: CloudResource) => boolean;
  onRetry?: () => void;
  isDeleteMulti?: boolean;
  selectedItems?: CloudResource[];
  onToggleSelect?: (resource: CloudResource) => void;
  onToggleSelectAll?: () => void;
  isAllSelected?: boolean;
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
    <>
    {schema.notice && <p className="muted">{schema.notice}</p>}
    <ResourceTable
      schema={schema}
      resources={resources}
      selectedId={selectedId}
      deletingId={deletingId}
      onSelect={onSelect}
      onEdit={onEdit}
      onDelete={onDelete}
      canDeleteResource={canDeleteResource}
      dataPath={dataExplorerPath}
      isDeleteMulti={isDeleteMulti}
      selectedItems={selectedItems}
      onToggleSelect={onToggleSelect}
      onToggleSelectAll={onToggleSelectAll}
      isAllSelected={isAllSelected}
    />
    </>
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
      <h2>{title}</h2>
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
