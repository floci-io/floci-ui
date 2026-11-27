import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createCloudResource, listDatabaseOrderableClasses } from "@/api/cloudProxyClient";
import { LaunchInstanceForm } from "@/components/ComputePanel";
import { CreateRdsInstanceForm } from "@/components/CreateRdsInstanceForm";
import { DEFAULT_ACCOUNT_ID, setAccountId } from "@/lib/accountStore";
import type { CloudResource } from "@/types/resource";

vi.mock("@/api/cloudProxyClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api/cloudProxyClient")>(),
  createCloudResource: vi.fn(),
  listDatabaseOrderableClasses: vi.fn(),
}));

vi.mock("@/api/aws/ec2.api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api/aws/ec2.api")>(),
  listEc2Amis: vi.fn().mockResolvedValue([{ imageId: "ami-1", name: "linux" }]),
  listEc2KeyPairs: vi.fn().mockResolvedValue([]),
  listEc2Vpcs: vi.fn().mockResolvedValue([]),
  listEc2Subnets: vi.fn().mockResolvedValue([]),
  listEc2SecurityGroups: vi.fn().mockResolvedValue([]),
}));

const ACCOUNT = "123456789012";

function created(service: string): CloudResource {
  return { id: "new", name: "new", cloud: "aws", service, type: "instance", region: null, createdAt: null, metadata: {} };
}

/** A cached explorer list, keyed the way DynamicResourceView keys it. */
function seedList(client: QueryClient, service: string) {
  const key = ["cloud-resources", ACCOUNT, null, "aws", service, "", {}];
  client.setQueryData(key, []);
  return key;
}

beforeEach(() => setAccountId(ACCOUNT));
afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

test("launching an instance refreshes the explorer list of compute", async () => {
  vi.mocked(createCloudResource).mockResolvedValue(created("compute"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listKey = seedList(client, "compute");
  const onSuccess = vi.fn();
  const { container } = render(<QueryClientProvider client={client}>
    <LaunchInstanceForm cloud="aws" selectedResource={{ ...created("compute"), id: "ami-1", type: "image" }} onSuccess={onSuccess} onCancel={vi.fn()} />
  </QueryClientProvider>);

  fireEvent.change(screen.getByPlaceholderText("e.g. my-web-server"), { target: { value: "web" } });
  fireEvent.submit(container.querySelector("form")!);

  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
});

test("creating a database instance refreshes the explorer list of databases", async () => {
  vi.mocked(listDatabaseOrderableClasses).mockResolvedValue(["db.t3.micro"]);
  vi.mocked(createCloudResource).mockResolvedValue(created("database"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const listKey = seedList(client, "database");
  const onSuccess = vi.fn();
  const { container } = render(<QueryClientProvider client={client}>
    <CreateRdsInstanceForm cloud="aws" onSuccess={onSuccess} onCancel={vi.fn()} />
  </QueryClientProvider>);

  fireEvent.change(screen.getByPlaceholderText("e.g. orders-database"), { target: { value: "orders" } });
  await screen.findByRole("option", { name: /db\.t3\.micro/ });
  fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "password123" } });
  fireEvent.submit(container.querySelector("form")!);

  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
});
