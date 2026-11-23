import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {setPaymentCryptographyKeyUsage} from "@/api/cloudProxyClient";
import {PaymentCryptographyLifecycleSection} from "@/components/PaymentCryptographyLifecycleSection";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  setPaymentCryptographyKeyUsage: vi.fn(),
}));

const setUsage = vi.mocked(setPaymentCryptographyKeyUsage);

const key: CloudResource = {
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  name: "key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {enabled: true},
};

<<<<<<< HEAD
function renderSection(
  resource: CloudResource | undefined,
  options: {keyUnreadable?: boolean} = {},
) {
=======
function renderSection(resource: CloudResource = key) {
>>>>>>> 8f83f33 (feat(paymentcryptography): a key may be disabled and enabled again)
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const invalidated: unknown[][] = [];
  client.invalidateQueries = vi.fn(async (filters: unknown) => {
    invalidated.push([filters]);
    return {status: "success", statusText: "", data: undefined, error: null} as never;
  }) as typeof client.invalidateQueries;

  render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyLifecycleSection
        cloud="aws"
        resource={resource}
<<<<<<< HEAD
        keyUnreadable={options.keyUnreadable}
=======
>>>>>>> 8f83f33 (feat(paymentcryptography): a key may be disabled and enabled again)
        runtimeReachable={true}
      />
    </QueryClientProvider>,
  );
  return {invalidated};
}

describe("the usage of a payment key", () => {
  beforeEach(() => {
    setUsage.mockReset();
    setUsage.mockResolvedValue(undefined as never);
    setAccountId(DEFAULT_ACCOUNT_ID);
  });

  it("disables a key that is in use", async () => {
    const user = userEvent.setup();
<<<<<<< HEAD
    renderSection(key);
=======
    renderSection();
>>>>>>> 8f83f33 (feat(paymentcryptography): a key may be disabled and enabled again)

    await user.click(screen.getByRole("button", {name: /Disable key/i}));

    await waitFor(() => expect(setUsage).toHaveBeenCalledTimes(1));
    expect(setUsage.mock.calls[0][3]).toEqual({enabled: false});
  });

  it("enables a key that is not in use", async () => {
    const user = userEvent.setup();
    renderSection({...key, metadata: {enabled: false}});

    await user.click(screen.getByRole("button", {name: /Enable key/i}));

    await waitFor(() => expect(setUsage).toHaveBeenCalledTimes(1));
    expect(setUsage.mock.calls[0][3]).toEqual({enabled: true});
  });

  it("refreshes the resource and the list of the account it saved in", async () => {
    const user = userEvent.setup();
<<<<<<< HEAD
    const {invalidated} = renderSection(key);
=======
    const {invalidated} = renderSection();
>>>>>>> 8f83f33 (feat(paymentcryptography): a key may be disabled and enabled again)

    await user.click(screen.getByRole("button", {name: /Disable key/i}));

    await waitFor(() => expect(invalidated.length).toBe(2));
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
<<<<<<< HEAD

  it("says the usage is unknown when the service did not say whether the key may be used", () => {
    renderSection({...key, metadata: {}});

    // The API publishes the key's Enabled, so a key it said nothing about is
    // neither in use nor out of use: the console does not work the state out
    // for itself.
    expect(screen.getByText(/did not say whether the key may be used/)).toBeDefined();
    expect(screen.queryByRole("button", {name: /Disable key/})).toBeNull();
    expect(screen.queryByRole("button", {name: /Enable key/})).toBeNull();
  });

  it("says the usage is unknown when the key could not be read", () => {
    renderSection(undefined, {keyUnreadable: true});

    expect(screen.getByText(/could not be read/)).toBeDefined();
    expect(screen.queryByRole("button", {name: /Disable key/})).toBeNull();
    expect(screen.queryByRole("button", {name: /Enable key/})).toBeNull();
  });

  it("says the usage is unknown while the key has not been read", () => {
    renderSection(undefined);

    expect(screen.getByText(/has not been read/)).toBeDefined();
    expect(screen.queryByRole("button", {name: /Disable key/})).toBeNull();
    expect(screen.queryByRole("button", {name: /Enable key/})).toBeNull();
  });
=======
>>>>>>> 8f83f33 (feat(paymentcryptography): a key may be disabled and enabled again)
});
