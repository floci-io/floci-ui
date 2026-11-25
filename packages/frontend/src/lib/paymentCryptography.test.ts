import {describe, expect, it} from "vitest";

import {aliasNamesOf, isPaymentKey, publishedPolicy} from "@/lib/paymentCryptography";
import type {CloudResource} from "@/types/resource";

describe("the policy the API published", () => {
  it("is the policy the key holds", () => {
    expect(publishedPolicy({keyPolicy: '{"Version":"2012-10-17"}'})).toBe('{"Version":"2012-10-17"}');
  });

  it("is none where the API published that the key holds none", () => {
    expect(publishedPolicy({keyPolicy: null})).toBeNull();
  });

  it("is not published where the API published no policy at all", () => {
    expect(publishedPolicy({})).toBeUndefined();
    expect(publishedPolicy(undefined)).toBeUndefined();
  });

  it("is not a name inherited from the prototype", () => {
    // A name inherited from the prototype is not a state the API published, so
    // a key that holds no policy does not hold the one the prototype names.
    const metadata = Object.create({keyPolicy: '{"Version":"2012-10-17"}'});

    expect(publishedPolicy(metadata)).toBeUndefined();
  });
});

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

describe("the names a payment key was given", () => {
  it("are the ones the API published", () => {
    expect(aliasNamesOf({...key, metadata: {aliasNames: ["alias/card-cvk"]}})).toEqual([
      "alias/card-cvk",
    ]);
  });

  it("are none when the key has none", () => {
    expect(aliasNamesOf(key)).toEqual([]);
  });

  it("are none when the API published something that is not a list", () => {
    expect(aliasNamesOf({...key, metadata: {aliasNames: "alias/card-cvk" as never}})).toEqual([]);
  });

  it("are none when the name is inherited from the prototype", () => {
    // A name inherited from the prototype is not a state the API published.
    const metadata = Object.create({aliasNames: ["alias/inherited"]});
    expect(aliasNamesOf({...key, metadata})).toEqual([]);
  });
});

describe("a payment key", () => {
  it("is a resource of the payment cryptography service", () => {
    expect(isPaymentKey(key)).toBe(true);
  });

  it("is not an alias", () => {
    expect(isPaymentKey({...key, type: "alias"})).toBe(false);
  });
});
