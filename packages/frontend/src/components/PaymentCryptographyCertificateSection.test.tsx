import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import {PaymentCryptographyCertificateSection} from "@/components/PaymentCryptographyCertificateSection";
import type {CloudResource} from "@/types/resource";

const key: CloudResource = {
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  name: "key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {enabled: true, publicKeyCertificate: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0t"},
};

describe("the certificate of a payment key", () => {
  it("shows the certificate the service signed", () => {
    render(
      <PaymentCryptographyCertificateSection
        cloud="aws"
        resource={key}
        runtimeReachable={true}
      />,
    );

    expect(screen.getByLabelText("Public key certificate")).toBeDefined();
    expect(screen.getByText(/signed into a certificate/)).toBeDefined();
  });

  it("says so when the key has no public half", () => {
    render(
      <PaymentCryptographyCertificateSection
        cloud="aws"
        resource={{...key, metadata: {enabled: true, publicKeyCertificate: null}}}
        runtimeReachable={true}
      />,
    );

    // The section says why there is no certificate, rather than showing nothing.
    expect(screen.getByText(/no public half/)).toBeDefined();
    expect(screen.queryByLabelText("Public key certificate")).toBeNull();
  });
});
