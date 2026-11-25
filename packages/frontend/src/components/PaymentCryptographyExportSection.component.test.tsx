import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {exportPaymentCryptographyKey} from "@/api/cloudProxyClient";
import {PaymentCryptographyExportSection} from "@/components/PaymentCryptographyExportSection";
import type {CloudResource} from "@/types/resource";
import type {ServiceSchema} from "@/types/schema";

vi.mock("@/api/cloudProxyClient", () => ({
  exportPaymentCryptographyKey: vi.fn(),
}));

const exportKey = vi.mocked(exportPaymentCryptographyKey);

const schema = {
  cloud: "aws",
  service: "paymentcryptography",
  displayName: "Payment Cryptography",
  fields: [],
  actions: ["list", "create", "delete", "inspect"],
  filters: [],
  columns: [{name: "name", label: "Name"}],
  pairings: [
    {
      discriminator: "keyAlgorithm",
      allowed: {AES_256: ["AES_256"], AES_128: ["AES_128", "AES_256"]},
    },
  ],
} as unknown as ServiceSchema;

const key: CloudResource = {
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  name: "key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {enabled: true, exportable: true, keyAlgorithm: "AES_256"},
};

const wrapping: CloudResource = {
  ...key,
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/kek",
  name: "key/kek",
  metadata: {
    enabled: true,
    exportable: true,
    mayWrap: true,
    keyAlgorithm: "AES_256",
    keyUsage: "TR31_K0_KEY_ENCRYPTION_KEY",
    keyModesOfUse: {Wrap: true, Unwrap: true},
  },
};

function renderSection(
  resource: CloudResource = key,
  state: {
    /** The account's keys; null when they have not been read at all. */
    resources?: CloudResource[] | null;
    resourcesLoading?: boolean;
    resourcesError?: boolean;
  } = {},
) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const view = (next: {resources?: CloudResource[] | null} = {}) => {
    const resources =
      next.resources === undefined
        ? state.resources === undefined
          ? [wrapping]
          : state.resources ?? undefined
        : next.resources ?? undefined;
    return (
      <QueryClientProvider client={client}>
        <PaymentCryptographyExportSection
          cloud="aws"
          resource={resource}
          resources={resources}
          resourcesLoading={state.resourcesLoading}
          resourcesError={state.resourcesError}
          schema={schema}
          runtimeReachable={true}
        />
      </QueryClientProvider>
    );
  };
  const rendered = render(view());
  return {
    /** The account's keys are read again, and hold a different list. */
    rerenderWithKeys: (resources: CloudResource[] | null) => rendered.rerender(view({resources})),
    unmount: rendered.unmount,
  };
}

