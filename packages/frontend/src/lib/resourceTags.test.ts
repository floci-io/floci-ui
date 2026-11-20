import { describe, expect, it } from "vitest";
import { changesBetween, resourceTags } from "./resourceTags";

describe("resource tags", () => {
  it("reads the tags a resource carries in its metadata", () => {
    expect(resourceTags({ tags: [{ key: "env", value: "prod" }] })).toEqual([
      { key: "env", value: "prod" },
    ]);
  });

  it("leaves out a tag that is not a pair of strings", () => {
    expect(
      resourceTags({
        tags: [{ key: "env", value: "prod" }, { key: "owner" }, "env=prod", null],
      }),
    ).toEqual([{ key: "env", value: "prod" }]);
    expect(resourceTags({})).toEqual([]);
    expect(resourceTags({ tags: "env=prod" })).toEqual([]);
  });

  it("changes only the tags that differ", () => {
    const before = [
      { key: "env", value: "prod" },
      { key: "owner", value: "payments" },
    ];
    const after = [
      { key: "env", value: "staging" },
      { key: "owner", value: "payments" },
    ];

    expect(changesBetween(before, after)).toEqual({ env: "staging" });
  });

  it("removes a tag that is gone and sets one that is new", () => {
    const before = [{ key: "env", value: "prod" }];
    const after = [{ key: "team", value: "payments" }];

    expect(changesBetween(before, after)).toEqual({ team: "payments", env: null });
  });

  it("leaves a tag that was not touched alone", () => {
    const before = [{ key: "env", value: "prod" }];

    expect(changesBetween(before, before)).toEqual({});
  });

  it("ignores a row whose key is not filled in", () => {
    const before = [{ key: "env", value: "prod" }];
    const after = [
      { key: "env", value: "prod" },
      { key: "", value: "" },
    ];

    expect(changesBetween(before, after)).toEqual({});
  });
});
