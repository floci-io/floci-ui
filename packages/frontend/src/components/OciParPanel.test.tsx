import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {afterEach, describe, expect, test, vi} from "vitest";
import {deleteFlatItem, listFlatItems, putFlatItem} from "@/api/cloudProxyClient";
import {OciParPanel} from "@/components/OciParPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {ChildItem, CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  deleteFlatItem: vi.fn(),
  listFlatItems: vi.fn(),
  putFlatItem: vi.fn(),
}));

const bucket: CloudResource = {
  id: "app", name: "app", cloud: "oci", service: "storage", type: "bucket",
  region: "us-ashburn-1", createdAt: null, metadata: {},
};

const par: ChildItem = {
  id: "abc:p1", collectionId: null, timestamp: "2026-11-06T00:00:00Z",
  body: {name: "p1", accessType: "AnyObjectRead", timeExpires: "2030-01-01T00:00:00Z"}, metadata: {},
};

function renderPanel(resource: CloudResource | undefined = bucket) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <OciParPanel resource={resource} runtimeReachable={true}/>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("OciParPanel", () => {
  test("renders nothing for another cloud or service", () => {
    const {container} = renderPanel({...bucket, cloud: "aws"});
    expect(container).toBeEmptyDOMElement();
    expect(vi.mocked(listFlatItems)).not.toHaveBeenCalled();
  });

  test("shows an empty state when the bucket has no requests", async () => {
    vi.mocked(listFlatItems).mockResolvedValue({items: [], nextCursor: null});
    renderPanel();
    expect(await screen.findByText("No pre-authenticated requests")).toBeInTheDocument();
    expect(vi.mocked(listFlatItems)).toHaveBeenCalledWith("oci", "storage", "app", undefined, expect.anything());
  });

  test("creates a request and shows its access URI once", async () => {
    const user = userEvent.setup();
    vi.mocked(listFlatItems).mockResolvedValue({items: [], nextCursor: null});
    vi.mocked(putFlatItem).mockResolvedValue({
      ...par, body: {...par.body, accessUri: "/p/tok/n/ns/b/app/o/"},
    });
    renderPanel();
    await screen.findByText("No pre-authenticated requests");

    await user.type(screen.getByLabelText("Name"), "p1");
    await user.click(screen.getByRole("button", {name: /Create request/}));

    await waitFor(() => expect(vi.mocked(putFlatItem)).toHaveBeenCalled());
    const body = vi.mocked(putFlatItem).mock.calls[0][3] as Record<string, unknown>;
    expect(body).toMatchObject({name: "p1", accessType: "AnyObjectRead"});
    expect(new Date(String(body.timeExpires)).getTime()).toBeGreaterThan(Date.now());
    expect(body).not.toHaveProperty("objectName");
    expect(await screen.findByText("/p/tok/n/ns/b/app/o/")).toBeInTheDocument();
  });

  test("asks for an object name on object access types", async () => {
    const user = userEvent.setup();
    vi.mocked(listFlatItems).mockResolvedValue({items: [], nextCursor: null});
    renderPanel();
    await screen.findByText("No pre-authenticated requests");

    expect(screen.queryByLabelText("Object name")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Access type"), "ObjectRead");
    expect(screen.getByLabelText("Object name")).toBeInTheDocument();
  });

  test("blocks a past expiry before calling the API", async () => {
    const user = userEvent.setup();
    vi.mocked(listFlatItems).mockResolvedValue({items: [], nextCursor: null});
    renderPanel();
    await screen.findByText("No pre-authenticated requests");

    await user.type(screen.getByLabelText("Name"), "p1");
    const expiry = screen.getByLabelText("Expires");
    await user.clear(expiry);
    await user.type(expiry, "2020-01-01T00:00");
    await user.click(screen.getByRole("button", {name: /Create request/}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Expiry must be a date and time in the future.");
    expect(vi.mocked(putFlatItem)).not.toHaveBeenCalled();
  });

  test("lists requests without an access URI and deletes one", async () => {
    const user = userEvent.setup();
    vi.mocked(listFlatItems).mockResolvedValue({items: [par], nextCursor: null});
    vi.mocked(deleteFlatItem).mockResolvedValue();
    renderPanel();

    expect(await screen.findByText("p1")).toBeInTheDocument();
    expect(screen.getByText("All objects")).toBeInTheDocument();
    expect(screen.queryByText(/Access URI/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Delete p1"}));
    await waitFor(() => expect(vi.mocked(deleteFlatItem)).toHaveBeenCalledWith("oci", "storage", "app", "abc:p1"));
  });

  test("keeps the object name exactly as typed", async () => {
    const user = userEvent.setup();
    vi.mocked(listFlatItems).mockResolvedValue({items: [], nextCursor: null});
    vi.mocked(putFlatItem).mockResolvedValue({...par, body: {...par.body, accessUri: "/p/tok"}});
    renderPanel();
    await screen.findByText("No pre-authenticated requests");

    await user.type(screen.getByLabelText("Name"), "p1");
    await user.selectOptions(screen.getByLabelText("Access type"), "ObjectRead");
    await user.type(screen.getByLabelText("Object name"), " report.txt ");
    await user.click(screen.getByRole("button", {name: /Create request/}));

    await waitFor(() => expect(vi.mocked(putFlatItem)).toHaveBeenCalled());
    expect(vi.mocked(putFlatItem).mock.calls[0][3]).toMatchObject({objectName: " report.txt "});
  });

  test("keeps the access URI when a later submit fails", async () => {
    const user = userEvent.setup();
    vi.mocked(listFlatItems).mockResolvedValue({items: [], nextCursor: null});
    vi.mocked(putFlatItem).mockResolvedValueOnce({...par, body: {...par.body, accessUri: "/p/tok/first"}});
    renderPanel();
    await screen.findByText("No pre-authenticated requests");

    await user.type(screen.getByLabelText("Name"), "p1");
    await user.click(screen.getByRole("button", {name: /Create request/}));
    expect(await screen.findByText("/p/tok/first")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "p2");
    const expiry = screen.getByLabelText("Expires");
    await user.clear(expiry);
    await user.type(expiry, "2020-01-01T00:00");
    await user.click(screen.getByRole("button", {name: /Create request/}));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("/p/tok/first")).toBeInTheDocument();
  });

  test("clears the access URI when its request is deleted", async () => {
    const user = userEvent.setup();
    vi.mocked(listFlatItems).mockResolvedValue({items: [par], nextCursor: null});
    vi.mocked(putFlatItem).mockResolvedValue({...par, body: {...par.body, accessUri: "/p/tok/gone"}});
    vi.mocked(deleteFlatItem).mockResolvedValue();
    renderPanel();
    await screen.findByText("p1");

    await user.type(screen.getByLabelText("Name"), "p1");
    await user.click(screen.getByRole("button", {name: /Create request/}));
    expect(await screen.findByText("/p/tok/gone")).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Delete p1"}));
    await waitFor(() => expect(screen.queryByText("/p/tok/gone")).not.toBeInTheDocument());
  });
});
