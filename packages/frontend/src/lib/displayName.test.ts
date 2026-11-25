import {describe, expect, it} from "vitest";

import {displayNameOf, namesOf} from "@/lib/displayName";
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

describe("the names a resource is known by", () => {
  it("are the ones the API published", () => {
    expect(namesOf({...key, metadata: {names: ["alias/card-cvk"]}})).toEqual(["alias/card-cvk"]);
  });

  it("are every one of them", () => {
    expect(namesOf({...key, metadata: {names: ["alias/a", "alias/b"]}})).toEqual([
      "alias/a",
      "alias/b",
    ]);
  });

  it("are none when the resource has none", () => {
    expect(namesOf(key)).toEqual([]);
    expect(namesOf(undefined)).toEqual([]);
  });

  it("are none when the API published something that is not a list", () => {
    expect(namesOf({...key, metadata: {names: "alias/card-cvk" as never}})).toEqual([]);
  });

  it("are none when the name is inherited from the prototype", () => {
    // A name inherited from the prototype is not a state the API published.
    const metadata = Object.create({names: ["alias/inherited"]});
    expect(namesOf({...key, metadata})).toEqual([]);
  });
});

describe("the name a resource is known by", () => {
  it("is the name it was given", () => {
    expect(displayNameOf({...key, metadata: {names: ["alias/card-cvk"]}})).toBe("alias/card-cvk");
  });

  it("is every name it was given", () => {
    expect(displayNameOf({...key, metadata: {names: ["alias/a", "alias/b"]}})).toBe("alias/a, alias/b");
  });

  it("is its own name when it was given none", () => {
    expect(displayNameOf(key)).toBe(key.name);
  });

  it("is its own id when it has no name either", () => {
    expect(displayNameOf({...key, name: ""})).toBe(key.id);
  });
});
