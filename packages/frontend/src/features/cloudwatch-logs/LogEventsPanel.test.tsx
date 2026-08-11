import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));

vi.mock("@/api/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/api")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      call: callMock,
    },
  };
});

import { LogEventsPanel } from "./LogEventsPanel";

function renderPanel(props: Partial<React.ComponentProps<typeof LogEventsPanel>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LogEventsPanel
        group="/aws/lambda/foo"
        stream="2024/01/01/[$LATEST]abc123"
        onBack={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("LogEventsPanel", () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it("requests events for the given group and stream", () => {
    callMock.mockReturnValue(new Promise(() => {}));

    renderPanel({ group: "/aws/lambda/foo", stream: "s1" });

    expect(callMock).toHaveBeenCalledWith(
      "aws.logs.events.list",
      expect.objectContaining({ params: { group: "/aws/lambda/foo", stream: "s1" } }),
    );
  });

  it("renders a loading state before events arrive", () => {
    callMock.mockReturnValue(new Promise(() => {}));

    renderPanel();

    expect(screen.getByText(/loading log events/i)).toBeInTheDocument();
  });

  it("renders event timestamp and message, oldest first", async () => {
    callMock.mockResolvedValue({
      data: {
        events: [
          { timestamp: new Date(1700000001000).toISOString(), message: "START RequestId: abc" },
          { timestamp: new Date(1700000002000).toISOString(), message: "END RequestId: abc" },
        ],
      },
    });

    renderPanel();

    expect(await screen.findByText("START RequestId: abc")).toBeInTheDocument();
    expect(screen.getByText("END RequestId: abc")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // Header row plus two event rows, in the order the backend returned them.
    expect(rows[1]).toHaveTextContent("START RequestId: abc");
    expect(rows[2]).toHaveTextContent("END RequestId: abc");
  });

  it("renders an empty state, not an empty table, when the stream has no events", async () => {
    callMock.mockResolvedValue({ data: { events: [] } });

    renderPanel();

    expect(await screen.findByText(/no log events/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders an error state with a retry action when the request fails", async () => {
    callMock.mockRejectedValue(new Error("network down"));

    renderPanel();

    expect(await screen.findByText(/cannot load log events/i)).toBeInTheDocument();

    callMock.mockResolvedValue({
      data: { events: [{ timestamp: new Date().toISOString(), message: "recovered" }] },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("recovered")).toBeInTheDocument();
  });

  it("shows a load-more control only when the backend returns a nextToken, and appends the next page below the first", async () => {
    callMock.mockResolvedValueOnce({
      data: { events: [{ timestamp: new Date(1).toISOString(), message: "page one" }], nextToken: "f/tok-1" },
    });

    renderPanel();

    expect(await screen.findByText("page one")).toBeInTheDocument();
    const loadMore = screen.getByRole("button", { name: /load more/i });
    expect(loadMore).toBeInTheDocument();

    callMock.mockResolvedValueOnce({
      data: { events: [{ timestamp: new Date(2).toISOString(), message: "page two" }] },
    });
    const user = userEvent.setup();
    await user.click(loadMore);

    expect(await screen.findByText("page two")).toBeInTheDocument();
    // Both pages are visible, in fetch order.
    expect(screen.getByText("page one")).toBeInTheDocument();
    expect(callMock).toHaveBeenLastCalledWith(
      "aws.logs.events.list",
      expect.objectContaining({
        params: { group: "/aws/lambda/foo", stream: "2024/01/01/[$LATEST]abc123", nextToken: "f/tok-1" },
      }),
    );
    // No nextToken on the second page, so there is nothing further to load.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("does not show a load-more control when the backend returns no nextToken", async () => {
    callMock.mockResolvedValue({
      data: { events: [{ timestamp: new Date().toISOString(), message: "only page" }] },
    });

    renderPanel();

    expect(await screen.findByText("only page")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("resets accumulated pages when switching to a different stream, not just the visible list", async () => {
    // Load two pages on stream-one first, so switching streams has
    // accumulated state to actually discard.
    callMock.mockResolvedValueOnce({
      data: { events: [{ timestamp: new Date(1).toISOString(), message: "stream-one page one" }], nextToken: "f/tok-1" },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LogEventsPanel group="/aws/lambda/foo" stream="stream-one" onBack={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("stream-one page one")).toBeInTheDocument();

    callMock.mockResolvedValueOnce({
      data: { events: [{ timestamp: new Date(2).toISOString(), message: "stream-one page two" }] },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /load more/i }));
    expect(await screen.findByText("stream-one page two")).toBeInTheDocument();

    // Now switch to stream-two, which itself has a further page available.
    const callsBeforeSwitch = callMock.mock.calls.length;
    callMock.mockResolvedValue({
      data: { events: [{ timestamp: new Date(3).toISOString(), message: "stream-two event" }], nextToken: "f/tok-2" },
    });
    rerender(
      <QueryClientProvider client={qc}>
        <LogEventsPanel group="/aws/lambda/foo" stream="stream-two" onBack={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("stream-two event")).toBeInTheDocument();
    // Neither of stream-one's pages leaked into the new stream's view.
    expect(screen.queryByText("stream-one page one")).not.toBeInTheDocument();
    expect(screen.queryByText("stream-one page two")).not.toBeInTheDocument();
    // Exactly one new request went out: stream-two's first page. Without the
    // reset, the still-length-2 token list would have fired a second request
    // carrying stream-one's leftover "f/tok-1" token against stream-two.
    expect(callMock.mock.calls.length).toBe(callsBeforeSwitch + 1);
    expect(callMock).toHaveBeenLastCalledWith(
      "aws.logs.events.list",
      expect.objectContaining({ params: { group: "/aws/lambda/foo", stream: "stream-two" } }),
    );
  });

  it("calls onBack when the back button is clicked", async () => {
    callMock.mockResolvedValue({ data: { events: [] } });
    const onBack = vi.fn();

    renderPanel({ onBack });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /log streams/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
