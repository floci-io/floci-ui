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

  const element = (current: CloudResource | undefined = resource) => (
    <QueryClientProvider client={client}>
      <PaymentCryptographyReplicationSection
        cloud="aws"
        resource={current}
        keyUnreadable={keyUnreadable}
        runtimeReachable={true}
      />
    </QueryClientProvider>
  );
  const view = render(element());
  return {invalidated, rerender: (next?: CloudResource) => view.rerender(element(next))};
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
    expect(setReplication.mock.calls[0][3]).toEqual({
      addReplicationRegions: ["us-west-2"],
      removeReplicationRegions: [],
    });
  });

  it("stops replicating to a Region that is taken away", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.click(screen.getByRole("button", {name: /Stop replicating to us-east-2/i}));

    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));
    expect(setReplication.mock.calls[0][3]).toEqual({
      addReplicationRegions: [],
      removeReplicationRegions: ["us-east-2"],
    });
  });

  it("does not ask for a Region the key is already replicated to", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-east-2");

    // The diff against the Regions the key holds is empty, so the request would
    // add and remove nothing, and the input would be cleared and the queries
    // refreshed for a write that never happened.
    expect(screen.getByRole("button", {name: /Replicate to/i})).toBeDisabled();

    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    expect(setReplication).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Region to replicate to")).toHaveValue("us-east-2");
  });

  it("does not offer to replicate a key that may not leave", async () => {
    const user = userEvent.setup();
    renderSection({...key, metadata: {...key.metadata, exportable: false}});

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");

    // The reference only lets an exportable key be replicated to another
    // Region, and the export panel next to it applies the same rule to its own
    // control.
    expect(screen.getByRole("button", {name: /Replicate to/i})).toBeDisabled();

    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    expect(setReplication).not.toHaveBeenCalled();
    expect(screen.getByText(/not exportable/i)).toBeDefined();
  });

  it("does not leave a change that failed on screen", async () => {
    const user = userEvent.setup();
    setReplication.mockRejectedValue(new Error("The Region is not one this key may be replicated to."));
    renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));

    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toBeDefined();

    // The change did not happen, so the panel shows the Regions the key holds
    // and not the Region the user asked for.
    await waitFor(() => expect(screen.queryByText("us-west-2")).toBeNull());
    expect(screen.getByText("us-east-2")).toBeDefined();
  });

  it("does not send a Region that failed again", async () => {
    const user = userEvent.setup();
    setReplication.mockRejectedValue(new Error("The Region is not one this key may be replicated to."));
    renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Region to replicate to"), "us-east-3");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));

    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(2));
    // The Region that failed is not in the request: the key never held it.
    expect(setReplication.mock.calls[1][3]).toEqual({
      addReplicationRegions: ["us-east-3"],
      removeReplicationRegions: [],
    });
  });

  it("shows a Region another client added", async () => {
    const user = userEvent.setup();
    const {rerender} = renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));

    // The key is read again, and it holds a Region another client added. The
    // draft does not hide it.
    rerender({
      ...key,
      metadata: {...key.metadata, replicationRegions: ["us-east-2", "us-west-2", "eu-west-1"]},
    });

    await waitFor(() => expect(screen.getByText("eu-west-1")).toBeDefined());
  });

  it("never takes away a Region the draft never had", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));

    // The detail has not caught up with the save yet, so the panel still shows
    // the Regions the key held when the draft began.
    await user.type(screen.getByLabelText("Region to replicate to"), "eu-west-1");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(2));

    // The Region that was added a moment ago is not one the draft never had,
    // so the second save does not take it away.
    const second = setReplication.mock.calls[1][3] as {
      addReplicationRegions: string[];
      removeReplicationRegions: string[];
    };
    expect(second.removeReplicationRegions).toEqual([]);
    expect(second.addReplicationRegions).toContain("eu-west-1");
  });

  it("takes away a Region it added a moment ago", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("button", {name: /Stop replicating to us-west-2/i}));

    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(2));
    expect(setReplication.mock.calls[1][3]).toEqual({
      addReplicationRegions: [],
      removeReplicationRegions: ["us-west-2"],
    });
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

  it("refreshes the account the write was made in, not the one the user is in", async () => {
    const user = userEvent.setup();
    let settle: () => void = () => {};
    setReplication.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const {invalidated, rerender} = renderSection(key);

    await user.type(screen.getByLabelText("Region to replicate to"), "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));
    await waitFor(() => expect(setReplication).toHaveBeenCalledTimes(1));

    // The account is switched while the request is in flight, and the panel is
    // painted again, which is what an account switch does to the explorer.
    setAccountId("111111111111");
    rerender();
    settle();

    await waitFor(() => expect(invalidated.length).toBeGreaterThan(0));
    const keys = invalidated.map(([filters]) => (filters as {queryKey: unknown[]}).queryKey);
    expect(keys).toContainEqual([
      "cloud-resource",
      DEFAULT_ACCOUNT_ID,
      "aws",
      "paymentcryptography",
      key.id,
    ]);
    expect(keys).not.toContainEqual([
      "cloud-resource",
      "111111111111",
      "aws",
      "paymentcryptography",
      key.id,
    ]);
  });

  it("closes the Region to replicate to while the save is pending", async () => {
    const user = userEvent.setup();
    let settle: () => void = () => {};
    setReplication.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    renderSection(key);

    const input = screen.getByLabelText("Region to replicate to");
    await user.type(input, "us-west-2");
    await user.click(screen.getByRole("button", {name: /Replicate to/i}));

    // The input is cleared when the save settles, so a Region typed while the
    // request is in flight would be wiped without a word.
    await waitFor(() => expect(input).toBeDisabled());
    settle();
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
