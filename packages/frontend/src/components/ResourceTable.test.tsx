import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ResourceTable } from "@/components/ResourceTable";
import type { CloudResource } from "@/types/resource";
import type { ServiceSchema } from "@/types/schema";

const schema: ServiceSchema = {
  cloud: "aws",
  service: "storage",
  displayName: "Buckets",
  fields: [],
  actions: ["list", "delete"],
  filters: [],
  columns: [
    { name: "name", label: "Name" },
    { name: "region", label: "Region" },
  ],
};

function resource(name: string): CloudResource {
  return {
    id: name,
    name,
    cloud: "aws",
    service: "storage",
    type: "bucket",
    region: "us-east-1",
    createdAt: null,
    metadata: {},
  };
}

const resources = [resource("ux-assets"), resource("ux-logs")];

describe("ResourceTable selection", () => {
  it("reaches the first resource name with Tab and selects it with Enter", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ResourceTable schema={schema} resources={resources} onSelect={onSelect} onDelete={vi.fn()} />);

    await user.tab();
    const name = screen.getByRole("button", { name: "ux-assets" });
    expect(name).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(resources[0]);
  });

  it("selects with Space too", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ResourceTable schema={schema} resources={resources} onSelect={onSelect} onDelete={vi.fn()} />);

    screen.getByRole("button", { name: "ux-logs" }).focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith(resources[1]);
  });

  it("still selects when another cell of the row is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ResourceTable schema={schema} resources={resources} onSelect={onSelect} onDelete={vi.fn()} />);

    await user.click(screen.getAllByText("us-east-1")[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(resources[1]);
  });

  it("marks the selected resource as current", () => {
    render(
      <ResourceTable schema={schema} resources={resources} selectedId="ux-logs" onSelect={vi.fn()} onDelete={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "ux-logs" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "ux-assets" })).not.toHaveAttribute("aria-current");
  });
});
