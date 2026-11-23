import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import {PaymentCryptographyPanel} from "@/components/PaymentCryptographyPanel";
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

  it("shows nothing when there is no resource", () => {
    const {container} = render(<PaymentCryptographyPanel />);

    expect(container.textContent).toBe("");
  });
});
