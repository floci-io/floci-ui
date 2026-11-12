import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {afterEach, describe, expect, test, vi} from "vitest";
import {listCollectionItems} from "@/api/cloudProxyClient";
import {EventGridSubscriptionsPanel} from "@/components/EventGridSubscriptionsPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {ChildItem, CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  listCollectionItems: vi.fn(),
}));

const topic: CloudResource = {
  id: "rg1/orders", name: "orders", cloud: "azure", service: "events", type: "event-grid-topic",
  region: "eastus", createdAt: null, metadata: {},
};

function subscription(name: string, body: Record<string, unknown> = {}): ChildItem {
  return {
    id: name, collectionId: "eventSubscriptions", timestamp: null,
    body: {
      name, provisioningState: "Succeeded", endpointType: "WebHook", endpointUrl: "https://app.example/hook?...",
      subjectBeginsWith: null, subjectEndsWith: null, includedEventTypes: [], maxDeliveryAttempts: 30, ...body,
    },
    metadata: {},
  };
}

function renderPanel(resource: CloudResource | undefined) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <EventGridSubscriptionsPanel resource={resource} runtimeReachable={true}/>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("EventGridSubscriptionsPanel", () => {
  test("renders nothing for another cloud or service, or without a selection", () => {
    const {container} = renderPanel({...topic, cloud: "aws"});
    expect(container).toBeEmptyDOMElement();
    const other = renderPanel({...topic, service: "queue"});
    expect(other.container).toBeEmptyDOMElement();
    const none = renderPanel(undefined);
    expect(none.container).toBeEmptyDOMElement();
    expect(vi.mocked(listCollectionItems)).not.toHaveBeenCalled();
  });

  test("shows an empty state when the topic has no subscriptions", async () => {
    vi.mocked(listCollectionItems).mockResolvedValue({items: [], nextCursor: null});
    renderPanel(topic);
    expect(await screen.findByText("No event subscriptions")).toBeInTheDocument();
    expect(vi.mocked(listCollectionItems)).toHaveBeenCalledWith(
      "azure", "events", "rg1/orders", "eventSubscriptions", undefined, expect.anything(),
    );
  });

  test("lists subscriptions with their destination and filters", async () => {
    vi.mocked(listCollectionItems).mockResolvedValue({
      items: [
        subscription("to-app", {subjectBeginsWith: "/orders", includedEventTypes: ["Order.Created", "Order.Paid"]}),
        subscription("everything"),
      ],
      nextCursor: null,
    });
    renderPanel(topic);

    expect(await screen.findByText("to-app")).toBeInTheDocument();
    expect(screen.getByText("subject starts with /orders; types Order.Created, Order.Paid")).toBeInTheDocument();
    expect(screen.getByText("All events")).toBeInTheDocument();
    expect(screen.getAllByText(/https:\/\/app\.example\/hook\?\.\.\./)).toHaveLength(2);
    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
  });

  test("loads the next page on demand", async () => {
    const user = userEvent.setup();
    vi.mocked(listCollectionItems)
      .mockResolvedValueOnce({items: [subscription("a")], nextCursor: "1"})
      .mockResolvedValueOnce({items: [subscription("b")], nextCursor: null});
    renderPanel(topic);

    await user.click(await screen.findByRole("button", {name: "Load more"}));

    expect(await screen.findByText("b")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(vi.mocked(listCollectionItems)).toHaveBeenLastCalledWith(
      "azure", "events", "rg1/orders", "eventSubscriptions", "1", expect.anything(),
    );
  });

  test("reports a failed load", async () => {
    vi.mocked(listCollectionItems).mockRejectedValue(new Error("runtime unreachable"));
    renderPanel(topic);
    expect(await screen.findByRole("alert")).toHaveTextContent("runtime unreachable");
  });
});
