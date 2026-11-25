import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {updateCloudResourceTags} from "@/api/cloudProxyClient";
import {ResourceTagsEditor} from "@/components/ResourceTagsEditor";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  updateCloudResourceTags: vi.fn(),
}));

const updateTags = vi.mocked(updateCloudResourceTags);

const resource: CloudResource = {
  id: "bucket-1",
  name: "bucket-1",
  cloud: "aws",
  service: "storage",
  type: "bucket",
  region: "us-east-1",
  createdAt: null,
  status: "available",
  metadata: {},
};

function renderEditor(tags: Array<{key: string; value: string}>) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const invalidated: unknown[][] = [];
  client.invalidateQueries = vi.fn(async (filters: unknown) => {
    invalidated.push([filters]);
    return {status: "success", statusText: "", data: undefined, error: null} as never;
  }) as typeof client.invalidateQueries;

  render(
    <QueryClientProvider client={client}>
      <ResourceTagsEditor
        resource={resource}
        cloud="aws"
        tags={tags}
        runtimeReachable={true}
      />
    </QueryClientProvider>,
  );
  return {invalidated};
}

describe("the tags editor", () => {
  beforeEach(() => {
    updateTags.mockReset();
    updateTags.mockResolvedValue(undefined as never);
    setAccountId(DEFAULT_ACCOUNT_ID);
  });

  it("sends the changes between the tags and the draft", async () => {
    const user = userEvent.setup();
    renderEditor([{key: "env", value: "prod"}]);

    await user.click(screen.getByRole("button", {name: /Edit tags/i}));
    const value = screen.getByLabelText("Tag value");
    await user.clear(value);
    await user.type(value, "staging");
    await user.click(screen.getByRole("button", {name: /^Save$/}));

    await waitFor(() => expect(updateTags).toHaveBeenCalledTimes(1));
    expect(updateTags.mock.calls[0][3]).toEqual({env: "staging"});
  });

  it("does not remove a tag that arrived while the form was open", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    const {rerender} = render(
      <QueryClientProvider client={client}>
        <ResourceTagsEditor resource={resource} cloud="aws" tags={[{key: "env", value: "prod"}]} runtimeReachable={true} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", {name: /Edit tags/i}));

    // The resource's own details arrive and carry a tag the list did not have.
    rerender(
      <QueryClientProvider client={client}>
        <ResourceTagsEditor
          resource={resource}
          cloud="aws"
          tags={[{key: "env", value: "prod"}, {key: "owner", value: "payments"}]}
          runtimeReachable={true}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", {name: /^Save$/}));

    await waitFor(() => expect(updateTags).toHaveBeenCalledTimes(1));
    // The tag the form never had is not sent as a removal.
    expect(updateTags.mock.calls[0][3]).toEqual({});
  });

  it("refuses to save two rows that name the same tag", async () => {
    const user = userEvent.setup();
    renderEditor([{key: "env", value: "prod"}]);

    await user.click(screen.getByRole("button", {name: /Edit tags/i}));
    await user.click(screen.getByRole("button", {name: /Add tag/i}));
    const keys = screen.getAllByLabelText("Tag key");
    await user.clear(keys[1]);
    await user.type(keys[1], "env");

    expect(screen.getByText(/is named twice/)).toBeDefined();
    expect(screen.getByRole("button", {name: /^Save$/}).hasAttribute("disabled")).toBe(true);
    expect(updateTags).not.toHaveBeenCalled();
  });

  it("refreshes the resource and the list of the account it saved in", async () => {
    const user = userEvent.setup();
    const {invalidated} = renderEditor([{key: "env", value: "prod"}]);

    await user.click(screen.getByRole("button", {name: /Edit tags/i}));
    await user.click(screen.getByRole("button", {name: /^Save$/}));

    await waitFor(() => expect(invalidated.length).toBe(2));
    const keys = invalidated.map(([filters]) => (filters as {queryKey: unknown[]}).queryKey);
    expect(keys).toContainEqual(["cloud-resource", DEFAULT_ACCOUNT_ID, null, "aws", "storage", "bucket-1"]);
    expect(keys).toContainEqual(["cloud-resources", DEFAULT_ACCOUNT_ID, null, "aws", "storage"]);
  });
});
