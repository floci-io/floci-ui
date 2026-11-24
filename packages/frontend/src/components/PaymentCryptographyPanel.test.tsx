import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {describe, expect, it} from "vitest";

import {PaymentCryptographyPanel} from "@/components/PaymentCryptographyPanel";
import type {CloudResource} from "@/types/resource";

/** The usage section asks the query client, so the panel needs one. */
function renderPanel(props: React.ComponentProps<typeof PaymentCryptographyPanel>) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyPanel {...props} />
    </QueryClientProvider>,
  );
}

const key: CloudResource = {
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
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

<<<<<<< HEAD
<<<<<<< HEAD
describe("the panels of a payment key", () => {
  it("shows the certificate of a payment key", () => {
    renderPanel({resource: key, cloud: "aws", runtimeReachable: true});

    expect(screen.getByLabelText("Public key certificate")).toBeDefined();
  });

  it("shows nothing for a resource that is not a payment key", () => {
    renderPanel({resource: {...key, type: "alias"}, cloud: "aws", runtimeReachable: true});

    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
    expect(screen.queryByText(/Public Key Certificate/)).toBeNull();
  });

<<<<<<< HEAD
  it("shows nothing of the certificate while the key has not been read", () => {
    renderPanel({cloud: "aws", runtimeReachable: true});
=======
  it("shows nothing while the key has not been read", () => {
    const {container} = render(<PaymentCryptographyPanel />);
=======
=======
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)
/** The panels of a key read through the query client, so it is given one. */
function renderPanel(props: {
  resource?: CloudResource;
  keyUnreadable?: boolean;
}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <PaymentCryptographyPanel cloud="aws" runtimeReachable={true} {...props} />
    </QueryClientProvider>,
  );
}

describe("the panels of a payment key", () => {
  it("shows the certificate of a payment key", async () => {
    renderPanel({resource: key});

    expect(await screen.findByLabelText("Public key certificate")).toBeDefined();
  });

  it("shows nothing for a resource that is not a payment key", () => {
    const {container} = renderPanel({resource: {...key, type: "alias"}});

    // An alias is not a key, so it has none of the panels of a key.
    expect(container.textContent).toBe("");
  });

<<<<<<< HEAD
<<<<<<< HEAD
  it("shows nothing while the key has not been read", () => {
    const {container} = renderPanel({});
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
<<<<<<< HEAD
>>>>>>> badeb69 (feat(paymentcryptography): the certificate of a key's public half)

    // The certificate is part of the key's detail, and the detail has not been
    // read, so the panel says nothing of it.
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
    // The usage says what it does not know.
    expect(screen.getByText(/has not been read yet/)).toBeDefined();
=======
=======
=======
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)
  it("says what it does not know while the key has not been read", async () => {
    renderPanel({});

    // The key has not been read yet, so the panels say that rather than
    // speaking about a key they know nothing of.
    expect((await screen.findAllByText(/has not been read yet/)).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
>>>>>>> 9452c1c (fix(paymentcryptography): the usage panel speaks about the key it read)
  });

<<<<<<< HEAD
<<<<<<< HEAD
  it("says so when the key could not be read", () => {
    renderPanel({keyUnreadable: true, cloud: "aws", runtimeReachable: true});

    // The key could not be read, so nothing is known of its certificate, and
    // the panel says that rather than staying silent.
<<<<<<< HEAD
    expect(screen.getByText(/its certificate is unknown/)).toBeDefined();
=======
    expect(screen.getByText(/could not be read/)).toBeDefined();
=======
=======
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)
  it("says so when the key could not be read", async () => {
    renderPanel({keyUnreadable: true});

    // The key could not be read, so nothing is known of its certificate, and
    // the panel says that rather than staying silent.
<<<<<<< HEAD
<<<<<<< HEAD
    expect(await screen.findByText(/could not be read/)).toBeDefined();
>>>>>>> debebdc (feat(paymentcryptography): the certificate of a key's public half)
<<<<<<< HEAD
>>>>>>> badeb69 (feat(paymentcryptography): the certificate of a key's public half)
=======
=======
    expect(await screen.findByText(/its certificate is unknown/)).toBeDefined();
>>>>>>> d7092c2 (feat(paymentcryptography): the material a key leaves under)
>>>>>>> dba61d0 (feat(paymentcryptography): the material a key leaves under)
=======
    expect(await screen.findByText(/its certificate is unknown/)).toBeDefined();
>>>>>>> d83690d (fix(console): the panels are the branch's own, the shared surface is main's)
  });
});
