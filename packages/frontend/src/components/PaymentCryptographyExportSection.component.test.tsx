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
    keyAlgorithm: "AES_256",
    keyUsage: "TR31_K0_KEY_ENCRYPTION_KEY",
    keyModesOfUse: {Wrap: true, Unwrap: true},
  },
};

function renderSection(resource: CloudResource = key, resources: CloudResource[] = [wrapping]) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyExportSection
        cloud="aws"
        resource={resource}
        resources={resources}
        schema={schema}
        runtimeReachable={true}
      />
    </QueryClientProvider>,
  );
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
    renderSection(key, [wrapping]);

    const options = await screen.findAllByRole("option");
    // The wrapping key is an AES-256 one, and the key that leaves is an AES-256
    // one, so it is allowed.
    expect(options.length).toBe(2);
  });

  it("does not offer the export for a key that is not exportable", async () => {
    renderSection({...key, metadata: {...key.metadata, exportable: false}}, [wrapping]);

    expect(screen.getByText(/not exportable/)).toBeDefined();
    expect(screen.getByRole("button", {name: /Export key/i}).hasAttribute("disabled")).toBe(true);
  });

  it("leaves the material of one export off the screen when another key is chosen", async () => {
    const user = userEvent.setup();
    renderSection(key, [wrapping]);

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
});
