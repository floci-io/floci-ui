import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, test, vi} from "vitest";
import {recoverIdentityResource} from "@/api/cloudProxyClient";
import {OciIdentityPanel} from "@/components/OciIdentityPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  recoverIdentityResource: vi.fn(),
}));

const deleted: CloudResource = {
  id: "ocid1.compartment.oc1..a",
  name: "dev.qR5hP2BD",
  cloud: "oci",
  service: "identity",
  type: "compartment",
  region: null,
  createdAt: null,
  status: "DELETED",
  metadata: {},
};

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("OciIdentityPanel", () => {
  test("recovers a deleted compartment and reports it", async () => {
    vi.mocked(recoverIdentityResource).mockResolvedValue({...deleted, status: "ACTIVE"});
    const onRecovered = vi.fn();
    render(<OciIdentityPanel resource={deleted} runtimeReachable onRecovered={onRecovered}/>);

    await userEvent.setup().click(screen.getByRole("button", {name: /recover/i}));

    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
    expect(recoverIdentityResource).toHaveBeenCalledWith("oci", deleted.id, expect.any(AbortSignal));
  });

  test("shows the runtime refusal and does not report a change", async () => {
    vi.mocked(recoverIdentityResource).mockRejectedValue(new Error("Compartment dev is still being deleted."));
    const onRecovered = vi.fn();
    render(<OciIdentityPanel resource={deleted} runtimeReachable onRecovered={onRecovered}/>);

    await userEvent.setup().click(screen.getByRole("button", {name: /recover/i}));

    expect(await screen.findByText("Compartment dev is still being deleted.")).toBeVisible();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  test("disables Recover while the runtime is unreachable", () => {
    render(<OciIdentityPanel resource={deleted} runtimeReachable={false} onRecovered={vi.fn()}/>);
    expect(screen.getByRole("button", {name: /recover/i})).toBeDisabled();
  });

  test.each([
    ["an active compartment", {...deleted, status: "ACTIVE"}],
    ["a user", {...deleted, type: "user", status: "ACTIVE"}],
    ["a region subscription", {...deleted, type: "region subscription", status: "READY"}],
  ])("offers nothing for %s", (_label, resource) => {
    const {container} = render(<OciIdentityPanel resource={resource} runtimeReachable onRecovered={vi.fn()}/>);
    expect(container).toBeEmptyDOMElement();
  });
});
