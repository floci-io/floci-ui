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
import { displayNameOf, namesLabel, namesOf} from "@/lib/displayName";
import { getPath } from "@/lib/resourcePath";
import { deleteWaves } from "@/lib/deleteOrder";
import {
  capabilityAppliesToType,
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
import type { FieldSchema, ServiceSchema } from "@/types/schema";
import { dataExplorerPath } from "@/lib/dataExplorer";
import { useAccountId } from "@/lib/accountStore";
import { CreateRdsInstanceForm } from "@/components/CreateRdsInstanceForm";
import { lazyPanel } from "@/lib/lazyPanel";
import { activeListFilters, filterOptions, filterValueOf, listFiltersOf } from "@/lib/listFilters";
import { isPaymentKey } from "@/lib/paymentCryptography";
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
const PaymentCryptographyPanel = lazyPanel(() => import("@/components/PaymentCryptographyPanel").then((m) => m.PaymentCryptographyPanel));
const AzureKeyVaultPanel = lazyPanel(() => import("@/components/AzureKeyVaultPanel").then((m) => m.AzureKeyVaultPanel));
const EventGridSubscriptionsPanel = lazyPanel(() => import("@/components/EventGridSubscriptionsPanel").then((m) => m.EventGridSubscriptionsPanel));
const OciGovernancePanel = lazyPanel(() => import("@/components/OciGovernancePanel").then((m) => m.OciGovernancePanel));
const OciParPanel = lazyPanel(() => import("@/components/OciParPanel").then((m) => m.OciParPanel));
const OciIdentityPanel = lazyPanel(() => import("@/components/OciIdentityPanel").then((m) => m.OciIdentityPanel));
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
  const [chosenFilters, setChosenFilters] = useState<Record<string, string>>({});
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
  // Kept with the account, cloud and service it was for, like the single-delete
  // refusal below.
  const [bulkDeleteError, setBulkDeleteError] = useState<
    { accountId: string; cloud: CloudProvider; service: CloudServiceType; message: string } | null
  >(null);
  // A refused single delete, kept with the account, cloud and service it was for:
  // the view is reused across services, so an account check alone would show the
  // banner on whichever page the user navigated to next.
  const [deleteError, setDeleteError] = useState<
    { accountId: string; cloud: CloudProvider; service: CloudServiceType; resourceId: string; message: string } | null
  >(null);
  // The bucket the open Empty bucket dialog was opened for, captured at that moment.
  const [emptyConfirm, setEmptyConfirm] = useState<StorageTarget | null>(null);

  const handleDatabaseTabChange = (tab: "instances" | "snapshots") => {
    setDatabaseTab(tab);
    if (tab === "snapshots") {
      setSearch("");
    }
  };

  const changeFilter = (name: string, value: string) => {
    setChosenFilters((current) => ({ ...current, [name]: value }));
    selectResource(undefined);
    setIsDeleteMulti(false);
    setSelectedItems([]);
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

  // Every select or text filter a schema declares is painted and sent to the list
  // call; a schema that declares none lists exactly as before. A `state` select
  // set to `deleted` (Key Vault soft-deleted secrets) also switches to the
  // read-only deleted view.
  const declaredFilters = useMemo(() => listFiltersOf(schemaQuery.data?.filters), [schemaQuery.data]);
  const listFilters = useMemo(
    () => activeListFilters(declaredFilters, chosenFilters),
    [declaredFilters, chosenFilters],
  );
  const viewingDeleted = declaredFilters.some(
    (filter) =>
      filter.name === "state" &&
      filter.type === "select" &&
      filterValueOf(filter, chosenFilters) === "deleted",
  );

  useEffect(() => {
    setChosenFilters({});
  }, [accountId, cloud, service]);

  const resourcesKey = useMemo(
    () => ["cloud-resources", accountId, cloud, service, search, listFilters ?? {}],
    [accountId, cloud, service, search, listFilters],
  );

  const resourcesQuery = useQuery({
    queryKey: resourcesKey,
    queryFn: ({ signal }) => listCloudResources(cloud, service, search, signal, listFilters),
    enabled:
      schemaQuery.isSuccess &&
      serviceAvailability === "available" &&
      cloudStatus?.runtime === "reachable",
  });
  // The options of a field that names another resource come from the resources the
  // service holds, not from the rows the table shows: the table's rows are the ones
  // the search box and the facet narrowed, and a field that names a key must still
  // offer the keys when the table is showing the aliases.
  const optionRowsQuery = useQuery({
    // Under the list's key, so every change that refreshes the table also
    // refreshes the choices: a key made or deleted is one or the other.
    queryKey: ["cloud-resources", accountId, cloud, service, "options"],
    queryFn: ({ signal }) => listCloudResources(cloud, service, undefined, signal),
    enabled:
      schemaQuery.isSuccess &&
      serviceAvailability === "available" &&
      cloudStatus?.runtime === "reachable" &&
      // The create form needs the account's own list when a field names
      // another resource, and the payment cryptography panel needs it to offer
      // the keys a key may leave under. The two are apart, so neither hangs on
      // the other.
      (namesAnotherResource(schemaQuery.data) || service === "paymentcryptography"),
  });
  // The choices of a field that names another resource come from a request of
  // their own, and a failed one leaves the field empty: an account with no keys
  // and a request that failed look the same to the caller. The failure is said
  // so, and the request can be made again.
  const optionsFailure = optionRowsQuery.isError
    ? `The options could not be loaded: ${errorMessage(optionRowsQuery.error)}`
    : undefined;

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
      setDeleteError((refusal) =>
        refusal?.accountId === target.accountId && refusal.resourceId === target.bucketId ? null : refusal,
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
  const isOciIdentity = cloud === "oci" && service === "identity";
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
            : isOciIdentity
              ? (resource: CloudResource) => resource.type !== "region subscription"
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
      setDeleteError(null);
      // Captured now: navigation while the request is in flight must not
      // re-home the banner to the page the user landed on.
      return { accountId, cloud, service };
    },
    onError: (error, resource, context) => {
      if (!context) return;
      setDeleteError({
        accountId: context.accountId,
        cloud: context.cloud,
        service: context.service,
        resourceId: resource.id,
        message: `Could not delete ${displayNameOf(resource)}: ${errorMessage(error)}`,
      });
    },
    onSuccess: (_, resource, context) => {
      if (selected?.id === resource.id) selectResource(undefined);
      setSelectedItems((prev) => prev.filter((item) => item.id !== resource.id));
      // The account the delete was made in, not the account the user is in by
      // now: a switch while the request was in flight must not leave the
      // account that was written to stale.
      const deletedIn = context?.accountId ?? accountId;
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", deletedIn, cloud, service],
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
    onSettled: (_data, _error, _items, context) => {
      void qc.invalidateQueries({
        queryKey: ["cloud-resources", context?.accountId ?? accountId, cloud, service],
      });
    },
    onMutate: () => ({ accountId, cloud, service }),
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
          cloud: context.cloud,
          service: context.service,
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
      setSuccessToast(`Successfully updated ${displayNameOf(updatedResource)}`);
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
    setDeleteError(null);
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
  // The detail the console read for the selected resource, or nothing while it
  // is on its way or could not be read.
  const inspectedDetail =
    resourceDetailQuery.data?.id === activeSelected?.id ? resourceDetailQuery.data : undefined;
  const inspectedResource =
    !resourceDetailQuery.isFetching && inspectedDetail !== undefined
      ? inspectedDetail
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
  // A service can hold kinds of resource that do not take the same actions: an
  // alias carries no tags of its own, so the tag editor is the key's alone.
  const updateTagsCapability = capabilityFor(resourceCapabilities, "updateTags");
  const canEditTags =
    capabilityEnabled(updateTagsCapability) &&
    capabilityAppliesToType(updateTagsCapability, inspectedResource?.type);
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
                  {declaredFilters.map((filter) =>
                    filter.type === "select" ? (
                      <select
                        key={filter.name}
                        aria-label={filter.label}
                        className="input"
                        value={filterValueOf(filter, chosenFilters)}
                        onChange={(event) => changeFilter(filter.name, event.target.value)}
                      >
                        {filterOptions(filter).map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        key={filter.name}
                        aria-label={filter.label}
                        className="input"
                        value={filterValueOf(filter, chosenFilters)}
                        placeholder={filter.label}
                        onChange={(event) => changeFilter(filter.name, event.target.value)}
                      />
                    ),
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
                      !canUseRuntime ||
                      resourcesQuery.isFetching ||
                      optionRowsQuery.isFetching ||
                      resourceDetailQuery.isFetching
                    }
                    onClick={() => {
                      void resourcesQuery.refetch();
                      if (optionRowsQuery.isEnabled) {
                        void optionRowsQuery.refetch();
                      }
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
                    {resourcesQuery.isFetching ||
                    optionRowsQuery.isFetching ||
                    resourceDetailQuery.isFetching
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
              {bulkDeleteError?.accountId === accountId &&
                bulkDeleteError.cloud === cloud &&
                bulkDeleteError.service === service && (
                <p className="error-text compact-text" style={{ margin: "0 12px 10px", whiteSpace: "pre-line" }}>
                  {bulkDeleteError.message}
                </p>
              )}
              {deleteError?.accountId === accountId &&
                deleteError.cloud === cloud &&
                deleteError.service === service && (
                <p className="error-text compact-text" style={{ margin: "0 12px 10px" }}>
                  {deleteError.message}
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
                      fields={schema.fields.map((field) =>
                        optionsFromRows(field, optionRowsQuery.data),
                      )}
                      isSubmitting={createMut.isPending}
                      submitLabel={createResourceLabel}
                      pendingLabel="Creating"
                      submitError={
                        createMut.error instanceof Error
                          ? createMut.error.message
                          : null
                      }
                      optionsError={optionsFailure}
                      onRetryOptions={optionsFailure ? () => void optionRowsQuery.refetch() : undefined}
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
            canEditTags={canEditTags}
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
      {service === "storage" && cloud === "oci" && (
        <OciParPanel resource={selected} runtimeReachable={canUseRuntime} />
      )}
      {service === "events" && cloud === "azure" && (
        <EventGridSubscriptionsPanel resource={activeSelected} runtimeReachable={canUseRuntime} />
      )}
      {service === "governance" && cloud === "oci" && (
        <OciGovernancePanel resource={activeSelected} runtimeReachable={canUseRuntime} />
      )}
      {service === "compute" && (
        <ComputePanel
          cloud={cloud}
          resource={activeSelected}
          runtimeReachable={runtimeReachable}
          onChanged={(change) => {
            void qc.invalidateQueries({queryKey: ["cloud-resources", change.accountId, cloud, service]});
            void qc.invalidateQueries({queryKey: ["cloud-resource", change.accountId, cloud, service]});
            if (change.removed) {
              setSelection((current) =>
                current?.accountId === change.accountId && current.resource.id === change.resourceId ? undefined : current,
              );
            }
          }}
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
      {service === "paymentcryptography" && isPaymentKey(activeSelected) && (
        // The certificate of a payment key and whether the key may be used are
        // part of the key's detail, and the table's row carries neither of
        // them, so the panel shows the detail and never the row: it would speak
        // about a key it has not read. A detail that was never read leaves them
        // unknown, and the panel says so rather than staying silent. A later
        // refetch that failed keeps the detail that was read, so the flag is
        // scoped to a key that has never been read at all.
        <PaymentCryptographyPanel
          key={activeSelected.id}
          cloud={cloud}
          resource={inspectedDetail}
          keyUnreadable={resourceDetailQuery.isError && inspectedDetail === undefined}
          resources={optionRowsQuery.data}
          resourcesLoading={optionRowsQuery.isLoading}
          resourcesError={optionRowsQuery.isError}
          schema={schema}
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
      {isOciIdentity && (
        <OciIdentityPanel
          resource={inspectedResource}
          runtimeReachable={canUseRuntime}
          onRecovered={() => {
            void qc.invalidateQueries({queryKey: ["cloud-resources", accountId, cloud, service]});
            if (activeSelected) {
              void qc.invalidateQueries({queryKey: ["cloud-resource", accountId, cloud, service, activeSelected.id]});
            }
            selectResource(undefined);
          }}
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
                Edit {schema.displayName}: {displayNameOf(editingResource)}
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

/**
 * Whether a schema has a field that names another resource.
 *
 * <p>Such a field needs the resources the service holds, which the table's rows
 * are not: they are the rows the search box and the facet narrowed.
 */
function namesAnotherResource(schema: ServiceSchema | undefined): boolean {
  return Boolean(schema?.fields?.some((field) => field.optionsFrom));
}

/**
 * The options of a field that names another resource of the same service.
 *
 * <p>The rows of the list are the resources the account holds now, so a field that
 * names one of them offers them rather than a list baked into the schema. A field
 * that may name only some of them says which state the service published, so the
 * choices are the ones the service allows.
 */
function optionsFromRows(field: FieldSchema, rows: CloudResource[] | undefined): FieldSchema {
  if (!field.optionsFrom) return field;
  const options = (rows ?? [])
    .filter((row) => row.type === field.optionsFrom)
    .filter((row) => !field.optionsState || row.metadata[field.optionsState] === true)
    .map((row) => ({ label: optionLabel(row), value: row.id }));
  return { ...field, options };
}

/**
 * The name an option is offered under.
 *
 * <p>A field may say which member of the row's metadata carries the name the
 * operator knows the resource by. A payment key is known by the alias that
 * names it, and an ARN is not something an operator remembers, so the option
 * is offered under the alias when the row has one.
 */
function optionLabel(row: CloudResource): string {
  const friendly = namesOf(row);
  const identity = row.name || row.id;
  if (friendly.length === 0) return identity;
  // The name and the identity together, so a choice under a name that reads
  // like another kind of resource is still the resource it is: an alias in a
  // list of keys is the key that alias names, and the ARN beside it says so.
  const label = namesLabel(friendly);
  if (identity === label) return label;
  return `${label} · ${identity}`;
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
