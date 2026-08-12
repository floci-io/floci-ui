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

import { LogGroupsPage } from "./LogGroupsPage";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LogGroupsPage />
    </QueryClientProvider>,
  );
}

describe("LogGroupsPage", () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it("renders a loading state before groups arrive", () => {
    callMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText(/loading log groups/i)).toBeInTheDocument();
  });

  it("renders log group name, retention, and created columns once loaded", async () => {
    callMock.mockResolvedValue({
      data: [
        {
          name: "/aws/lambda/foo",
          arn: "arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/foo:*",
          creationTime: new Date(1700000000000).toISOString(),
          retentionInDays: 14,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("/aws/lambda/foo")).toBeInTheDocument();
    expect(screen.getByText("14 days")).toBeInTheDocument();
  });

  it("renders a group with no retention configured as never-expiring, not a false zero", async () => {
    callMock.mockResolvedValue({
      data: [{ name: "/aws/lambda/no-retention" }],
    });

    renderPage();

    expect(await screen.findByText("/aws/lambda/no-retention")).toBeInTheDocument();
    expect(screen.getByText(/never expires/i)).toBeInTheDocument();
  });

  it("renders an empty state, not an empty table, when there are no log groups", async () => {
    callMock.mockResolvedValue({ data: [] });

    renderPage();

    expect(await screen.findByText(/no log groups/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders an error state with a retry action when the request fails", async () => {
    callMock.mockRejectedValue(new Error("network down"));

    renderPage();

    expect(await screen.findByText(/cannot load log groups/i)).toBeInTheDocument();

    callMock.mockResolvedValue({
      data: [{ name: "/aws/lambda/recovered" }],
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("/aws/lambda/recovered")).toBeInTheDocument();
  });

  it("filters the loaded groups client-side by search text, without issuing a new request per keystroke", async () => {
    callMock.mockResolvedValue({
      data: [
        { name: "/aws/lambda/foo" },
        { name: "/aws/lambda/bar" },
        { name: "/ecs/other" },
      ],
    });

    renderPage();
    expect(await screen.findByText("/aws/lambda/foo")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/search/i), "lambda");

    expect(await screen.findByText("/aws/lambda/foo")).toBeInTheDocument();
    expect(screen.getByText("/aws/lambda/bar")).toBeInTheDocument();
    expect(screen.queryByText("/ecs/other")).not.toBeInTheDocument();
    // Typing filtered in place; it never re-fetched.
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it("shows a group's streams when its row is clicked, and returns to groups when back is clicked", async () => {
    callMock.mockImplementation((key: string) => {
      if (key === "aws.logs.groups.list") {
        return Promise.resolve({ data: [{ name: "/aws/lambda/foo" }] });
      }
      if (key === "aws.logs.streams.list") {
        return Promise.resolve({
          data: { streams: [{ name: "2024/01/01/[$LATEST]abc123" }] },
        });
      }
      return Promise.reject(new Error(`unexpected endpoint: ${key}`));
    });

    renderPage();
    const user = userEvent.setup();

    const groupRow = await screen.findByText("/aws/lambda/foo");
    await user.click(groupRow);

    expect(await screen.findByText("2024/01/01/[$LATEST]abc123")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith(
      "aws.logs.streams.list",
      expect.objectContaining({ params: { group: "/aws/lambda/foo" } }),
    );
    // The groups table (with its Retention column) is no longer shown.
    expect(screen.queryByText("Retention")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /log groups/i }));

    expect(await screen.findByText("Retention")).toBeInTheDocument();
    expect(screen.queryByText("2024/01/01/[$LATEST]abc123")).not.toBeInTheDocument();
  });

  it("shows a stream's events when its row is clicked from the streams view, and returns to streams when back is clicked", async () => {
    callMock.mockImplementation((key: string) => {
      if (key === "aws.logs.groups.list") {
        return Promise.resolve({ data: [{ name: "/aws/lambda/foo" }] });
      }
      if (key === "aws.logs.streams.list") {
        return Promise.resolve({
          data: { streams: [{ name: "2024/01/01/[$LATEST]abc123" }] },
        });
      }
      if (key === "aws.logs.events.list") {
        return Promise.resolve({
          data: { events: [{ timestamp: new Date(1700000000000).toISOString(), message: "hello from the stream" }] },
        });
      }
      return Promise.reject(new Error(`unexpected endpoint: ${key}`));
    });

    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByText("/aws/lambda/foo"));
    const streamRow = await screen.findByText("2024/01/01/[$LATEST]abc123");
    await user.click(streamRow);

    expect(await screen.findByText("hello from the stream")).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith(
      "aws.logs.events.list",
      expect.objectContaining({
        params: { group: "/aws/lambda/foo", stream: "2024/01/01/[$LATEST]abc123" },
      }),
    );

    await user.click(screen.getByRole("button", { name: /log streams/i }));

    expect(await screen.findByText("2024/01/01/[$LATEST]abc123")).toBeInTheDocument();
    expect(screen.queryByText("hello from the stream")).not.toBeInTheDocument();
  });
});
