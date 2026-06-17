import { API_BASE_URL, apiClient, apiEndpointKeys } from "./api";
import type {
  CloudDescriptor,
  CloudProvider,
  CloudServiceDescriptor,
  CloudServiceType,
  CloudStatus,
} from "@/types/cloud";
import type { CloudResource, CosmosContainer, CosmosItem, CosmosQueryResult, StorageObjectList } from "@/types/resource";
import type { ServiceSchema } from "@/types/schema";
import { getAccountId } from "@/lib/accountStore";

type CloudPathParams = Record<string, string>;

export async function listClouds(
  signal?: AbortSignal,
): Promise<CloudDescriptor[]> {
  const res = await apiClient.call<CloudDescriptor[]>(
    apiEndpointKeys.clouds.list,
    { signal },
  );
  return res.data;
}

export async function listCloudServices(
  cloud: CloudProvider,
  signal?: AbortSignal,
): Promise<CloudServiceDescriptor[]> {
  const res = await apiClient.call<CloudServiceDescriptor[]>(
    apiEndpointKeys.clouds.services,
    requestOptions(cloud, "cloud-proxy", { signal }),
    { cloud },
  );
  return res.data;
}

export async function getCloudStatus(
  cloud: CloudProvider,
  signal?: AbortSignal,
): Promise<CloudStatus> {
  const res = await apiClient.call<CloudStatus>(
    apiEndpointKeys.clouds.status,
    requestOptions(cloud, "cloud-proxy", { signal }),
    { cloud },
  );
  return res.data;
}

export async function getServiceSchema(
  cloud: CloudProvider,
  service: CloudServiceType,
  signal?: AbortSignal,
): Promise<ServiceSchema> {
  const res = await apiClient.call<ServiceSchema>(
    apiEndpointKeys.clouds.schema,
    requestOptions(cloud, service, { signal }),
    { cloud, service },
  );
  return res.data;
}

export async function listCloudResources(
  cloud: CloudProvider,
  service: CloudServiceType,
  search?: string,
  signal?: AbortSignal,
): Promise<CloudResource[]> {
  const res = await apiClient.call<CloudResource[]>(
    apiEndpointKeys.clouds.resources.list,
    requestOptions(cloud, service, { signal, params: { search } }),
    { cloud, service },
  );
  return res.data;
}

export async function getCloudResource(
  cloud: CloudProvider,
  service: CloudServiceType,
  id: string,
  signal?: AbortSignal,
): Promise<CloudResource> {
  const res = await apiClient.call<CloudResource>(
    apiEndpointKeys.clouds.resources.get,
    requestOptions(cloud, service, { signal }),
    { cloud, service, id },
  );
  return res.data;
}

