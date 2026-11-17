import { describe, expect, it } from "vitest";
import type { FieldSchema } from "../types/schema";
import { activeListFilters, filterDefault, filterOptions, listFiltersOf } from "./listFilters";

const field = (over: Partial<FieldSchema>): FieldSchema => ({
  name: "f",
  label: "F",
  type: "text",
  required: false,
  ...over,
});

describe("list filters", () => {
  it("keeps select and text filters and drops search and unpaintable types", () => {
    const filters = [
      field({ name: "search" }),
      field({ name: "kind", type: "select" }),
      field({ name: "runtime" }),
      field({ name: "notes", type: "textarea" }),
      field({ name: "secret", type: "password" }),
    ];
    expect(listFiltersOf(filters).map((f) => f.name)).toEqual(["kind", "runtime"]);
    expect(listFiltersOf(undefined)).toEqual([]);
  });

  it("starts unfiltered unless the schema names a default", () => {
    expect(filterDefault(field({ type: "select", defaultValue: "active" }))).toBe("active");
    expect(filterDefault(field({ type: "select", options: [{ label: "A", value: "x" }] }))).toBe("");
    expect(filterDefault(field({}))).toBe("");
  });

  it("adds an All option only to a select that is unfiltered by default and lacks one", () => {
    const users = [{ label: "users", value: "users" }];
    expect(filterOptions(field({ type: "select", options: users }))).toEqual([{ label: "All", value: "" }, ...users]);
    expect(filterOptions(field({ type: "select", defaultValue: "active", options: users }))).toEqual(users);
    const withAll = [{ label: "Everything", value: "" }, ...users];
    expect(filterOptions(field({ type: "select", options: withAll }))).toEqual(withAll);
  });

  it("sends only filters that have a value", () => {
    const kind = field({ name: "kind", type: "select", options: [{ label: "All", value: "" }] });
    const runtime = field({ name: "runtime" });
    expect(activeListFilters([kind, runtime], {})).toBeUndefined();
    expect(activeListFilters([kind, runtime], { runtime: "  python " })).toEqual({ runtime: "python" });
  });
});
