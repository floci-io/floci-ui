import { describe, expect, it, vi, beforeEach } from "vitest";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));

vi.mock("@/api/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/api")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      call: callMock,
    },
  };
});

import { apiEndpointKeys } from "@/api/api";
import { listLogGroups } from "./logs.api";

describe("listLogGroups", () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it("calls apiClient.call with the real aws.logs.groups.list endpoint key and returns res.data", async () => {
    const groups = [{ name: "/aws/lambda/foo" }];
    callMock.mockResolvedValue({ data: groups });

    const result = await listLogGroups();

    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock.mock.calls[0][0]).toBe(apiEndpointKeys.aws.logs.groups.list);
    expect(result).toEqual(groups);
  });

  it("forwards a given prefix as params: { prefix }", async () => {
    callMock.mockResolvedValue({ data: [] });

    await listLogGroups("/aws/lambda/");

    const options = callMock.mock.calls[0][1];
    expect(options.params).toEqual({ prefix: "/aws/lambda/" });
  });

  it("does not send a blank prefix param when no prefix is given", async () => {
    callMock.mockResolvedValue({ data: [] });

    await listLogGroups();

    const options = callMock.mock.calls[0][1];
    const prefixValue = options.params?.prefix;
    expect(prefixValue === undefined || options.params === undefined).toBe(true);
  });

  it("forwards the abort signal", async () => {
    callMock.mockResolvedValue({ data: [] });
    const controller = new AbortController();

    await listLogGroups(undefined, controller.signal);

    const options = callMock.mock.calls[0][1];
    expect(options.signal).toBe(controller.signal);
  });

  it("round-trips a group with only name present, without inventing storedBytes", async () => {
    const groups = [{ name: "/aws/lambda/bare" }];
    callMock.mockResolvedValue({ data: groups });

    const result = await listLogGroups();

    expect(result[0]).not.toHaveProperty("storedBytes");
    expect(result[0]).not.toHaveProperty("metricFilterCount");
    expect(result[0]).toEqual({ name: "/aws/lambda/bare" });
  });
});
