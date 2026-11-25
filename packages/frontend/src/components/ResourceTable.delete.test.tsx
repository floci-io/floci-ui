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
  columns: [{ name: "name", label: "Name" }],
};

const bucket: CloudResource = {
  id: "ux-assets",
  name: "ux-assets",
  cloud: "aws",
  service: "storage",
  type: "bucket",
  region: "us-east-1",
  createdAt: null,
  metadata: {},
};

describe("ResourceTable delete confirmation", () => {
  it("names the resource and keeps Cancel neutral", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<ResourceTable schema={schema} resources={[bucket]} onSelect={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Delete ux-assets" }));

    expect(screen.getByText("Delete ux-assets?")).toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).not.toHaveClass("success");
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass("danger");
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(cancel);
    expect(screen.queryByText("Delete ux-assets?")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("deletes once confirmed", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<ResourceTable schema={schema} resources={[bucket]} onSelect={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Delete ux-assets" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onDelete).toHaveBeenCalledWith(bucket);
  });

  it("falls back to the id when the resource has no name", async () => {
    const user = userEvent.setup();
    render(
      <ResourceTable
        schema={schema}
        resources={[{ ...bucket, name: "" }]}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Delete/ }));
    expect(screen.getByText("Delete ux-assets?")).toBeInTheDocument();
  });
});
