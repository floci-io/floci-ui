import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {setPaymentCryptographyKeyReplication} from "@/api/cloudProxyClient";
import {PaymentCryptographyReplicationSection} from "@/components/PaymentCryptographyReplicationSection";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  setPaymentCryptographyKeyReplication: vi.fn(),
}));

const setReplication = vi.mocked(setPaymentCryptographyKeyReplication);

const key: CloudResource = {
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  name: "key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {enabled: true, replicationRegions: ["us-east-2"]},
};

function renderSection(resource: CloudResource | undefined, keyUnreadable?: boolean) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const invalidated: unknown[][] = [];
  client.invalidateQueries = vi.fn(async (filters: unknown) => {
    invalidated.push([filters]);
    return {status: "success", statusText: "", data: undefined, error: null} as never;
  }) as typeof client.invalidateQueries;

  render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyReplicationSection
        cloud="aws"
        resource={resource}
        keyUnreadable={keyUnreadable}
        runtimeReachable={true}
      />
    </QueryClientProvider>,
  );
  return {invalidated};
}

describe("the replication of a payment key", () => {
  beforeEach(() => {
    setReplication.mockReset();
    setReplication.mockResolvedValue(undefined as never);
    setAccountId(DEFAULT_ACCOUNT_ID);
  });

  it("replicates the key to the Region that is chosen", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));

    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));
    expect(setReplication.mock.calls[0][3]).toEqual({replicationRegions: ["us-east-2", "us-west-2"]});
  });

  it("stops replicating to a Region that is taken away", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.click(screen.getByRole("button", {name: /Stop replicating to us-east-2/i}));

    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));
    expect(setReplication.mock.calls[0][3]).toEqual({replicationRegions: []});
  });

  it("refreshes the resource and the list of the account it saved in", async () => {
    const user = userEvent.setup();
    const {invalidated} = renderSection(key);

    await user.click(screen.getByRole("button", {name: /Stop replicating to us-east-2/i}));

    await waitFor(() => expect(invalidated.length).toBeGreaterThan(0));
    const keys = invalidated.map(([filters]) => (filters as {queryKey: unknown[]}).queryKey);
    expect(keys).toContainEqual([
      "cloud-resource",
      DEFAULT_ACCOUNT_ID,
      "aws",
      "paymentcryptography",
      key.id,
    ]);
    expect(keys).toContainEqual([
      "cloud-resources",
      DEFAULT_ACCOUNT_ID,
      "aws",
      "paymentcryptography",
    ]);
  });

  it("says the Regions are unknown while the key has not been read", () => {
    renderSection(undefined);

    expect(screen.getByText(/has not been read yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/replicated to no other Region/i)).not.toBeInTheDocument();
  });

  it("says the Regions are unknown when the key could not be read", () => {
    renderSection(undefined, true);

    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.queryByText(/replicated to no other Region/i)).not.toBeInTheDocument();
  });
});
