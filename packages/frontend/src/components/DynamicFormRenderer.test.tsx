import {render, screen, waitFor} from "@testing-library/react";
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

  it("starts a required select on its first option", async () => {
    // A required select with no default is painted with its first option, but
    // the form value stays empty, so the submit is refused for a field that
    // shows a choice. The value follows the option the browser paints.
    const target: FieldSchema = {
      name: "aliasTargetKey",
      label: "Target Key",
      type: "select",
      required: true,
      options: [
        {label: "key-a", value: "key/key-a"},
        {label: "key-b", value: "key/key-b"},
      ],
    };
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <DynamicFormRenderer
        schema={{...schema, fields: [target]}}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    const select = screen.getByLabelText(/Target Key/) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("key/key-a"));

    await user.click(screen.getByRole("button", {name: "Create"}));

    expect(onSubmit).toHaveBeenCalledWith({aliasTargetKey: "key/key-a"});
  });

  it("takes the first option when the options arrive after the form opens", async () => {
    const empty: FieldSchema = {
      name: "aliasTargetKey",
      label: "Target Key",
      type: "select",
      required: true,
      options: [],
    };
    const loaded: FieldSchema = {
      ...empty,
      options: [{label: "key-a", value: "key/key-a"}],
    };
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    const {rerender} = render(
      <DynamicFormRenderer
        schema={{...schema, fields: [empty]}}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByLabelText(/Target Key/) as HTMLSelectElement).value).toBe("");

    rerender(
      <DynamicFormRenderer
        schema={{...schema, fields: [loaded]}}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText(/Target Key/) as HTMLSelectElement).value).toBe("key/key-a"),
    );

    await user.click(screen.getByRole("button", {name: "Create"}));

    expect(onSubmit).toHaveBeenCalledWith({aliasTargetKey: "key/key-a"});
  });

  it("drops a value the options no longer offer", async () => {
    // The create form is inline, so the table stays usable while it is open.
    // The key the form points at is deleted, the choices are asked again, and
    // the options no longer offer it: the value follows the options the form
    // has, not the one it had.
    const first: FieldSchema = {
      name: "aliasTargetKey",
      label: "Target Key",
      type: "select",
      required: true,
      options: [{label: "key-a", value: "key/key-a"}],
    };
    const second: FieldSchema = {
      ...first,
      options: [{label: "key-b", value: "key/key-b"}],
    };
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    const {rerender} = render(
      <DynamicFormRenderer
        schema={{...schema, fields: [first]}}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText(/Target Key/) as HTMLSelectElement).value).toBe("key/key-a"),
    );

    rerender(
      <DynamicFormRenderer
        schema={{...schema, fields: [second]}}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText(/Target Key/) as HTMLSelectElement).value).toBe("key/key-b"),
    );

    await user.click(screen.getByRole("button", {name: "Create"}));

    expect(onSubmit).toHaveBeenCalledWith({aliasTargetKey: "key/key-b"});
  });

  it("says so when the options of a field could not be loaded, and asks again", async () => {
    // An account with no keys and a request that failed leave the same empty
    // dropdown, so the failure is said so beside the field that needs the
    // choices, and the request can be made again.
    const target: FieldSchema = {
      name: "aliasTargetKey",
      label: "Target Key",
      type: "select",
      required: true,
      options: [],
      optionsFrom: "key",
    };
    const onRetryOptions = vi.fn();
    const user = userEvent.setup();

    render(
      <DynamicFormRenderer
        schema={{...schema, fields: [target]}}
        isSubmitting={false}
        optionsError="The options could not be loaded: the runtime is not answering"
        onRetryOptions={onRetryOptions}
        onSubmit={vi.fn()}
      />,
    );

    const failure = screen.getByRole("alert");
    expect(failure.textContent).toContain("The options could not be loaded: the runtime is not answering");

    await user.click(screen.getByRole("button", {name: "Retry"}));

    expect(onRetryOptions).toHaveBeenCalled();
  });

  it("says the failure beside the field that needs the options", () => {
    const target: FieldSchema = {
      name: "aliasTargetKey",
      label: "Target Key",
      type: "select",
      required: true,
      options: [],
      optionsFrom: "key",
    };
    const other: FieldSchema = {name: "aliasName", label: "Alias Name", type: "text", required: false};

    render(
      <DynamicFormRenderer
        schema={{...schema, fields: [other, target]}}
        isSubmitting={false}
        optionsError="The options could not be loaded"
        onRetryOptions={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    // The failure belongs to the field that names another resource, so it is
    // shown with that field and not with the one beside it.
    const targetField = screen.getByLabelText(/Target Key/);
    expect(targetField.closest("label")?.textContent).toContain("The options could not be loaded");
    expect(screen.getByLabelText(/Alias Name/).closest("label")?.textContent).not.toContain(
      "The options could not be loaded",
    );
  });

  it("takes the label from a field that is on the form", () => {
    // A field hidden by another answer keeps its value, so a hidden field must
    // not decide what the button says. The hidden field comes first here, so a
    // lookup that ignored the visibility would take its label.
    const hidden: FieldSchema = {
      name: "aliasName",
      label: "Alias Name",
      type: "text",
      required: false,
      visibleWhen: {field: "kind", equals: "aliases"},
      options: [{label: "Alias", value: "alias", submitLabel: "Create an alias"}],
    };

    render(
      <DynamicFormRenderer
        schema={{...schema, fields: [hidden, kind]}}
        initialValues={{aliasName: "alias"}}
        isSubmitting={false}
        submitLabel="Create resource"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", {name: "Create key"})).toBeDefined();
    expect(screen.queryByRole("button", {name: "Create an alias"})).toBeNull();
  });
});
