import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCloudResource,
  getServiceSchema,
  listCloudResources,
} from "@/api/cloudProxyClient";
import { DynamicResourceView } from "@/components/DynamicResourceView";
import type { CloudStatus } from "@/types/cloud";
import type { CloudResource } from "@/types/resource";
import type { ServiceSchema } from "@/types/schema";

vi.mock("@/api/cloudProxyClient", () => ({
  clearEmailInbox: vi.fn(),
  createCloudResource: vi.fn(),
  deleteCloudResource: vi.fn(),
  getCloudResource: vi.fn(),
  getServiceSchema: vi.fn(),
  listCloudResources: vi.fn(),
  updateCloudResource: vi.fn(),
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
});
