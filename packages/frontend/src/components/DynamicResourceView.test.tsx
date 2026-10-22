import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyStorageObject,
  deleteCloudResource,
  deleteStorageObject,
  emptyStorageBucket,
  getCloudResource,
  getServiceSchema,
  listCloudResources,
  listStorageObjects,
  uploadStorageObject,
} from "@/api/cloudProxyClient";
import { DynamicResourceView } from "@/components/DynamicResourceView";
import { DEFAULT_ACCOUNT_ID, setAccountId } from "@/lib/accountStore";
import type { CloudStatus } from "@/types/cloud";
import type { CloudResource } from "@/types/resource";
import type { ServiceSchema } from "@/types/schema";

vi.mock("@/api/cloudProxyClient", () => ({
  clearEmailInbox: vi.fn(),
  createCloudResource: vi.fn(),
  copyStorageObject: vi.fn(),
  deleteCloudResource: vi.fn(),
  deleteStorageObject: vi.fn(),
  emptyStorageBucket: vi.fn(),
  getCloudResource: vi.fn(),
  getServiceSchema: vi.fn(),
  listCloudResources: vi.fn(),
  listStorageObjects: vi.fn(),
  purgeDeletedSecretResource: vi.fn(),
  purgeDeletedKmsResource: vi.fn(),
  recoverCertificateResource: vi.fn(),
  purgeDeletedCertificateResource: vi.fn(),
  recoverKmsResource: vi.fn(),
  recoverSecretResource: vi.fn(),
  storageObjectDownloadUrl: vi.fn(() => "#"),
  updateCloudResource: vi.fn(),
  uploadStorageObject: vi.fn(),
}));

const schema: ServiceSchema = {
  cloud: "aws",
  service: "cognito",
  displayName: "Cognito User Pools",
  fields: [],
  filters: [],
  actions: ["list", "inspect"],
  columns: [{ name: "name", label: "Name" }],
};

const summary: CloudResource = {
  id: "pool-1",
  name: "pool-a",
  cloud: "aws",
  service: "cognito",
  type: "user-pool",
  region: "us-east-1",
  createdAt: null,
  metadata: {},
};

const detail: CloudResource = {
  ...summary,
  metadata: {
    arn: "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1",
    deletionProtection: "ACTIVE",
    userCount: 3,
  },
};

const cloudStatus: CloudStatus = {
  cloud: "aws",
  adapterRegistered: true,
  runtime: "reachable",
  endpoint: "http://localhost:4566",
  checkedAt: "2026-09-26T00:00:00Z",
  error: null,
};

describe("DynamicResourceView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccountId(DEFAULT_ACCOUNT_ID);
    vi.mocked(getServiceSchema).mockResolvedValue(schema);
    vi.mocked(listCloudResources).mockResolvedValue([summary]);
    vi.mocked(getCloudResource).mockResolvedValue(detail);
  });

  it("loads resource details before inspecting a selected list row", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <DynamicResourceView
          cloud="aws"
          service="cognito"
          serviceAvailability="available"
          cloudStatus={cloudStatus}
          onOpenInfo={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByText("pool-a"));

    await waitFor(() =>
      expect(getCloudResource).toHaveBeenCalledWith(
        "aws",
        "cognito",
        "pool-1",
        expect.any(AbortSignal),
      ),
    );
    expect(
      await screen.findByText(
        "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1",
      ),
    ).toBeInTheDocument();
  });

  it("refreshes the selected resource details with the resource list", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    const refreshedDetail: CloudResource = {
      ...detail,
      metadata: {
        ...detail.metadata,
        arn: "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1-refreshed",
        userCount: 4,
      },
    };
    let resolveRefresh: (resource: CloudResource) => void = () => undefined;
    const refreshResult = new Promise<CloudResource>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.mocked(getCloudResource)
      .mockResolvedValueOnce(detail)
      .mockImplementationOnce(() => refreshResult);

    render(
      <QueryClientProvider client={queryClient}>
        <DynamicResourceView
          cloud="aws"
          service="cognito"
          serviceAvailability="available"
          cloudStatus={cloudStatus}
          onOpenInfo={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByText("pool-a"));
    expect(
      await screen.findByText(
        "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(getCloudResource).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText(
        "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1",
      ),
    ).not.toBeInTheDocument();

    resolveRefresh(refreshedDetail);
    expect(
      await screen.findByText(
        "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1-refreshed",
      ),
    ).toBeInTheDocument();
  });

  it("does not retain inspected details after switching AWS accounts", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <DynamicResourceView
          cloud="aws"
          service="cognito"
          serviceAvailability="available"
          cloudStatus={cloudStatus}
          onOpenInfo={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByText("pool-a"));
    expect(
      await screen.findByText(
        "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1",
      ),
    ).toBeInTheDocument();

    act(() => {
      setAccountId("111111111111");
    });

    await waitFor(() =>
      expect(
        screen.queryByText(
          "arn:aws:cognito-idp:us-east-1:000000000000:userpool/pool-1",
        ),
      ).not.toBeInTheDocument(),
    );
  });
});

