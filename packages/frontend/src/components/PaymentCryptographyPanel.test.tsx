<<<<<<< HEAD
import {render, screen} from "@testing-library/react";
=======
import {act, render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
>>>>>>> 077efc2 (fix(paymentcryptography): the panel waits for the key it speaks of)
import {describe, expect, it} from "vitest";

import {PaymentCryptographyPanel} from "@/components/PaymentCryptographyPanel";
import type {CloudResource} from "@/types/resource";

const key: CloudResource = {
<<<<<<< HEAD
  id: "arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
=======
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
>>>>>>> 077efc2 (fix(paymentcryptography): the panel waits for the key it speaks of)
  name: "arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
<<<<<<< HEAD
  metadata: {
    enabled: true,
    publicKeyCertificate: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0t",
    publicKeyCertificateState: "signed",
  },
};

describe("the panels of a payment key", () => {
  it("shows the certificate of a payment key", () => {
    render(<PaymentCryptographyPanel resource={key} />);

    expect(screen.getByLabelText("Public key certificate")).toBeDefined();
  });

  it("shows nothing for a resource that is not a payment key", () => {
    render(<PaymentCryptographyPanel resource={{...key, type: "alias"}} />);

    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
    expect(screen.queryByText(/Public Key Certificate/)).toBeNull();
  });

  it("shows nothing while the key has not been read", () => {
    const {container} = render(<PaymentCryptographyPanel />);

    expect(container.textContent).toBe("");
  });

  it("says so when the key could not be read", () => {
    render(<PaymentCryptographyPanel keyUnreadable />);

    // The key could not be read, so nothing is known of its certificate, and
    // the panel says that rather than staying silent.
    expect(screen.getByText(/could not be read/)).toBeDefined();
=======
  metadata: {enabled: true},
};

function renderPanel(props: {
  resource?: CloudResource;
  keyUnreadable?: boolean;
}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyPanel
        cloud="aws"
        resource={props.resource}
        keyUnreadable={props.keyUnreadable}
        runtimeReachable
      />
    </QueryClientProvider>,
  );
}

describe("the panels of a payment key", () => {
  it("shows the usage of the key that was read", async () => {
    renderPanel({resource: key});

    expect(await screen.findByText(/The key may be used/)).toBeDefined();
    expect(screen.getByRole("button", {name: /Disable key/})).toBeDefined();
  });

  it("shows nothing for a resource that is not a payment key", async () => {
    const {container} = renderPanel({resource: {...key, type: "alias"}});

    // The panel holds the rule that a resource is a payment key, so an alias
    // gets no section of its own.
    await act(async () => undefined);
    expect(container.textContent).toBe("");
  });

  it("says so when the key could not be read", async () => {
    renderPanel({keyUnreadable: true});

    // The key could not be read, so nothing is known of its usage, and the
    // panel says that rather than speaking about a key it has not read.
    expect(await screen.findByText(/could not be read/)).toBeDefined();
    expect(screen.queryByRole("button", {name: /Disable key/})).toBeNull();
    expect(screen.queryByRole("button", {name: /Enable key/})).toBeNull();
  });

  it("says the usage is unknown while the key has not been read", async () => {
    renderPanel({});

    // The detail is on its way: nothing is known of the key's usage yet.
    expect(await screen.findByText(/has not been read/)).toBeDefined();
    expect(screen.queryByRole("button", {name: /Disable key/})).toBeNull();
    expect(screen.queryByRole("button", {name: /Enable key/})).toBeNull();
>>>>>>> 077efc2 (fix(paymentcryptography): the panel waits for the key it speaks of)
  });
});
