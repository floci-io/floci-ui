import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";

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
    keyClass: "ASYMMETRIC_KEY_PAIR",
    publicKeyCertificate: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0t",
  },
};

const symmetricKey: CloudResource = {
  ...key,
  metadata: {...key.metadata, keyClass: "SYMMETRIC_KEY", publicKeyCertificate: null},
};

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
        resource={{...key, metadata: {...key.metadata, publicKeyCertificate: null}}}
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
        resource={{
          ...key,
          metadata: {enabled: true, keyClass: "ASYMMETRIC_KEY_PAIR", publicKeyCertificateUnavailable: true},
        }}
      />,
    );

    // A read that failed is neither a key without a certificate nor a service
    // that signed none, and the section says which it was.
    expect(screen.getByText(/could not be read/)).toBeDefined();
    expect(screen.queryByText(/no public half/)).toBeNull();
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
  });
});
