import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {setPaymentCryptographyKeyPolicy} from "@/api/cloudProxyClient";
import {PaymentCryptographyPolicySection} from "@/components/PaymentCryptographyPolicySection";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  setPaymentCryptographyKeyPolicy: vi.fn(),
}));

const setPolicy = vi.mocked(setPaymentCryptographyKeyPolicy);

const POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "Allow",
      Effect: "Allow",
      Principal: {AWS: "arn:aws:iam::111122223333:root"},
      Action: "kms:Decrypt",
      Resource: "*",
    },
  ],
});

const key: CloudResource = {
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  name: "key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {enabled: true, keyPolicy: POLICY},
};

function renderSection(resource: CloudResource = key) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const invalidated: unknown[][] = [];
  client.invalidateQueries = vi.fn(async (filters: unknown) => {
    invalidated.push([filters]);
    return {status: "success", statusText: "", data: undefined, error: null} as never;
  }) as typeof client.invalidateQueries;

  render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyPolicySection
        cloud="aws"
        resource={resource}
        runtimeReachable={true}
      />
    </QueryClientProvider>,
  );
  return {invalidated};
}

describe("the policy of a payment key", () => {
  beforeEach(() => {
    setPolicy.mockReset();
    setPolicy.mockResolvedValue(undefined as never);
    setAccountId(DEFAULT_ACCOUNT_ID);
  });

  it("attaches the policy the form holds", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole("button", {name: /Edit policy/i}));
    const editor = screen.getByLabelText("Key policy");
    fireEvent.change(editor, {target: {value: "{}"}});
    await user.click(screen.getByRole("button", {name: /Save policy/i}));

    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));
    expect(setPolicy.mock.calls[0][3]).toEqual({policy: "{}"});
  });

  it("removes the policy the key holds", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole("button", {name: /Remove policy/i}));

    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));
    expect(setPolicy.mock.calls[0][3]).toEqual({policy: ""});
  });

  it("refreshes the resource and the list of the account it saved in", async () => {
    const user = userEvent.setup();
    const {invalidated} = renderSection();

    await user.click(screen.getByRole("button", {name: /Remove policy/i}));

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
});
