import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {afterEach, describe, expect, test, vi} from "vitest";
import {listCollectionItems} from "@/api/cloudProxyClient";
import {OciGovernancePanel} from "@/components/OciGovernancePanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {ChildItem, CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  listCollectionItems: vi.fn(),
}));

const RULE = "ocid1.governancerule.oc1..regions";
const rule: CloudResource = {
  id: RULE, name: "only-ashburn", cloud: "oci", service: "governance", type: "ALLOWED_REGIONS",
  region: null, createdAt: null, metadata: {},
};

function item(collectionId: string, id: string, body: Record<string, unknown>): ChildItem {
  return {id, collectionId, timestamp: null, body, metadata: {}};
}

function renderPanel(resource: CloudResource | undefined) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <OciGovernancePanel resource={resource} runtimeReachable={true}/>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("OciGovernancePanel", () => {
  test("renders nothing for another cloud or service, or without a selection", () => {
    expect(renderPanel({...rule, cloud: "aws"}).container).toBeEmptyDOMElement();
    expect(renderPanel({...rule, service: "organizations"}).container).toBeEmptyDOMElement();
    expect(renderPanel(undefined).container).toBeEmptyDOMElement();
    expect(vi.mocked(listCollectionItems)).not.toHaveBeenCalled();
  });

  test("shows an empty state for each collection when the rule has none", async () => {
    vi.mocked(listCollectionItems).mockResolvedValue({items: [], nextCursor: null});
    renderPanel(rule);

    expect(await screen.findByText("No inclusion criteria")).toBeInTheDocument();
    expect(await screen.findByText("No tenancy attachments")).toBeInTheDocument();
    expect(vi.mocked(listCollectionItems)).toHaveBeenCalledWith("oci", "governance", RULE, "inclusionCriteria", undefined, expect.anything());
    expect(vi.mocked(listCollectionItems)).toHaveBeenCalledWith("oci", "governance", RULE, "tenancyAttachments", undefined, expect.anything());
  });

  test("lists the inclusion criteria and the attachments of a rule", async () => {
    vi.mocked(listCollectionItems).mockImplementation(async (_cloud, _service, _id, collection) => ({
      items: collection === "inclusionCriteria"
        ? [
          item(collection, "c1", {type: "ALL", lifecycleState: "ACTIVE", timeCreated: "2026-11-20T22:32:57Z"}),
          item(collection, "c2", {type: "TENANCY", tenancyId: "ocid1.tenancy.oc1..child", lifecycleState: "ACTIVE"}),
        ]
        : [item(collection, "a1", {tenancyId: "ocid1.tenancy.oc1..child", lifecycleState: "ACTIVE"})],
      nextCursor: null,
    }));
    renderPanel(rule);

    expect(await screen.findByText("All child tenancies")).toBeInTheDocument();
    expect(screen.getAllByText("ocid1.tenancy.oc1..child")).toHaveLength(2);
    expect(screen.getByText("Tenancy attachments")).toBeInTheDocument();
  });

  test("does not claim a QUOTA or TAG rule is enforced", async () => {
    vi.mocked(listCollectionItems).mockResolvedValue({items: [], nextCursor: null});
    renderPanel({...rule, type: "QUOTA"});

    expect(await screen.findByText(/stores QUOTA rules but does not enforce them/)).toBeInTheDocument();
  });

  test("loads the next page of a collection", async () => {
    vi.mocked(listCollectionItems).mockImplementation(async (_cloud, _service, _id, collection, cursor) => {
      if (collection !== "inclusionCriteria") return {items: [], nextCursor: null};
      return cursor
        ? {items: [item(collection, "c2", {type: "TENANCY", tenancyId: "ocid1.tenancy.oc1..two"})], nextCursor: null}
        : {items: [item(collection, "c1", {type: "TENANCY", tenancyId: "ocid1.tenancy.oc1..one"})], nextCursor: "1"};
    });
    renderPanel(rule);

    await userEvent.click(await screen.findByText("Load more"));
    expect(await screen.findByText("ocid1.tenancy.oc1..two")).toBeInTheDocument();
    expect(screen.getByText("ocid1.tenancy.oc1..one")).toBeInTheDocument();
    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
  });

  test("shows the error when a collection cannot be read", async () => {
    vi.mocked(listCollectionItems).mockRejectedValue(new Error("Cannot reach Floci-OCI"));
    renderPanel(rule);

    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Cannot reach Floci-OCI");
  });
});
