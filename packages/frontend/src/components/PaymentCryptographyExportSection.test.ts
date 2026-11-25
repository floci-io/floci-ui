import {describe, expect, it} from "vitest";

import {allowedAlgorithms, pairingsPublished, wrappingKeysFor} from "@/lib/paymentCryptographyWrapping";
import type {CloudResource} from "@/types/resource";
import type {ServiceSchema} from "@/types/schema";

/** The matrix the service publishes, as the schema serves it. */
const schema: ServiceSchema = {
  cloud: "aws",
  service: "paymentcryptography",
  displayName: "Payment Cryptography",
  fields: [],
  actions: ["list", "create", "delete", "inspect"],
  filters: [],
  columns: [{name: "name", label: "Name"}],
  pairings: [
    {
      discriminator: "keyAlgorithm",
      allowed: {
        TDES_2KEY: ["TDES_2KEY", "TDES_3KEY", "AES_128", "AES_192", "AES_256"],
        TDES_3KEY: ["TDES_3KEY", "AES_128", "AES_192", "AES_256"],
        AES_128: ["AES_128", "AES_192", "AES_256"],
        AES_192: ["AES_192", "AES_256"],
        AES_256: ["AES_256"],
      },
    },
  ],
};

/**
 * A key of the account.
 *
 * <p>Whether the key may wrap another one is the state the service published
 * with it, so it is named here rather than worked out from the usage and the
 * modes of use.
 */
const key = (
  id: string,
  algorithm: string,
  usage = "TR31_K0_KEY_ENCRYPTION_KEY",
  modes: Record<string, boolean> = {Wrap: true, Unwrap: true},
  enabled = true,
  mayWrap = true,
): CloudResource => ({
  id,
  name: id,
  cloud: "aws",
  service: "paymentcryptography",
  type: "key",
  region: "us-east-1",
  createdAt: null,
  status: "CREATE_COMPLETE",
  metadata: {keyAlgorithm: algorithm, keyUsage: usage, keyModesOfUse: modes, enabled, mayWrap},
});

const carried = (algorithm: string): CloudResource =>
  key(`carried-${algorithm}`, algorithm, "TR31_P1_PIN_GENERATION_KEY", {Generate: true}, true);

describe("the wrapping keys a key may leave under", () => {
  it("offers only the keys the service's matrix allows", () => {
    const rows = [
      key("kek-tdes2", "TDES_2KEY"),
      key("kek-tdes3", "TDES_3KEY"),
      key("kek-aes128", "AES_128"),
      key("kek-aes192", "AES_192"),
      key("kek-aes256", "AES_256"),
    ];

    expect(wrappingKeysFor(carried("AES_256"), rows, schema).map((r) => r.id)).toEqual(["kek-aes256"]);
    expect(wrappingKeysFor(carried("AES_192"), rows, schema).map((r) => r.id)).toEqual([
      "kek-aes192",
      "kek-aes256",
    ]);
    expect(wrappingKeysFor(carried("TDES_2KEY"), rows, schema).map((r) => r.id)).toEqual([
      "kek-tdes2",
      "kek-tdes3",
      "kek-aes128",
      "kek-aes192",
      "kek-aes256",
    ]);
  });

  it("offers no key that is too weak to carry the one", () => {
    const rows = [key("kek-tdes2", "TDES_2KEY"), key("kek-aes128", "AES_128")];

    // A three-key Triple DES key may not leave under a two-key one.
    expect(wrappingKeysFor(carried("TDES_3KEY"), rows, schema).map((r) => r.id)).toEqual(["kek-aes128"]);
  });

  it("offers only the keys the service says may wrap", () => {
    const rows = [
      // The service says this one does not wrap, whatever its usage and its
      // modes of use say.
      key("not-a-wrapping-key", "AES_256", "TR31_K0_KEY_ENCRYPTION_KEY", {Wrap: true}, true, false),
      key("good", "AES_256"),
    ];

    expect(wrappingKeysFor(carried("AES_256"), rows, schema).map((r) => r.id)).toEqual(["good"]);
  });

  it("reads the state the service published rather than the modes of use", () => {
    const rows = [
      // A key whose modes of use are NoRestrictions: the reference's own table
      // of valid attributes allows it, so the service says it may wrap.
      key("unrestricted", "AES_256", "TR31_K0_KEY_ENCRYPTION_KEY", {NoRestrictions: true}),
      // A key that may wrap, which the service says does not.
      key("does-not-wrap", "AES_256", "TR31_K0_KEY_ENCRYPTION_KEY", {Wrap: true}, true, false),
    ];

    expect(wrappingKeysFor(carried("AES_256"), rows, schema).map((r) => r.id)).toEqual([
      "unrestricted",
    ]);
  });

  it("offers nothing when the account holds no key that may carry the one", () => {
    expect(wrappingKeysFor(carried("AES_256"), [], schema)).toEqual([]);
    expect(wrappingKeysFor(carried("AES_256"), [key("weak", "TDES_2KEY")], schema)).toEqual([]);
  });

  it("offers no key for a key the matrix does not name", () => {
    const rows = [key("kek-aes256", "AES_256")];

    // The matrix names the symmetric keys, which are the ones that leave under
    // a TR-31 block. A key it does not name leaves under no key at all, so the
    // console may not offer the account's keys for it.
    expect(wrappingKeysFor(carried("RSA_2048"), rows, schema)).toEqual([]);
    expect(wrappingKeysFor(carried("ECC_NIST_P256"), rows, schema)).toEqual([]);
  });

  it("offers no key when the service publishes no matrix", () => {
    const rows = [key("kek-aes256", "AES_256")];

    // A service that publishes no matrix says nothing about what may carry
    // what, and the adapter refuses a weaker key either way, so the console
    // offers nothing rather than a key the service will refuse.
    expect(wrappingKeysFor(carried("AES_256"), rows, undefined)).toEqual([]);
    expect(pairingsPublished(schema)).toBe(true);
    expect(pairingsPublished(undefined)).toBe(false);
  });

  it("reads the matrix the schema publishes", () => {
    expect(allowedAlgorithms(schema, "AES_128")).toEqual(["AES_128", "AES_192", "AES_256"]);
    expect(allowedAlgorithms(schema, "AES_256")).toEqual(["AES_256"]);
    // A matrix that does not name an algorithm says that no key of that
    // algorithm may be carried, which is not the same as a matrix that is not
    // there.
    expect(allowedAlgorithms(schema, "RSA_2048")).toEqual([]);
    expect(allowedAlgorithms(undefined, "AES_256")).toBeUndefined();
  });

  it("does not read the matrix through the prototype chain", () => {
    // The algorithm comes from the service, so a name the prototype chain
    // answers for is not a row of the matrix.
    for (const name of ["__proto__", "constructor", "toString"]) {
      expect(allowedAlgorithms(schema, name)).toEqual([]);
      expect(wrappingKeysFor(carried(name), [key("kek-aes256", "AES_256")], schema)).toEqual([]);
    }
  });

  it("reads a malformed matrix as an empty one", () => {
    // The schema arrives over the network and is not checked before it is read,
    // so a malformed one leaves the list empty rather than crashing.
    const malformed = {
      ...schema,
      pairings: [{discriminator: "keyAlgorithm", allowed: undefined}],
    } as unknown as ServiceSchema;

    expect(allowedAlgorithms(malformed, "AES_256")).toEqual([]);
    expect(wrappingKeysFor(carried("AES_256"), [key("kek-aes256", "AES_256")], malformed)).toEqual([]);
  });
});
