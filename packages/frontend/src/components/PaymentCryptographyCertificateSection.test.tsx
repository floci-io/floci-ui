import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";

import {PaymentCryptographyCertificateSection} from "@/components/PaymentCryptographyCertificateSection";
import type {CloudResource} from "@/types/resource";

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

/** A key whose certificate is in the given state, with no certificate of its own. */
function keyInState(state: string): CloudResource {
  return {...key, metadata: {enabled: true, publicKeyCertificateState: state}};
}

const symmetricKey = keyInState("no-public-half");

describe("the certificate of a payment key", () => {
  it("shows the certificate the service signed", () => {
    render(<PaymentCryptographyCertificateSection resource={key} />);

    expect(screen.getByLabelText("Public key certificate")).toBeDefined();
    expect(screen.getByText(/signed into a certificate/)).toBeDefined();
  });

  it("says so when the key has no public half", () => {
    render(<PaymentCryptographyCertificateSection resource={symmetricKey} />);

    // The section says why there is no certificate, rather than showing nothing.
    expect(screen.getByText(/no public half/)).toBeDefined();
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
  });

  it("says so when the service has signed no certificate for a key of a pair", () => {
    render(
      <PaymentCryptographyCertificateSection
        resource={keyInState("unsigned")}
      />,
    );

    // A key of a pair has a public half, so it is the service that has signed
    // nothing, and the section says that rather than claiming there is no
    // public half.
    expect(screen.getByText(/has not signed a certificate/)).toBeDefined();
    expect(screen.queryByText(/no public half/)).toBeNull();
  });

  it("says so when the certificate could not be read", () => {
    render(
      <PaymentCryptographyCertificateSection
        resource={keyInState("unreadable")}
      />,
    );

    // A read that failed is neither a key without a certificate nor a service
    // that signed none, and the section says which it was.
    expect(screen.getByText(/could not be read/)).toBeDefined();
    expect(screen.queryByText(/no public half/)).toBeNull();
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
  });

  it("says so when the service did not say what kind of key it is", () => {
    render(
      <PaymentCryptographyCertificateSection
        resource={keyInState("unknown")}
      />,
    );

    // A key whose class was not read is neither a pair nor a symmetric key, so
    // the section does not claim that it has no public half.
    expect(screen.getByText(/did not say what kind of key/)).toBeDefined();
    expect(screen.queryByText(/no public half/)).toBeNull();
  });

  it("says so when the key itself could not be read", () => {
    render(<PaymentCryptographyCertificateSection keyUnreadable />);

    // The key could not be read, so nothing is known of its certificate, and
    // the section says that rather than staying silent.
    expect(screen.getByText(/could not be read/)).toBeDefined();
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
  });

  it("shows the chain the certificate is signed in, when there is one", () => {
    render(
      <PaymentCryptographyCertificateSection
        resource={{...key, metadata: {...key.metadata, publicKeyCertificateChain: "LS0tLS1DSEVS"}}}
      />,
    );

    // The chain travels with the certificate: the leaf alone cannot be
    // verified against anything.
    expect(screen.getByLabelText("Public key certificate chain")).toBeDefined();
  });

  it("shows no chain when the service handed none out", () => {
    render(<PaymentCryptographyCertificateSection resource={key} />);

    expect(screen.queryByLabelText("Public key certificate chain")).toBeNull();
  });

  it("copies the certificate and the chain", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});

    render(
      <PaymentCryptographyCertificateSection
        resource={{...key, metadata: {...key.metadata, publicKeyCertificateChain: "LS0tLS1DSEVS"}}}
      />,
    );

    await user.click(screen.getByRole("button", {name: /Copy certificate/}));
    expect(writeText).toHaveBeenCalledWith("LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0t");

    await user.click(screen.getByRole("button", {name: /Copy chain/}));
    expect(writeText).toHaveBeenCalledWith("LS0tLS1DSEVS");
  });

  it("tells one copy from the other", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});

    render(
      <PaymentCryptographyCertificateSection
        resource={{...key, metadata: {...key.metadata, publicKeyCertificateChain: "LS0tLS1DSEVS"}}}
      />,
    );

    await user.click(screen.getByRole("button", {name: /Copy certificate/}));

    // The clipboard holds the certificate alone, so the chain's button does not
    // claim it was copied as well.
    const statuses = screen.getAllByRole("status").map((node) => node.textContent);
    expect(statuses.filter((text) => text === "Copied")).toHaveLength(1);
  });

  it("says so when the clipboard is not available", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});

    render(<PaymentCryptographyCertificateSection resource={key} />);

    await user.click(screen.getByRole("button", {name: /Copy certificate/}));

    // A button that does nothing looks broken, so the failure is said.
    expect(await screen.findByText(/clipboard was not available/)).toBeDefined();
  });
});
