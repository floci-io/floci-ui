import { describe, expect, it } from "vitest";

import { capabilityAppliesToType, capabilityEnabled } from "./capabilities";
import type { CapabilitySchema } from "@/types/schema";

const updateTags: CapabilitySchema<"updateTags"> = {
  name: "updateTags",
  label: "Edit tags",
  enabled: true,
  status: "available",
};

describe("a capability that excludes kinds of resource", () => {
  it("applies to a kind it does not name", () => {
    const capability = {...updateTags, excludedTypes: ["alias"]};

    expect(capabilityAppliesToType(capability, "key")).toBe(true);
  });

  it("does not apply to a kind it names", () => {
    const capability = {...updateTags, excludedTypes: ["alias"]};

    expect(capabilityAppliesToType(capability, "alias")).toBe(false);
  });

  it("applies to every kind when it names none", () => {
    expect(capabilityAppliesToType(updateTags, "alias")).toBe(true);
  });

  it("applies to a kind it does not know", () => {
    // Only the named kinds are excluded, so a kind the schema has not heard of
    // still takes the action.
    const capability = {...updateTags, excludedTypes: ["alias"]};

    expect(capabilityAppliesToType(capability, "something-else")).toBe(true);
    expect(capabilityAppliesToType(capability, undefined)).toBe(true);
  });

  it("applies to nothing when there is no capability", () => {
    expect(capabilityAppliesToType(undefined, "key")).toBe(false);
  });

  it("stays disabled when the capability is", () => {
    const blocked = {...updateTags, enabled: false, status: "blocked" as const};

    expect(capabilityEnabled(blocked)).toBe(false);
    expect(capabilityAppliesToType(blocked, "key")).toBe(true);
  });
});
