import {describe, expect, it} from "vitest";

import {
  setPaymentCryptographyKeyPolicy,
  setPaymentCryptographyKeyReplication,
  setPaymentCryptographyKeyUsage,
} from "./cloudProxyClient";

/**
 * The bodies the payment cryptography requests carry.
 *
 * <p>The bodies are the contract with the API, so the checks here are the ones
 * the compiler makes: a body that names a member the API does not read is a
 * mistake at the place it is written, and a body of an unchecked shape is one
 * that only fails at runtime, with the server's own message.
 */
describe("the bodies the payment cryptography requests carry", () => {
  it("names the member the usage request carries", () => {
    const call = () =>
      setPaymentCryptographyKeyUsage("aws", "paymentcryptography", "key/abc", {
        // @ts-expect-error the request says whether the key may be used
        enable: true,
      });

    expect(call).toBeInstanceOf(Function);
  });

  it("names the members the replication request carries", () => {
    const call = () =>
      setPaymentCryptographyKeyReplication("aws", "paymentcryptography", "key/abc", {
        // @ts-expect-error the request names the Regions to add and to remove
        replicationRegions: ["us-east-2"],
      });

    expect(call).toBeInstanceOf(Function);
  });

  it("names the member the policy request carries", () => {
    const call = () =>
      setPaymentCryptographyKeyPolicy("aws", "paymentcryptography", "key/abc", {
        // @ts-expect-error the request says what the policy is
        document: "{}",
      });

    expect(call).toBeInstanceOf(Function);
  });
});
