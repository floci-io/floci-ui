import {describe, expect, it} from "vitest";

import {isPaymentKey} from "@/lib/paymentCryptography";
import type {CloudResource} from "@/types/resource";

const key: CloudResource = {
  id: "key/arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  name: "arn:aws:payment-cryptography:us-east-1:000000000000:key/abc",
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {},
};

describe("a payment key", () => {
  it("is a resource of the payment cryptography service", () => {
    expect(isPaymentKey(key)).toBe(true);
  });

  it("is not an alias", () => {
    expect(isPaymentKey({...key, type: "alias"})).toBe(false);
  });
});
