import {fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, test, vi} from "vitest";
import {
  deleteQueueMessage,
  receiveQueueMessages,
  sendQueueMessage,
  type QueueMessage,
} from "@/api/cloudProxyClient";
import {SqsMessagingPanel} from "@/components/SqsMessagingPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  sendQueueMessage: vi.fn(),
  receiveQueueMessages: vi.fn(),
  deleteQueueMessage: vi.fn(),
  purgeQueue: vi.fn(),
}));

const resource: CloudResource = {
  id: "orders-queue",
  name: "orders-queue",
  cloud: "aws",
  service: "messaging",
  type: "queue",
  region: null,
  createdAt: null,
  metadata: {provider: "aws", messagingService: "sqs", queueUrl: "http://localhost:4566/000000000000/orders-queue"},
};

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("SqsMessagingPanel", () => {
  test("sends a message and shows the returned message id", async () => {
    vi.mocked(sendQueueMessage).mockResolvedValue({messageId: "msg-1"});
    const user = userEvent.setup();

    render(<SqsMessagingPanel cloud="aws" resource={resource} runtimeReachable={true}/>);

    await user.type(screen.getByLabelText("Message body"), "hello");
    const sendButtons = screen.getAllByRole("button", {name: "Send"});
    await user.click(sendButtons[sendButtons.length - 1]);

    expect(sendQueueMessage).toHaveBeenCalledWith("aws", "messaging", "orders-queue", "hello");
    expect(await screen.findByText("msg-1")).toBeInTheDocument();
  });

  test("receives messages as a non-consuming peek and deletes one by receipt handle", async () => {
    const received: QueueMessage[] = [
      {messageId: "msg-1", body: "hello", receiptHandle: "handle-1"},
    ];
    vi.mocked(receiveQueueMessages).mockResolvedValue(received);
    vi.mocked(deleteQueueMessage).mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<SqsMessagingPanel cloud="aws" resource={resource} runtimeReachable={true}/>);

    await user.click(screen.getByRole("button", {name: "Receive"}));
    await user.click(screen.getByRole("button", {name: "Receive messages"}));

    expect(await screen.findByText("hello")).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Delete"}));

    expect(deleteQueueMessage).toHaveBeenCalledWith("aws", "messaging", "orders-queue", "handle-1");
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });

  test("passes maxMessages to receiveQueueMessages and defaults to 10", async () => {
    vi.mocked(receiveQueueMessages).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SqsMessagingPanel cloud="aws" resource={resource} runtimeReachable={true}/>);

    await user.click(screen.getByRole("button", {name: "Receive"}));

    // default value is 10
    await user.click(screen.getByRole("button", {name: "Receive messages"}));
    expect(receiveQueueMessages).toHaveBeenCalledWith("aws", "messaging", "orders-queue", 10);

    // change to 25 — fireEvent.change is used because jsdom's number input
    // does not support userEvent interactions reliably for value replacement.
    fireEvent.change(screen.getByLabelText("Max messages to receive"), {target: {value: "25"}});
    await user.click(screen.getByRole("button", {name: "Receive messages"}));
    expect(receiveQueueMessages).toHaveBeenLastCalledWith("aws", "messaging", "orders-queue", 25);
  });

  test("shows message attributes in a collapsible block when present", async () => {
    const received: QueueMessage[] = [
      {
        messageId: "msg-2",
        body: "payload",
        receiptHandle: "handle-2",
        attributes: {SenderId: "AIDAJDPLRKLG7EXAMPLE", SentTimestamp: "1704067200000"},
      },
    ];
    vi.mocked(receiveQueueMessages).mockResolvedValue(received);
    const user = userEvent.setup();

    render(<SqsMessagingPanel cloud="aws" resource={resource} runtimeReachable={true}/>);

    await user.click(screen.getByRole("button", {name: "Receive"}));
    await user.click(screen.getByRole("button", {name: "Receive messages"}));

    expect(await screen.findByText("payload")).toBeInTheDocument();
    // attributes summary should be present
    expect(screen.getByText("Attributes (2)")).toBeInTheDocument();
  });

  test("disables actions when the runtime is unreachable", () => {
    render(<SqsMessagingPanel cloud="aws" resource={resource} runtimeReachable={false}/>);
    const sendButtons = screen.getAllByRole("button", {name: "Send"});
    expect(sendButtons[sendButtons.length - 1]).toBeDisabled();
  });
});
