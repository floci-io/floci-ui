import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEc2SecurityGroup,
  createEc2Subnet,
  createEc2Vpc,
  createVpcWizard,
  type VpcWizardInput,
} from "./ec2.api";

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

describe("EC2 networking create requests", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), {
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

  const wizardInput: VpcWizardInput = {
    name: "lab",
    cidrBlock: "10.0.0.0/16",
    subnetGroups: [{ name: "public", count: 2, isPublic: true }],
    natGateway: false,
  };

  it.each([
    {
      label: "VPC",
      send: () => createEc2Vpc("10.0.0.0/16"),
      path: "/api/ec2/vpcs",
      body: { cidrBlock: "10.0.0.0/16" },
    },
    {
      label: "subnet with availability zone",
      send: () => createEc2Subnet("vpc-1", "10.0.1.0/24", "us-east-1a"),
      path: "/api/ec2/subnets",
      body: { vpcId: "vpc-1", cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" },
    },
    {
      label: "subnet without availability zone",
      send: () => createEc2Subnet("vpc-1", "10.0.1.0/24"),
      path: "/api/ec2/subnets",
      body: { vpcId: "vpc-1", cidrBlock: "10.0.1.0/24" },
    },
    {
      label: "VPC wizard",
      send: () => createVpcWizard(wizardInput),
      path: "/api/ec2/vpc-wizard",
      body: wizardInput,
    },
  ])("sends the $label body as one JSON object", async ({ send, path, body }) => {
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(path);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });
});
