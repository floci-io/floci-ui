import { describe, expect, it } from "vitest";
import { logsQueryKeys } from "./logs.queries";

describe("logsQueryKeys.groups", () => {
  it("produces different query keys for different prefixes", () => {
    const keyA = logsQueryKeys.groups("/aws/lambda/");
    const keyB = logsQueryKeys.groups("/aws/apigateway/");

    expect(keyA).not.toEqual(keyB);
  });

  it("produces a stable key distinct from the no-prefix key", () => {
    const withPrefix = logsQueryKeys.groups("/aws/lambda/");
    const noPrefix = logsQueryKeys.groups();

    expect(withPrefix).not.toEqual(noPrefix);
  });
});