export async function createCloudResource(
  cloud: CloudProvider,
  service: CloudServiceType,
  values: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CloudResource> {
  const res = await apiClient.call<CloudResource, Record<string, unknown>>(
    apiEndpointKeys.clouds.resources.create,
    requestOptions(cloud, service, { signal, body: values }),
    { cloud, service },
  );
  return res.data;
}

export async function deleteCloudResource(
  cloud: CloudProvider,
  service: CloudServiceType,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void>(
    apiEndpointKeys.clouds.resources.delete,
    requestOptions(cloud, service, { signal }),
    { cloud, service, id },
  );
}

export async function listStorageObjects(
  cloud: CloudProvider,
  resourceId: string,
  prefix?: string,
  signal?: AbortSignal,
): Promise<StorageObjectList> {
  const res = await apiClient.call<StorageObjectList>(
    apiEndpointKeys.clouds.storage.objects.list,
    requestOptions(cloud, "storage", { signal, params: { prefix } }),
    storagePathParams(cloud, resourceId),
  );
  return res.data;
}

export async function uploadStorageObject(
  cloud: CloudProvider,
  resourceId: string,
  key: string,
  file: File | Blob,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void>(
    apiEndpointKeys.clouds.storage.objects.upload,
    requestOptions(cloud, "storage", {
      signal,
      rawBody: file,
      params: { key },
      headers: { "Content-Type": file.type || "application/octet-stream" },
    }),
    storagePathParams(cloud, resourceId),
  );
}

export function storageObjectDownloadUrl(
  cloud: CloudProvider,
  resourceId: string,
  key: string,
): string {
  const path = `/clouds/${encodeURIComponent(
    cloud,
  )}/services/storage/resources/${encodeURIComponent(resourceId)}/object`;
  // This URL is opened directly by the browser (anchor/img), so it bypasses the
  // request interceptor — pass the account as a query param the API also reads.
  return `${API_BASE_URL}${path}?key=${encodeURIComponent(
    key,
  )}&account=${encodeURIComponent(getAccountId())}`;
}

export async function deleteStorageObject(
  cloud: CloudProvider,
  resourceId: string,
  key: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void>(
    apiEndpointKeys.clouds.storage.objects.delete,
    requestOptions(cloud, "storage", { signal, params: { key } }),
    storagePathParams(cloud, resourceId),
  );
}

export async function copyStorageObject(
  cloud: CloudProvider,
  srcResourceId: string,
  srcKey: string,
  destKey: string,
  destResourceId?: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void, Record<string, unknown>>(
    apiEndpointKeys.clouds.storage.objects.copy,
    requestOptions(cloud, "storage", {
      signal,
      body: { srcKey, destKey, ...(destResourceId ? { destResourceId } : {}) },
    }),
    storagePathParams(cloud, srcResourceId),
  );
}

export async function listCosmosContainers(
  cloud: CloudProvider,
  databaseId: string,
  signal?: AbortSignal,
): Promise<CosmosContainer[]> {
  const res = await apiClient.call<CosmosContainer[]>(
    apiEndpointKeys.clouds.database.cosmos.containers.list,
    requestOptions(cloud, "database", { signal }),
    databasePathParams(cloud, databaseId),
  );
  return res.data;
}

export async function createCosmosContainer(
  cloud: CloudProvider,
  databaseId: string,
  values: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CosmosContainer> {
  const res = await apiClient.call<CosmosContainer, Record<string, unknown>>(
    apiEndpointKeys.clouds.database.cosmos.containers.create,
    requestOptions(cloud, "database", { signal, body: values }),
    databasePathParams(cloud, databaseId),
  );
  return res.data;
}

export async function deleteCosmosContainer(
  cloud: CloudProvider,
  databaseId: string,
  containerId: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void>(
    apiEndpointKeys.clouds.database.cosmos.containers.delete,
    requestOptions(cloud, "database", { signal }),
    { ...databasePathParams(cloud, databaseId), containerId },
  );
}

export async function listCosmosItems(
  cloud: CloudProvider,
  databaseId: string,
  containerId: string,
  signal?: AbortSignal,
): Promise<CosmosItem[]> {
  const res = await apiClient.call<CosmosItem[]>(
    apiEndpointKeys.clouds.database.cosmos.items.list,
    requestOptions(cloud, "database", { signal }),
    { ...databasePathParams(cloud, databaseId), containerId },
  );
  return res.data;
}

export async function upsertCosmosItem(
  cloud: CloudProvider,
  databaseId: string,
  containerId: string,
  document: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CosmosItem> {
  const res = await apiClient.call<CosmosItem, Record<string, unknown>>(
    apiEndpointKeys.clouds.database.cosmos.items.upsert,
    requestOptions(cloud, "database", { signal, body: document }),
    { ...databasePathParams(cloud, databaseId), containerId },
  );
  return res.data;
}

export async function deleteCosmosItem(
  cloud: CloudProvider,
  databaseId: string,
  containerId: string,
  itemId: string,
  partitionKey?: string | null,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.call<void>(
    apiEndpointKeys.clouds.database.cosmos.items.delete,
    requestOptions(cloud, "database", {
      signal,
      params: partitionKey ? { partitionKey } : undefined,
    }),
    { ...databasePathParams(cloud, databaseId), containerId, itemId },
  );
}

export async function queryCosmosItems(
  cloud: CloudProvider,
  databaseId: string,
  containerId: string,
  query: string,
  signal?: AbortSignal,
): Promise<CosmosQueryResult> {
  const res = await apiClient.call<CosmosQueryResult, { query: string }>(
    apiEndpointKeys.clouds.database.cosmos.items.query,
    requestOptions(cloud, "database", { signal, body: { query } }),
    { ...databasePathParams(cloud, databaseId), containerId },
  );
  return res.data;
}

function requestOptions<TBody = unknown>(
  cloud: CloudProvider,
  service: string,
  options: {
    signal?: AbortSignal;
    params?: Record<string, string | number | boolean | undefined>;
    body?: TBody;
    rawBody?: BodyInit;
    headers?: HeadersInit;
  } = {},
) {
  return {
    ...options,
    telemetry: { provider: cloud, service },
  };
}

function storagePathParams(
  cloud: CloudProvider,
  resourceId: string,
): CloudPathParams {
  return { cloud, id: resourceId };
}

function databasePathParams(
  cloud: CloudProvider,
  databaseId: string,
): CloudPathParams {
  return { cloud, id: databaseId };
}
