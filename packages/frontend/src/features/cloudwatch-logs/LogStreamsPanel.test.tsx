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

import { LogStreamsPanel } from "./LogStreamsPanel";

function renderPanel(props: Partial<React.ComponentProps<typeof LogStreamsPanel>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LogStreamsPanel
        group="/aws/lambda/foo"
        onBack={vi.fn()}
        onSelectStream={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("LogStreamsPanel", () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it("requests streams for the given group", () => {
    callMock.mockReturnValue(new Promise(() => {}));

    renderPanel({ group: "/aws/lambda/foo" });

    expect(callMock).toHaveBeenCalledWith(
      "aws.logs.streams.list",
      expect.objectContaining({ params: { group: "/aws/lambda/foo" } }),
    );
  });

  it("renders a loading state before streams arrive", () => {
    callMock.mockReturnValue(new Promise(() => {}));

    renderPanel();

    expect(screen.getByText(/loading log streams/i)).toBeInTheDocument();
  });

  it("renders stream name and stored bytes once loaded", async () => {
    callMock.mockResolvedValue({
      data: {
        streams: [
          {
            name: "2024/01/01/[$LATEST]abc123",
            lastEventTimestamp: new Date().toISOString(),
            storedBytes: 2048,
          },
        ],
      },
    });

    renderPanel();

    expect(await screen.findByText("2024/01/01/[$LATEST]abc123")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("renders an empty state, not an empty table, when the group has no streams", async () => {
    callMock.mockResolvedValue({ data: { streams: [] } });

    renderPanel();

    expect(await screen.findByText(/no log streams/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders an error state with a retry action when the request fails", async () => {
    callMock.mockRejectedValue(new Error("network down"));

    renderPanel();

    expect(await screen.findByText(/cannot load log streams/i)).toBeInTheDocument();

    callMock.mockResolvedValue({
      data: { streams: [{ name: "recovered-stream" }] },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("recovered-stream")).toBeInTheDocument();
  });

  it("calls onSelectStream with the stream name when a row is clicked", async () => {
    callMock.mockResolvedValue({
      data: { streams: [{ name: "2024/01/01/[$LATEST]abc123" }] },
    });
    const onSelectStream = vi.fn();

    renderPanel({ onSelectStream });

    const row = await screen.findByText("2024/01/01/[$LATEST]abc123");
    const user = userEvent.setup();
    await user.click(row);

    expect(onSelectStream).toHaveBeenCalledWith("2024/01/01/[$LATEST]abc123");
  });

  it("calls onBack when the back button is clicked", async () => {
    callMock.mockResolvedValue({ data: { streams: [] } });
    const onBack = vi.fn();

    renderPanel({ onBack });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /log groups/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
