import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
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

function renderSection(
  resource: CloudResource | undefined,
  options: {keyUnreadable?: boolean} = {},
) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const invalidated: unknown[][] = [];
  client.invalidateQueries = vi.fn(async (filters: unknown) => {
    invalidated.push([filters]);
    return {status: "success", statusText: "", data: undefined, error: null} as never;
  }) as typeof client.invalidateQueries;

  const view = (target: CloudResource | undefined) => (
    <QueryClientProvider client={client}>
      <PaymentCryptographyPolicySection
        cloud="aws"
        resource={target}
        keyUnreadable={options.keyUnreadable}
        runtimeReachable={true}
      />
    </QueryClientProvider>
  );

  const {rerender} = render(view(resource));
  return {
    invalidated,
    // The panel is rendered again by the view that holds it, so a section can
    // be painted twice, as an account switch paints it.
    rerender: (target: CloudResource | undefined = resource) => rerender(view(target)),
  };
}

describe("the policy of a payment key", () => {
  beforeEach(() => {
    setPolicy.mockReset();
    setPolicy.mockResolvedValue(undefined as never);
    setAccountId(DEFAULT_ACCOUNT_ID);
  });

  it("attaches the policy the form holds", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.click(screen.getByRole("button", {name: /Edit policy/i}));
    const editor = screen.getByLabelText("Key policy");
    fireEvent.change(editor, {target: {value: "{}"}});
    await user.click(screen.getByRole("button", {name: /Save policy/i}));

    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));
    expect(setPolicy.mock.calls[0][3]).toEqual({policy: "{}"});
  });

  it("removes the policy the key holds", async () => {
    const user = userEvent.setup();
    renderSection(key);

    await user.click(screen.getByRole("button", {name: /Remove policy/i}));

    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));
    expect(setPolicy.mock.calls[0][3]).toEqual({policy: ""});
  });

  it("refreshes the resource and the list of the account it saved in", async () => {
    const user = userEvent.setup();
    const {invalidated} = renderSection(key);

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

  it("says the key holds no policy when it was read and holds none", () => {
    renderSection({...key, metadata: {enabled: true, keyPolicy: null}});

    expect(
      screen.getByText("No policy: the key is used only by the account that holds it."),
    ).toBeTruthy();
  });

  it("says the policy has not been read, rather than that the key holds none", () => {
    renderSection({...key, metadata: {enabled: true}});

    // The API owns the state: a row that never read a policy publishes none,
    // which is not the same as a key that was read and holds none.
    expect(screen.getByText("The policy has not been read yet.")).toBeTruthy();
    expect(
      screen.queryByText("No policy: the key is used only by the account that holds it."),
    ).toBeNull();
  });

  it("says the policy could not be read", () => {
    renderSection({...key, metadata: {enabled: true, keyPolicyUnavailable: true}});

    expect(screen.getByText("The policy could not be read.")).toBeTruthy();
    expect(
      screen.queryByText("No policy: the key is used only by the account that holds it."),
    ).toBeNull();
  });

  it("says the policy has not been read yet when the key is on its way", () => {
    renderSection(undefined);

    // Nothing was read, so the section must not speak of a policy it has not
    // seen, and it must not offer to change one either.
    expect(screen.getByText("The policy has not been read yet.")).toBeTruthy();
    expect(screen.queryByRole("button", {name: /policy/i})).toBeNull();
  });

  it("says the key could not be read, so its policy is unknown", () => {
    renderSection(undefined, {keyUnreadable: true});

    expect(screen.getByText("The key could not be read, so its policy is unknown.")).toBeTruthy();
    expect(screen.queryByRole("button", {name: /policy/i})).toBeNull();
  });

  it("refreshes the account the save was made in, not the account the user is in by then", async () => {
    let release: (() => void) | undefined;
    setPolicy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    const {invalidated, rerender} = renderSection(key);

    await user.click(screen.getByRole("button", {name: /Edit policy/i}));
    fireEvent.change(screen.getByLabelText("Key policy"), {target: {value: "{}"}});
    await user.click(screen.getByRole("button", {name: /Save policy/i}));
    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));

    // The account is switched while the request is in flight, and the view is
    // painted again, which is what an account switch does.
    setAccountId("111122223333");
    rerender();

    await act(async () => {
      release?.();
    });

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

  it("refreshes the account the removal was made in, not the account the user is in by then", async () => {
    let release: (() => void) | undefined;
    setPolicy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    const {invalidated, rerender} = renderSection(key);

    await user.click(screen.getByRole("button", {name: /Remove policy/i}));
    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));

    setAccountId("111122223333");
    rerender();

    await act(async () => {
      release?.();
    });

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

  it("does not let a save start while a removal is in flight", async () => {
    let release: (() => void) | undefined;
    setPolicy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSection(key);

    await user.click(screen.getByRole("button", {name: /Remove policy/i}));
    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));

    // Two writes in flight at once: the one that lands last wins, and the
    // policy the key holds is whichever it was.
    expect(screen.getByRole("button", {name: /Edit policy/i})).toBeDisabled();

    await act(async () => {
      release?.();
    });
  });
});