const ACCOUNT_A = "111111111111";
const ACCOUNT_B = "222222222222";

const awsStorageSchema: ServiceSchema = {
  cloud: "aws",
  service: "storage",
  displayName: "S3 Storage",
  fields: [],
  filters: [],
  actions: ["list", "create", "delete", "inspect"],
  columns: [{ name: "name", label: "Name" }],
  capabilities: {
    resourceActions: [
      { name: "list", label: "List resources", enabled: true, status: "available", runtimeRequired: true },
      { name: "delete", label: "Delete resource", enabled: true, status: "available", runtimeRequired: true },
      { name: "inspect", label: "Inspect resource", enabled: true, status: "available", runtimeRequired: false },
      { name: "emptyBucket", label: "Empty bucket", enabled: true, status: "available", runtimeRequired: true },
    ],
    objectActions: [
      { name: "list", label: "List objects", enabled: true, status: "available", runtimeRequired: true },
      { name: "upload", label: "Upload object", enabled: true, status: "available", runtimeRequired: true },
    ],
  },
};

function storageBucket(id: string, cloud: "aws" | "azure" = "aws"): CloudResource {
  return {
    id,
    name: id,
    cloud,
    service: "storage",
    type: "bucket",
    region: null,
    createdAt: null,
    metadata: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function renderStorage(options: { cloud?: "aws" | "azure"; status?: CloudStatus } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = (status: CloudStatus) => (
    <QueryClientProvider client={queryClient}>
      <DynamicResourceView
        cloud={options.cloud ?? "aws"}
        service="storage"
        serviceAvailability="available"
        cloudStatus={status}
        onOpenInfo={vi.fn()}
      />
    </QueryClientProvider>
  );
  const rendered = render(view(options.status ?? cloudStatus));
  return {
    invalidate,
    rerenderWithStatus: (status: CloudStatus) => rendered.rerender(view(status)),
  };
}

function invalidatedKeys(invalidate: { mock: { calls: unknown[][] } }): unknown[][] {
  return invalidate.mock.calls
    .map(([filters]) => (filters as { queryKey?: unknown[] } | undefined)?.queryKey)
    .filter((key): key is unknown[] => Array.isArray(key));
}

async function openEmptyDialog(user: ReturnType<typeof userEvent.setup>, bucket = "logs") {
  await user.click(await screen.findByText(bucket));
  await user.click(screen.getByRole("button", { name: "Empty bucket" }));
  return screen.findByRole("dialog");
}

describe("DynamicResourceView Empty bucket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccountId(ACCOUNT_A);
    vi.mocked(getServiceSchema).mockResolvedValue(awsStorageSchema);
    vi.mocked(listCloudResources).mockResolvedValue([storageBucket("logs"), storageBucket("assets")]);
    vi.mocked(getCloudResource).mockImplementation(async (_cloud, _service, id) => storageBucket(id));
    vi.mocked(listStorageObjects).mockResolvedValue({ prefix: "", objects: [] });
  });

  it("asks for confirmation, can be cancelled, and empties the confirmed bucket", async () => {
    const user = userEvent.setup();
    vi.mocked(emptyStorageBucket).mockResolvedValue({ deleted: 4 });
    const { invalidate } = renderStorage();

    let dialog = await openEmptyDialog(user);
    expect(within(dialog).getByText(/permanently deletes every object, every object version/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(emptyStorageBucket).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Empty bucket" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Empty bucket" }));

    expect(await screen.findByText(/Emptied logs: permanently deleted 4/)).toBeInTheDocument();
    expect(emptyStorageBucket).toHaveBeenCalledWith(ACCOUNT_A, "aws", "logs");
    expect(deleteCloudResource).not.toHaveBeenCalled();
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContainEqual(["storage-objects", ACCOUNT_A, "aws", "logs"]);
    expect(keys).toContainEqual(["cloud-resource", ACCOUNT_A, "aws", "storage", "logs"]);
    expect(keys).toContainEqual(["cloud-resources", ACCOUNT_A, "aws", "storage"]);
  });

  it("is not offered where the schema does not advertise it", async () => {
    vi.mocked(getServiceSchema).mockResolvedValue({
      ...awsStorageSchema,
      cloud: "azure",
      capabilities: {
        ...awsStorageSchema.capabilities,
        resourceActions: awsStorageSchema.capabilities!.resourceActions!.filter(
          (action) => (typeof action === "string" ? action : action.name) !== "emptyBucket",
        ),
      },
    });
    vi.mocked(listCloudResources).mockResolvedValue([storageBucket("logs", "azure")]);
    const user = userEvent.setup();
    renderStorage({ cloud: "azure" });

    await user.click(await screen.findByText("logs"));

    expect(screen.queryByRole("button", { name: "Empty bucket" })).not.toBeInTheDocument();
  });

  it("is disabled when the runtime goes down", async () => {
    const user = userEvent.setup();
    const { rerenderWithStatus } = renderStorage();
    await user.click(await screen.findByText("logs"));
    expect(screen.getByRole("button", { name: "Empty bucket" })).toBeEnabled();

    rerenderWithStatus({ ...cloudStatus, runtime: "unavailable" });

    const button = screen.getByRole("button", { name: "Empty bucket" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Start the selected runtime before using this action.");
  });

  it("drops a confirmation once another account is selected", async () => {
    const user = userEvent.setup();
    renderStorage();
    await openEmptyDialog(user);

    act(() => setAccountId(ACCOUNT_B));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(emptyStorageBucket).not.toHaveBeenCalled();
  });

  it("refreshes the emptied account but shows no success to the account selected since", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ deleted: number }>();
    vi.mocked(emptyStorageBucket).mockReturnValue(gate.promise);
    const { invalidate } = renderStorage();
    const dialog = await openEmptyDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Empty bucket" }));

    act(() => setAccountId(ACCOUNT_B));
    await act(async () => gate.resolve({ deleted: 2 }));

    await waitFor(() =>
      expect(invalidatedKeys(invalidate)).toContainEqual(["storage-objects", ACCOUNT_A, "aws", "logs"]),
    );
    expect(invalidatedKeys(invalidate)).toContainEqual(["cloud-resources", ACCOUNT_A, "aws", "storage"]);
    expect(invalidatedKeys(invalidate).some((key) => key.includes(ACCOUNT_B))).toBe(false);
    expect(screen.queryByText(/Emptied logs/)).not.toBeInTheDocument();
  });

  it("reports a partial failure, keeps the bucket and still refreshes it", async () => {
    const user = userEvent.setup();
    vi.mocked(emptyStorageBucket).mockRejectedValue(
      new Error('Runtime request failed: Emptying bucket "logs" stopped after deletion started: S3 refused to delete 2 of 1000 entries (runtime_error)'),
    );
    const { invalidate } = renderStorage();
    const dialog = await openEmptyDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Empty bucket" }));

    expect(await screen.findByText(/Empty bucket did not finish for logs/)).toHaveTextContent(
      "stopped after deletion started: S3 refused to delete 2 of 1000 entries",
    );
    expect(invalidatedKeys(invalidate)).toContainEqual(["storage-objects", ACCOUNT_A, "aws", "logs"]);
    expect(screen.queryByText(/Emptied logs/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete logs" })).toBeInTheDocument();
    expect(deleteCloudResource).not.toHaveBeenCalled();
  });

  it("blocks dismissal, a second run and deleting the bucket while emptying", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ deleted: number }>();
    vi.mocked(emptyStorageBucket).mockReturnValue(gate.promise);
    renderStorage();
    const dialog = await openEmptyDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Empty bucket" }));

    expect(within(dialog).getByRole("button", { name: "Emptying" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete logs" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Multiple" })).toBeDisabled();

    await act(async () => gate.resolve({ deleted: 0 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(emptyStorageBucket).toHaveBeenCalledTimes(1);
  });

  it("shows why a bucket could not be deleted, naming that bucket", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteCloudResource).mockRejectedValue(
      new Error('Resource already exists or is in use: Bucket "logs" is not empty. Use Empty bucket to remove them, then delete the bucket. (resource_conflict)'),
    );
    renderStorage();

    await user.click(await screen.findByRole("button", { name: "Delete logs" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/Could not delete logs: .*Use Empty bucket/)).toBeInTheDocument();
    // The refused row can be confirmed again once the bucket is emptied.
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("does not show a refusal that arrives after another account is selected", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    vi.mocked(deleteCloudResource).mockReturnValue(gate.promise);
    renderStorage();
    await user.click(await screen.findByRole("button", { name: "Delete logs" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    act(() => setAccountId(ACCOUNT_B));
    await act(async () => gate.reject(new Error('Bucket "logs" is not empty. Use Empty bucket.')));

    await screen.findByText("logs");
    expect(screen.queryByText(/Could not delete logs/)).not.toBeInTheDocument();
  });

  it("does not show a bulk refusal that arrives after another account is selected", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    vi.mocked(deleteCloudResource).mockImplementation(async (_cloud, _service, id) => {
      if (id === "logs") return gate.promise;
    });
    renderStorage();
    await screen.findByText("logs");
    await user.click(screen.getByRole("button", { name: "Delete Multiple" }));
    await user.click(screen.getByLabelText("Select all resources"));
    await user.click(screen.getByRole("button", { name: "Delete Selected (2)" }));
    await user.click(screen.getByRole("button", { name: "Confirm Delete (2)" }));

    act(() => setAccountId(ACCOUNT_B));
    await act(async () => gate.reject(new Error('Bucket "logs" is not empty. Use Empty bucket.')));

    await screen.findByText("logs");
    expect(screen.queryByText(/Failed to delete 1 of 2/)).not.toBeInTheDocument();
  });

  it("keeps a failed empty's message with the account it ran in", async () => {
    const user = userEvent.setup();
    vi.mocked(emptyStorageBucket).mockRejectedValue(new Error("S3 refused to delete 1 of 1 entries"));
    renderStorage();
    const dialog = await openEmptyDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Empty bucket" }));
    await screen.findByText(/Empty bucket did not finish for logs/);

    act(() => setAccountId(ACCOUNT_B));

    await waitFor(() => expect(screen.queryByText(/Empty bucket did not finish/)).not.toBeInTheDocument());
  });

  it("pauses object writes in the bucket while it is being emptied", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ deleted: number }>();
    vi.mocked(emptyStorageBucket).mockReturnValue(gate.promise);
    renderStorage();
    await user.click(await screen.findByText("logs"));
    expect(await screen.findByRole("button", { name: "Upload" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Empty bucket" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Empty bucket" }));

    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload" })).toHaveAttribute("title", "Empty bucket is running on this bucket.");
    await act(async () => gate.resolve({ deleted: 0 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled());
  });

  it("keeps another bucket's refusal when a different bucket is emptied", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteCloudResource).mockRejectedValue(new Error('Bucket "assets" is not empty. Use Empty bucket.'));
    vi.mocked(emptyStorageBucket).mockResolvedValue({ deleted: 1 });
    renderStorage();
    await user.click(await screen.findByRole("button", { name: "Delete assets" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText(/Could not delete assets/);

    await user.click(screen.getByText("logs"));
    await user.click(screen.getByRole("button", { name: "Empty bucket" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Empty bucket" }));

    await screen.findByText(/Emptied logs/);
    expect(screen.getByText(/Could not delete assets/)).toBeInTheDocument();
  });

  it("clears a bucket's not-empty refusal once that bucket is emptied", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteCloudResource).mockRejectedValue(new Error('Bucket "logs" is not empty. Use Empty bucket.'));
    vi.mocked(emptyStorageBucket).mockResolvedValue({ deleted: 1 });
    renderStorage();
    await user.click(await screen.findByRole("button", { name: "Delete logs" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText(/Could not delete logs/);

    await user.click(screen.getByText("logs"));
    await user.click(screen.getByRole("button", { name: "Empty bucket" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Empty bucket" }));

    await screen.findByText(/Emptied logs/);
    expect(screen.queryByText(/Could not delete logs/)).not.toBeInTheDocument();
  });

  it("names each bucket a bulk delete could not remove, with its reason", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteCloudResource).mockImplementation(async (_cloud, _service, id) => {
      if (id === "logs") throw new Error('Bucket "logs" is not empty. Use Empty bucket to remove them.');
    });
    renderStorage();

    await screen.findByText("logs");
    await user.click(screen.getByRole("button", { name: "Delete Multiple" }));
    await user.click(screen.getByLabelText("Select all resources"));
    await user.click(screen.getByRole("button", { name: "Delete Selected (2)" }));
    await user.click(screen.getByRole("button", { name: "Confirm Delete (2)" }));

    const message = await screen.findByText(/Failed to delete 1 of 2 selected resource/);
    expect(message).toHaveTextContent('logs: Bucket "logs" is not empty. Use Empty bucket to remove them.');
  });
});

// Object actions the browser offers, so each kind of write can be started.
const awsStorageWriteSchema: ServiceSchema = {
  ...awsStorageSchema,
  capabilities: {
    ...awsStorageSchema.capabilities,
    objectActions: [
      { name: "list", label: "List objects", enabled: true, status: "available", runtimeRequired: true },
      { name: "upload", label: "Upload object", enabled: true, status: "available", runtimeRequired: true },
      { name: "delete", label: "Delete object", enabled: true, status: "available", runtimeRequired: true },
      { name: "createFolder", label: "Create folder", enabled: true, status: "available", runtimeRequired: true },
      { name: "copy", label: "Copy object", enabled: true, status: "available", runtimeRequired: true },
    ],
  },
};

const WAITING_FOR_WRITES = "Waiting for object writes to this bucket to finish.";

describe("DynamicResourceView Empty bucket and object writes already sent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccountId(ACCOUNT_A);
    vi.mocked(getServiceSchema).mockResolvedValue(awsStorageWriteSchema);
    vi.mocked(listCloudResources).mockResolvedValue([storageBucket("logs"), storageBucket("assets")]);
    vi.mocked(getCloudResource).mockImplementation(async (_cloud, _service, id) => storageBucket(id));
    vi.mocked(listStorageObjects).mockResolvedValue({
      prefix: "",
      objects: [{ key: "a.txt", name: "a.txt", type: "object", size: 1, lastModified: null, metadata: {} }],
    });
    vi.mocked(copyStorageObject).mockResolvedValue(undefined);
    vi.mocked(deleteStorageObject).mockResolvedValue(undefined);
    vi.mocked(uploadStorageObject).mockResolvedValue(undefined);
  });

  async function openMoveOrCopy(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTitle("Move / Copy a.txt"));
    return screen.findByRole("dialog");
  }

  // Each write is held open by the call that lands in logs. Empty bucket on
  // logs has to wait for it, then come back once it settles.
  const writes: Array<{
    name: string;
    held: () => ReturnType<typeof vi.fn>;
    start: (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
  }> = [
    {
      name: "an upload",
      held: () => vi.mocked(uploadStorageObject),
      start: async (user) => {
        await user.upload(screen.getByLabelText("Choose file to upload"), new File(["x"], "new.txt"));
      },
    },
    {
      name: "a new folder",
      held: () => vi.mocked(uploadStorageObject),
      start: async (user) => {
        await user.click(screen.getByRole("button", { name: "New folder" }));
        await user.type(screen.getByPlaceholderText("new-folder/"), "docs");
        await user.click(screen.getByRole("button", { name: "Create folder" }));
      },
    },
    {
      name: "an object delete",
      held: () => vi.mocked(deleteStorageObject),
      start: async (user) => {
        await user.click(screen.getByTitle("Delete a.txt"));
        await user.click(screen.getByRole("button", { name: "Confirm" }));
      },
    },
    {
      name: "a bulk object delete",
      held: () => vi.mocked(deleteStorageObject),
      start: async (user) => {
        await user.click(screen.getByLabelText("Select a.txt"));
        await user.click(screen.getByRole("button", { name: "Delete 1" }));
      },
    },
    {
      name: "a move whose copy is done and whose source delete is not",
      held: () => vi.mocked(deleteStorageObject),
      start: async (user) => {
        const dialog = await openMoveOrCopy(user);
        await user.clear(within(dialog).getByLabelText("Destination key"));
        await user.type(within(dialog).getByLabelText("Destination key"), "moved.txt");
        // The tab and the submit button are both named Move; the submit is last.
        const moveButtons = within(dialog).getAllByRole("button", { name: "Move" });
        await user.click(moveButtons[moveButtons.length - 1]);
      },
    },
  ];

  for (const write of writes) {
    it(`waits for ${write.name} already sent to the bucket`, async () => {
      const user = userEvent.setup();
      const gate = deferred<void>();
      write.held().mockReturnValue(gate.promise);
      renderStorage();
      await user.click(await screen.findByText("logs"));
      await screen.findByText("a.txt");
      expect(screen.getByRole("button", { name: "Empty bucket" })).toBeEnabled();

      await write.start(user);

      await waitFor(() => expect(screen.getByRole("button", { name: "Empty bucket" })).toBeDisabled());
      expect(screen.getByRole("button", { name: "Empty bucket" })).toHaveAttribute("title", WAITING_FOR_WRITES);
      await act(async () => gate.resolve());
      await waitFor(() => expect(screen.getByRole("button", { name: "Empty bucket" })).toBeEnabled());
      expect(emptyStorageBucket).not.toHaveBeenCalled();
    });
  }

  it("waits for a copy into the bucket started from another bucket", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    vi.mocked(copyStorageObject).mockReturnValue(gate.promise);
    renderStorage();
    await user.click(await screen.findByText("assets"));
    await screen.findByText("a.txt");
    const dialog = await openMoveOrCopy(user);
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    await user.selectOptions(await within(dialog).findByLabelText("Destination bucket"), "logs");
    const copyButtons = within(dialog).getAllByRole("button", { name: "Copy" });
    await user.click(copyButtons[copyButtons.length - 1]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByText("logs"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Empty bucket" })).toBeDisabled());
    await act(async () => gate.resolve());
    await waitFor(() => expect(screen.getByRole("button", { name: "Empty bucket" })).toBeEnabled());
  });

  it("does not wait for a write to another bucket or another account", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    vi.mocked(uploadStorageObject).mockReturnValue(gate.promise);
    renderStorage();
    await user.click(await screen.findByText("assets"));
    await screen.findByText("a.txt");
    await user.upload(screen.getByLabelText("Choose file to upload"), new File(["x"], "new.txt"));

    await user.click(screen.getByText("logs"));
    expect(await screen.findByRole("button", { name: "Empty bucket" })).toBeEnabled();

    act(() => setAccountId(ACCOUNT_B));
    await user.click(await screen.findByText("assets"));
    expect(await screen.findByRole("button", { name: "Empty bucket" })).toBeEnabled();
    await act(async () => gate.resolve());
  });

  describe("Key Vault deleted secrets view", () => {
    const secretsSchema: ServiceSchema = {
      cloud: "azure",
      service: "secrets",
      displayName: "Key Vault",
      fields: [],
      filters: [
        { name: "search", label: "Search", type: "text", required: false },
        {
          name: "state",
          label: "View",
          type: "select",
          required: false,
          options: [
            { label: "Active secrets", value: "active" },
            { label: "Deleted secrets", value: "deleted" },
          ],
        },
      ],
      actions: ["list", "delete", "inspect"],
      columns: [{ name: "name", label: "Secret Name" }, { name: "status", label: "Status" }],
    };
    const azureStatus: CloudStatus = { ...cloudStatus, cloud: "azure", endpoint: "http://localhost:4577" };
    const activeSecret: CloudResource = {
      id: "db-password", name: "db-password", cloud: "azure", service: "secrets", type: "secret",
      region: null, createdAt: null, status: "enabled", metadata: {},
    };
    const deletedSecret: CloudResource = { ...activeSecret, id: "old-token", name: "old-token", status: "deleted" };

    function renderSecrets() {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <DynamicResourceView
            cloud="azure"
            service="secrets"
            serviceAvailability="available"
            cloudStatus={azureStatus}
            onOpenInfo={vi.fn()}
          />
        </QueryClientProvider>,
      );
    }

    beforeEach(() => {
      vi.mocked(getServiceSchema).mockResolvedValue(secretsSchema);
      vi.mocked(listCloudResources).mockImplementation(async (_cloud, _service, _search, _signal, filters) =>
        filters?.state === "deleted" ? [deletedSecret] : [activeSecret],
      );
      vi.mocked(getCloudResource).mockImplementation(async (_cloud, _service, id) =>
        id === "old-token" ? deletedSecret : activeSecret,
      );
    });

    it("lists active secrets first and switches to the deleted ones without offering delete", async () => {
      const user = userEvent.setup();
      renderSecrets();

      expect(await screen.findByText("db-password")).toBeInTheDocument();
      expect(listCloudResources).toHaveBeenLastCalledWith("azure", "secrets", "", expect.anything(), { state: "active" });
      expect(screen.getByRole("button", { name: "Delete db-password" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete Multiple" })).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("View"), "deleted");

      expect(await screen.findByText("old-token")).toBeInTheDocument();
      expect(listCloudResources).toHaveBeenLastCalledWith("azure", "secrets", "", expect.anything(), { state: "deleted" });
      expect(screen.queryByRole("button", { name: "Delete old-token" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete Multiple" })).not.toBeInTheDocument();
    });

    it("offers recover and purge for a selected deleted secret", async () => {
      const user = userEvent.setup();
      renderSecrets();
      await user.selectOptions(await screen.findByLabelText("View"), "deleted");
      await user.click(await screen.findByText("old-token"));

      expect(await screen.findByRole("button", { name: "Recover" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Purge" })).toBeEnabled();
    });

    it("does not render a view selector for a service that declares no state filter", async () => {
      vi.mocked(getServiceSchema).mockResolvedValue(schema);
      vi.mocked(listCloudResources).mockResolvedValue([summary]);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <DynamicResourceView cloud="aws" service="cognito" serviceAvailability="available" cloudStatus={cloudStatus} onOpenInfo={vi.fn()} />
        </QueryClientProvider>,
      );

      await screen.findByText("pool-a");
      expect(screen.queryByLabelText("View")).not.toBeInTheDocument();
      expect(listCloudResources).toHaveBeenLastCalledWith("aws", "cognito", "", expect.anything(), undefined);
    });
  });
});
