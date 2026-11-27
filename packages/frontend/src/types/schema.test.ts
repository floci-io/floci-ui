import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

import type {PairingRule} from "./schema";

/** The source of the file the contract is published in. */
function schemaSource(): string {
  return readFileSync(resolve(process.cwd(), "src/types/schema.ts"), "utf8");
}

/**
 * The pairing rule the console reads.
 *
 * <p>The contract is a wire contract, so the checks here are the ones the
 * compiler makes: a rule the console cannot read is a mistake at the place it
 * is published, and a matrix that a consumer could change in process is a
 * handle rather than a value.
 */
describe("the pairing rule the console reads", () => {
  it("publishes the matrix as a value and not as a handle", () => {
    const rule: PairingRule = {
      discriminator: "keyAlgorithm",
      allowed: {AES_256: ["AES_256"]},
    };
    // The change is never made: the compiler is what refuses it.
    const change = () => {
      // @ts-expect-error the published matrix is read-only
      rule.allowed["AES_256"].push("TDES_2KEY");
    };

    expect(change).toBeInstanceOf(Function);
    expect(rule.allowed["AES_256"]).toEqual(["AES_256"]);
  });

  it("publishes the only discriminator the console reads", () => {
    // @ts-expect-error a rule under another discriminator is not read
    const other: PairingRule = {discriminator: "keyClass", allowed: {}};

    expect(other).toBeDefined();
  });

  it("matches the formatting of the file it is in", () => {
    const source = schemaSource();

    // The interfaces of this file are indented with four spaces and carry no
    // semicolons on their members.
    expect(source).toMatch(/^ {4}discriminator: PairingDiscriminator$/m);
    expect(source).not.toMatch(/^ {2}discriminator: /m);
  });

  it("says that one rule per discriminator is published", () => {
    const doc = schemaSource()
      .replace(/\*/g, " ")
      .replace(/\s+/g, " ");

    expect(doc).toContain("At most one rule per discriminator");
  });
});
