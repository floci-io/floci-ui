import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import {PaymentCryptographyPanel} from "@/components/PaymentCryptographyPanel";
import type {CloudResource} from "@/types/resource";

/** The policy section asks the query client, so the panel needs one. */
function renderPanel(props: React.ComponentProps<typeof PaymentCryptographyPanel>) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyPanel {...props} />
    </QueryClientProvider>,
  );
}

const key: CloudResource = {
  id: "arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  name: "arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {
    enabled: true,
    publicKeyCertificate: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0t",
    publicKeyCertificateState: "signed",
  },
};

describe("the panels of a payment key", () => {
  it("shows the certificate of a payment key", () => {
    renderPanel({resource: key, cloud: "aws", runtimeReachable: true});

    expect(screen.getByLabelText("Public key certificate")).toBeDefined();
  });

  it("shows the usage and the policy of a payment key as well", () => {
    renderPanel({
      resource: {...key, metadata: {...key.metadata, keyPolicy: '{"Version":"2012-10-17"}'}},
      cloud: "aws",
      runtimeReachable: true,
    });

    expect(screen.getByLabelText("Public key certificate")).toBeDefined();
    expect(screen.getByText("Usage")).toBeDefined();
    expect(screen.getByText(/Key Policy/)).toBeDefined();
  });

  it("shows nothing for a resource that is not a payment key", () => {
    renderPanel({resource: {...key, type: "alias"}, cloud: "aws", runtimeReachable: true});

    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
    expect(screen.queryByText(/Public Key Certificate/)).toBeNull();
  });

  it("shows nothing of the certificate while the key has not been read", () => {
    renderPanel({cloud: "aws", runtimeReachable: true});

    // The certificate is part of the key's detail, and the detail has not been
    // read, so the panel says nothing of it.
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
    // The policy says what it does not know.
    expect(screen.getByText(/The policy has not been read yet/)).toBeDefined();
  });

  it("says so when the key could not be read", () => {
    renderPanel({keyUnreadable: true, cloud: "aws", runtimeReachable: true});

    // The key could not be read, so nothing is known of its certificate, and
    // the panel says that rather than staying silent.
    expect(screen.getByText(/its certificate is unknown/)).toBeDefined();
    expect(
      screen.getByText(/The key could not be read, so its policy is unknown/),
    ).toBeDefined();
  });
});
