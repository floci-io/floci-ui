import { formatBytes, slugify } from "@/lib/format";

describe("@ alias resolution", () => {
  it("resolves @/lib/format and calls its exports", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(slugify("Hello, World!")).toBe("hello-world");
  });
});
