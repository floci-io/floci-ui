import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {powerComputeResource} from "@/api/cloudProxyClient";
import {ComputePowerPanel} from "@/components/ComputePowerPanel";
import type {CloudResource} from "@/types/resource";
import type {CapabilitySchema, ResourceActionName} from "@/types/schema";

vi.mock("@/api/cloudProxyClient", () => ({
  powerComputeResource: vi.fn(),
}));

const instance = (status: string): CloudResource => ({
  id: "us-central1-a/vm1",
  name: "vm1",
  cloud: "gcp",
  service: "compute",
  type: "instance",
  region: "us-central1-a",
  createdAt: null,
  status,
  metadata: {},
});

const available = (name: ResourceActionName, label: string): CapabilitySchema<ResourceActionName> => ({
  name,
  label,
  enabled: true,
  status: "available",
});

const capabilities = [available("start", "Start"), available("stop", "Stop"), available("reboot", "Reset")];

describe("ComputePowerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(powerComputeResource).mockResolvedValue(instance("TERMINATED"));
  });

  it("offers stop and reset on a running instance, and refreshes after stopping it", async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ComputePowerPanel resource={instance("RUNNING")} capabilities={capabilities} onChanged={onChanged}/>);

    expect(screen.getByRole("button", {name: "Start"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Reset"})).toBeEnabled();
    await user.click(screen.getByRole("button", {name: "Stop"}));

    expect(powerComputeResource).toHaveBeenCalledWith("gcp", "us-central1-a/vm1", "stop");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("offers only start on a stopped instance", () => {
    render(<ComputePowerPanel resource={instance("TERMINATED")} capabilities={capabilities} onChanged={vi.fn()}/>);

    expect(screen.getByRole("button", {name: "Start"})).toBeEnabled();
    expect(screen.getByRole("button", {name: "Stop"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "Reset"})).toBeDisabled();
  });

  it("keeps every verb enabled while the power state is unknown", () => {
    render(<ComputePowerPanel resource={{...instance("RUNNING"), status: null}} capabilities={capabilities} onChanged={vi.fn()}/>);

    expect(screen.getByRole("button", {name: "Start"})).toBeEnabled();
    expect(screen.getByRole("button", {name: "Stop"})).toBeEnabled();
    expect(screen.getByRole("button", {name: "Reset"})).toBeEnabled();
  });

  it("keeps a capability that is not available disabled, with its reason", () => {
    const unavailable = {...available("start", "Start"), enabled: false, status: "blocked" as const, reason: "Runtime is down"};
    render(<ComputePowerPanel resource={instance("TERMINATED")} capabilities={[unavailable]} onChanged={vi.fn()}/>);

    const start = screen.getByRole("button", {name: "Start"});
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute("title", "Runtime is down");
  });

  it("shows the error when the runtime refuses", async () => {
    vi.mocked(powerComputeResource).mockRejectedValue(new Error("Instance was not found"));
    const user = userEvent.setup();
    render(<ComputePowerPanel resource={instance("RUNNING")} capabilities={capabilities} onChanged={vi.fn()}/>);

    await user.click(screen.getByRole("button", {name: "Stop"}));

    expect(await screen.findByText("Instance was not found")).toBeInTheDocument();
  });

  it("ignores a request that settles after switching to another instance", async () => {
    let reject: (reason: Error) => void = () => {};
    vi.mocked(powerComputeResource).mockReturnValue(new Promise((_, no) => { reject = no; }));
    const user = userEvent.setup();
    const other = {...instance("RUNNING"), id: "us-central1-a/vm2", name: "vm2"};
    const {rerender} = render(<ComputePowerPanel resource={instance("RUNNING")} capabilities={capabilities} onChanged={vi.fn()}/>);

    await user.click(screen.getByRole("button", {name: "Stop"}));
    rerender(<ComputePowerPanel resource={other} capabilities={capabilities} onChanged={vi.fn()}/>);
    reject(new Error("vm1 failed"));

    await waitFor(() => expect(powerComputeResource).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("vm1 failed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Stop"})).toBeEnabled();
  });

  it("renders nothing for a disk or when no power verb is advertised", () => {
    const {container, rerender} = render(
      <ComputePowerPanel resource={{...instance("READY"), type: "disk"}} capabilities={capabilities} onChanged={vi.fn()}/>,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<ComputePowerPanel resource={instance("RUNNING")} capabilities={[]} onChanged={vi.fn()}/>);
    expect(container).toBeEmptyDOMElement();
  });
});
