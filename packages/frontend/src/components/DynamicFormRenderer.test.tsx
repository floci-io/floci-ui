import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";

import {DynamicFormRenderer} from "@/components/DynamicFormRenderer";
import type {FieldSchema, ServiceSchema} from "@/types/schema";

const kind: FieldSchema = {
  name: "kind",
  label: "Kind",
  type: "select",
  required: true,
  defaultValue: "keys",
  options: [
    {label: "Key", value: "keys", submitLabel: "Create key"},
    {label: "Alias", value: "aliases", submitLabel: "Create alias"},
  ],
};

const schema: ServiceSchema = {
  cloud: "aws",
  service: "paymentcryptography",
  displayName: "Payment Cryptography",
  fields: [kind],
  actions: ["list", "create", "delete", "inspect"],
  filters: [],
  columns: [{name: "name", label: "Name"}],
};

describe("the create form's button", () => {
  it("says what the picked option makes", async () => {
    const user = userEvent.setup();
    render(
      <DynamicFormRenderer
        schema={schema}
        isSubmitting={false}
        submitLabel="Create resource"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", {name: "Create key"})).toBeDefined();

    await user.selectOptions(screen.getByRole("combobox"), "aliases");

    expect(screen.getByRole("button", {name: "Create alias"})).toBeDefined();
    expect(screen.queryByRole("button", {name: "Create key"})).toBeNull();
  });

  it("keeps the label it was given when no option names one", () => {
    render(
      <DynamicFormRenderer
        schema={{...schema, fields: [{...kind, options: [{label: "Key", value: "keys"}]}]}}
        isSubmitting={false}
        submitLabel="Create resource"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", {name: "Create resource"})).toBeDefined();
  });
});
