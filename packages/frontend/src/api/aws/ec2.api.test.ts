import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEc2SecurityGroup } from "./ec2.api";

describe("createEc2SecurityGroup", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ groupId: "sg-created" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it.each(["vpc-selected", undefined])(
    "sends one JSON object through HttpClient with VPC %s",
    async (vpcId) => {
      const name = "web-servers";
      const description = 'Allow HTTP for "public" clients';

      await expect(createEc2SecurityGroup(name, description, vpcId)).resolves.toEqual({
        groupId: "sg-created",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/api/ec2/security-groups");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        name,
        description,
        ...(vpcId === undefined ? {} : { vpcId }),
      });
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    },
  );
});
