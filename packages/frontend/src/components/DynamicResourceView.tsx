import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {Icon, ErrorOutline, Time, ChevronDown, ChevronUp, InfoSquared as Info, PlusSquared as Plus, RefreshCwSquared as RefreshCw, Trash2, XSquared as X} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
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
import { deleteWaves } from "@/lib/deleteOrder";
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
import {EmptyState} from '@/components/EmptyState'
import {PageSkeleton, RowsSkeleton} from '@/components/PageSkeleton'
import {PanelEnter, Reveal} from '@/components/PanelReveal'
import {Hint} from '@/components/Hint'

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
const EventGridSubscriptionsPanel = lazyPanel(() => import("@/components/EventGridSubscriptionsPanel").then((m) => m.EventGridSubscriptionsPanel));
const OciParPanel = lazyPanel(() => import("@/components/OciParPanel").then((m) => m.OciParPanel));
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
  const isAwsAthena = cloud === "aws" && service === "analytics";
  const isAwsCodeBuild = cloud === "aws" && service === "cicd";
  const canDeleteResource = viewingDeleted
    ? () => false
    : isAwsSageMaker
      ? (resource: CloudResource) => resource.type !== "sagemaker-training-job"
      : isGcpCompute
        ? (resource: CloudResource) => resource.type !== "disk"
        : isAwsAthena
          ? (resource: CloudResource) => resource.type === "athena-workgroup" && resource.name !== "primary"
          : isAwsCodeBuild
            ? (resource: CloudResource) => resource.type === "project"
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
      // Later waves start after the user may have switched account, so every
      // request carries the account the deletion was confirmed in.
      const confirmedAccountId = accountId;
      const succeededIds = new Set<string>();
      const failedItems: { id: string; error: unknown }[] = [];

      for (const wave of deleteWaves(items)) {
        const results = await Promise.allSettled(
          wave.map(async (item) => {
            await deleteCloudResource(cloud, service, item.id, undefined, confirmedAccountId);
            return item.id;
          }),
        );
        results.forEach((res, index) => {
          if (res.status === "fulfilled") {
            succeededIds.add(res.value);
          } else {
            failedItems.push({ id: wave[index].id, error: res.reason });
          }
        });
      }

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
        <PageSkeleton label="Loading schema"/>
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
            <div className="drawer-tabs mb-3">
              <Button variant={databaseTab === "instances" ? 'secondary' : 'ghost'}
                type="button"
                onClick={() => handleDatabaseTabChange("instances")}
              >
                Instances
              </Button>
              <Button variant={databaseTab === "snapshots" ? 'secondary' : 'ghost'}
                type="button"
                onClick={() => handleDatabaseTabChange("snapshots")}
              >
                Snapshots
              </Button>
            </div>
          )}

          {isAwsLogs && (
            <div className="drawer-tabs mb-3">
              <Button variant={logsTab === "groups" ? 'secondary' : 'ghost'}
                type="button"
                onClick={() => handleLogsTabChange("groups")}
              >
                Log groups
              </Button>
              <Button variant={logsTab === "insights" ? 'secondary' : 'ghost'}
                type="button"
                onClick={() => handleLogsTabChange("insights")}
              >
                Logs Insights
              </Button>
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
                    <Input aria-label="Filter resources"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Filter resources"
                    />
                  </div>
                  {viewStateFilter && (
                    <OptionSelect
                      aria-label={viewStateFilter.label}
                      value={viewState}
                      onValueChange={(value) => {
                        setViewState(value);
                        selectResource(undefined);
                        setIsDeleteMulti(false);
                        setSelectedItems([]);
                      }}
                    >
                      {viewStateFilter.options?.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </OptionSelect>
                  )}
                  {service === "email" && (
                    clearConfirm ? (
                      <>
                        <Button variant="destructive"
                          type="button"
                          disabled={!canUseRuntime || clearInboxMut.isPending}
                          onClick={() => clearInboxMut.mutate()}
                        >
                          <Icon icon={Trash2} size={14} />
                          {clearInboxMut.isPending ? "Clearing" : "Confirm clear"}
                        </Button>
                        <Button variant="secondary" type="button" disabled={clearInboxMut.isPending} onClick={() => setClearConfirm(false)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button variant="destructive"
                        type="button"
                        disabled={!canUseRuntime}
                        onClick={() => setClearConfirm(true)}
                      >
                        <Icon icon={Trash2} size={14} />
                        Clear inbox
                      </Button>
                    )
                  )}
                  {canCreate && (
                    <Button title={createCapability?.reason} variant="secondary"
                      type="button"
                      disabled={!canCreateResource}
                      onClick={() => setCreateOpen((open) => !open)}
                    >
                      <Icon icon={Plus} size={14} />
                      {createResourceLabel}
                      {createOpen ? (
                        <Icon icon={ChevronUp} size={14} />
                      ) : (
                        <Icon icon={ChevronDown} size={14} />
                      )}
                    </Button>
                  )}
                  <Button variant="secondary"
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
                    <Icon icon={RefreshCw} size={14} />
                    {resourcesQuery.isFetching || resourceDetailQuery.isFetching
                      ? "Loading"
                      : "Refresh"}
                  </Button>
                  {emptyCapability && (
                    <Button title={
                        !storageTarget
                          ? "Select a bucket to empty it."
                          : objectWritesPending
                            ? "Waiting for object writes to this bucket to finish."
                            : emptyCapability.reason
                      } variant="destructive"
                      type="button"
                      disabled={!canEmptyBucket}
                      onClick={() => {
                        if (storageTarget) setEmptyConfirm(storageTarget);
                      }}
                    >
                      <Icon icon={Trash2} size={14} />
                      {emptyMut.isPending ? "Emptying" : "Empty bucket"}
                    </Button>
                  )}
                  {canDelete && !viewingDeleted && (
                    deleteConfirm ? (
                      <>
                        <Button variant="destructive"
                          type="button"
                          disabled={!canUseRuntime || deleteMultipleMut.isPending || emptyMut.isPending}
                          onClick={() => deleteMultipleMut.mutate(selectedItems)}
                        >
                          <Icon icon={Trash2} size={14} />
                          {deleteMultipleMut.isPending
                            ? "Deleting..."
                            : `Confirm Delete (${selectedItems.length})`}
                        </Button>
                        <Button variant="secondary"
                          type="button"
                          disabled={deleteMultipleMut.isPending}
                          onClick={() => setDeleteConfirm(false)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button variant="destructive"
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
                        <Icon icon={Trash2} size={14} />
                        {isDeleteMulti && selectedItems.length > 0
                          ? `Delete Selected (${selectedItems.length})`
                          : isDeleteMulti
                          ? "Cancel Selection"
                          : "Delete Multiple"}
                      </Button>
                    )
                  )}
                </div>
              </div>
              {service === "email" && clearInboxMut.isError && (
                <p className="error-text compact-text mt-0 mx-3 mb-2.5">
                  {clearInboxMut.error instanceof Error
                    ? clearInboxMut.error.message
                    : "Unable to clear the inbox."}
                </p>
              )}
              {bulkDeleteError?.accountId === accountId && (
                <p className="error-text compact-text mt-0 mx-3 mb-2.5 whitespace-pre-line">
                  {bulkDeleteError.message}
                </p>
              )}
              {bucketDeleteError?.accountId === accountId && (
                <p className="error-text compact-text mt-0 mx-3 mb-2.5">
                  {bucketDeleteError.message}
                </p>
              )}
              {showEmptyError && (
                <p className="error-text compact-text mt-0 mx-3 mb-2.5 whitespace-pre-line">
                  Empty bucket did not finish for {emptyMut.variables?.bucketId}. The bucket was kept;
                  any versions deleted before the failure are gone. {errorMessage(emptyMut.error)}
                </p>
              )}
              <Reveal open={Boolean(canCreate && createOpen)}>
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
              </Reveal>
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
          <PanelEnter className="min-w-0">
            <ResourceInspector
              resource={inspectedResource}
              object={selectedObject}
              cloud={cloud}
              runtimeReachable={canUseRuntime}
              serviceName={schema.displayName}
            />
          </PanelEnter>
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
      {service === "storage" && cloud === "oci" && (
        <OciParPanel resource={selected} runtimeReachable={canUseRuntime} />
      )}
      {service === "events" && cloud === "azure" && (
        <EventGridSubscriptionsPanel resource={activeSelected} runtimeReachable={canUseRuntime} />
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
            className="create-table-modal w-130 max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="modal-header flex items-center justify-between"
            >
              <h2 className="m-0">
                Edit {schema.displayName}: {editingResource.name || editingResource.id}
              </h2>
              <Hint label="Close"><Button variant="ghost" size="icon-sm"
                type="button"
                aria-label="Close"
                disabled={updateMut.isPending}
                onClick={() => setEditingResource(null)}
              >
                <Icon icon={X} size={14} />
              </Button></Hint>
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
            className="create-table-modal w-120 max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="m-0">Empty bucket {emptyConfirm.bucketId}?</h2>
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
            <div className="flex gap-2 justify-end">
              <Button variant="secondary"
                type="button"
                disabled={emptyMut.isPending}
                onClick={() => setEmptyConfirm(null)}
              >
                Cancel
              </Button>
              <Button variant="destructive"
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
                <Icon icon={Trash2} size={14} />
                {emptyMut.isPending ? "Emptying" : "Empty bucket"}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {successToast && (
        <div className="fixed py-2.5 px-4.5 type-caption bottom-6 right-6 z-(--z-overlay) bg-primary text-primary-foreground"
          role="status"
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
    <Hint label="Service information"><Button variant="ghost" size="icon-sm"
      type="button"
      onClick={onOpenInfo} aria-label="Service information"
    >
      <Icon icon={Info} size={14} />
    </Button></Hint>,
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
    return <RowsSkeleton rows={8} label="Loading service"/>;
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
    return <RowsSkeleton rows={8} label={`Loading ${schema.displayName}`}/>;
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
  isRetrying,
  onRetry,
}: {
  title: string;
  detail: string;
  error?: string;
  state: "pending" | "unavailable";
  isRetrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      reason={state === "unavailable" ? "error" : "empty"}
      icon={state === "unavailable" ? ErrorOutline : Time}
      title={title}
      description={detail}
    >
      {error && <code className="mono break-all text-text-2">{error}</code>}
      {onRetry && (
        <Button variant="secondary"
          type="button"
          disabled={isRetrying}
          onClick={() => { if (!isRetrying) onRetry(); }}
        >
          {isRetrying ? "Retrying\u2026" : "Retry"}
        </Button>
      )}
    </EmptyState>
  );
}