describe("the material a payment key leaves under", () => {
  beforeEach(() => {
    exportKey.mockReset();
    exportKey.mockResolvedValue({
      keyMaterial: "D0112K1AB00E0000",
      format: "TR31_KEY_BLOCK",
      wrappingKeyArn: null,
      keyCheckValue: null,
    } as never);
  });

  it("offers only the wrapping keys the matrix allows", async () => {
    renderSection(key, {resources: [wrapping]});

    const options = await screen.findAllByRole("option");
    // The wrapping key is an AES-256 one, and the key that leaves is an AES-256
    // one, so it is allowed.
    expect(options.length).toBe(2);
  });

  it("does not offer the export for a key that is not exportable", async () => {
    renderSection({...key, metadata: {...key.metadata, exportable: false}}, {resources: [wrapping]});

    expect(screen.getByText(/not exportable/)).toBeDefined();
    expect(screen.getByRole("button", {name: /Export key/i}).hasAttribute("disabled")).toBe(true);
    // Exportability is fixed when the key is made, so the advice says so
    // rather than sending the reader looking for a control that is not there.
    expect(screen.getByText(/made exportable when it is made/)).toBeDefined();
  });

  it("does not offer the export when the service did not say whether the key may leave", async () => {
    const user = userEvent.setup();
    renderSection({...key, metadata: {...key.metadata, exportable: undefined}}, {resources: [wrapping]});

    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);

    // The service said nothing, so the console does not work the state out for
    // itself, and the export is not offered.
    expect(screen.getByRole("button", {name: /Export key/i}).hasAttribute("disabled")).toBe(true);
  });

  it("does not offer the export when the chosen key is no longer offered", async () => {
    const user = userEvent.setup();
    const {rerenderWithKeys} = renderSection(key, {resources: [wrapping]});

    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);
    expect(screen.getByRole("button", {name: /Export key/i}).hasAttribute("disabled")).toBe(false);

    // The account's keys are read again and the chosen key is no longer among
    // them, so the control has no option for it any more and the export must
    // not ask the service to wrap under a key it will refuse.
    rerenderWithKeys([]);

    expect(screen.getByRole("button", {name: /Export key/i}).hasAttribute("disabled")).toBe(true);
  });

  it("does not offer a key as its own wrapping key", async () => {
    // The key that leaves is a key encryption key itself, so it holds every
    // rule for a wrapping key, but a key may not carry itself.
    const itself: CloudResource = {
      ...wrapping,
      id: key.id,
      name: key.name,
    };
    renderSection({...key, metadata: {...key.metadata, mayWrap: true}}, {resources: [itself]});

    const options = await screen.findAllByRole("option");

    // Only the choice that asks for a wrapping key.
    expect(options.length).toBe(1);
  });

  it("leaves the material of one export off the screen when another key is chosen", async () => {
    const user = userEvent.setup();
    renderSection(key, {resources: [wrapping]});

    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);
    await user.click(screen.getByRole("button", {name: /Export key/i}));
    await waitFor(() => expect(screen.getByLabelText("Exported key material")).toBeDefined());

    // Another wrapping key is chosen, and the material of the last export is not
    // the material of this one, so it goes.
    exportKey.mockResolvedValueOnce({
      keyMaterial: "D0112K1AB00E0000",
      format: "TR31_KEY_BLOCK",
      wrappingKeyArn: null,
      keyCheckValue: null,
    } as never);
    await user.selectOptions(screen.getByLabelText("Wrapping key"), "");
    await waitFor(() => expect(screen.queryByLabelText("Exported key material")).toBeNull());
  });

  it("does not fall over on an algorithm the prototype chain answers for", async () => {    // The algorithm comes from the service, so a name the prototype chain
    // answers for is not a row of the matrix, and no key may carry the one.
    renderSection({...key, metadata: {...key.metadata, keyAlgorithm: "__proto__"}}, {resources: [wrapping]});

    const options = await screen.findAllByRole("option");

    // Only the choice that asks for a wrapping key, so nothing may carry it.
    expect(options.length).toBe(1);
  });

  it("keeps the name of the button and announces the outcome beside it", async () => {
    const user = userEvent.setup();
    renderSection(key, {resources: [wrapping]});

    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);
    await user.click(screen.getByRole("button", {name: /Export key/i}));
    await waitFor(() => expect(screen.getByLabelText("Exported key material")).toBeDefined());

    await user.click(screen.getByRole("button", {name: /Copy material/i}));

    // The name of the button never changes under the reader, and the outcome
    // is announced beside it.
    expect(screen.getByRole("button", {name: /Copy material/i})).toBeDefined();
    expect(await screen.findByRole("status")).toHaveTextContent(/Copied/);
  });

  it("the copy state does not follow another material", async () => {
    const user = userEvent.setup();
    // The setup replaces the clipboard with a stub of its own, so the refusal
    // is put in place after it.
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
    renderSection(key, {resources: [wrapping]});

    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);
    await user.click(screen.getByRole("button", {name: /Export key/i}));
    await waitFor(() => expect(screen.getByLabelText("Exported key material")).toBeDefined());
    await user.click(screen.getByRole("button", {name: /Copy material/i}));
    expect(await screen.findByRole("alert")).toHaveTextContent(/clipboard was not available/i);

    // Another export is made, so the refusal of the last material is not a
    // refusal of this one.
    await user.selectOptions(screen.getByLabelText("Wrapping key"), "");
    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);
    await user.click(screen.getByRole("button", {name: /Export key/i}));
    await waitFor(() => expect(screen.getByLabelText("Exported key material")).toBeDefined());

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("the export request is cancelled when the section goes away", async () => {
    const user = userEvent.setup();
    const {unmount} = renderSection(key, {resources: [wrapping]});

    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);
    await user.click(screen.getByRole("button", {name: /Export key/i}));

    await waitFor(() => expect(exportKey).toHaveBeenCalled());
    const signal = exportKey.mock.calls[0][4] as AbortSignal | undefined;
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);

    // The reader goes to another key, so the material of the key they left
    // behind is not fetched any more.
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("says so when the clipboard refuses", async () => {
    const user = userEvent.setup();
    // The setup replaces the clipboard with a stub of its own, so the refusal
    // is put in place after it.
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
    renderSection(key, {resources: [wrapping]});

    await user.selectOptions(screen.getByLabelText("Wrapping key"), wrapping.id);
    await user.click(screen.getByRole("button", {name: /Export key/i}));
    await waitFor(() => expect(screen.getByLabelText("Exported key material")).toBeDefined());

    await user.click(screen.getByRole("button", {name: /Copy material/i}));

    // The clipboard is refused in some contexts, so a copy that did not happen
    // is said rather than left to look like a button that does nothing.
    expect(await screen.findByRole("alert")).toHaveTextContent(/clipboard was not available/i);
  });

  it("says the keys of the account have not been read yet", async () => {
    renderSection(key, {resources: null});

    // The list of the account's keys is still on its way, so the console
    // cannot say that no key of the account may carry this one.
    expect(screen.getByText(/have not been read yet/i)).toBeDefined();
    expect(screen.queryByText(/No key of this account may carry this one/)).toBeNull();
  });

  it("says the keys of the account could not be read", async () => {
    renderSection(key, {resources: null, resourcesError: true});

    // The request failed, so the console says so rather than claiming that the
    // account holds no key that may carry this one.
    expect(screen.getByText(/could not be read/i)).toBeDefined();
    expect(screen.queryByText(/No key of this account may carry this one/)).toBeNull();
  });

  it("says that no key of the account may carry this one when the list is empty", async () => {
    renderSection(key, {resources: []});

    expect(screen.getByText(/No key of this account may carry this one/)).toBeDefined();
  });
});
