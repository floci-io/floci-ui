import {act, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, test, vi} from "vitest";
import {putStreamMessages, readStreamMessages, type PutStreamMessageEntry} from "@/api/cloudProxyClient";
import {StreamMessagesPanel} from "@/components/StreamMessagesPanel";
import {DEFAULT_ACCOUNT_ID, setAccountId} from "@/lib/accountStore";
import type {CloudResource} from "@/types/resource";

vi.mock("@/api/cloudProxyClient", () => ({
  putStreamMessages: vi.fn(),
  readStreamMessages: vi.fn(),
}));

const stream: CloudResource = {
  id: "ocid1.stream.oc1.iad.aaaa",
  name: "orders",
  cloud: "oci",
  service: "streams",
  type: "stream",
  region: null,
  createdAt: null,
  metadata: {provider: "oci", streamsService: "streaming", partitions: 2},
};

afterEach(() => {
  vi.clearAllMocks();
  setAccountId(DEFAULT_ACCOUNT_ID);
});

describe("StreamMessagesPanel", () => {
  test("puts a keyed message and says where it landed", async () => {
    vi.mocked(putStreamMessages).mockResolvedValue({failures: 0, entries: [{partition: "1", offset: 4}]});
    const user = userEvent.setup();

    render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={true}/>);

    await user.type(screen.getByLabelText("Key (optional)"), "k1");
    await user.type(screen.getByLabelText("Message value"), "hello");
    await user.click(screen.getByRole("button", {name: "Put message"}));

    expect(putStreamMessages).toHaveBeenCalledWith("oci", "streams", stream.id, [{key: "k1", value: "hello"}]);
    expect(await screen.findByText(/at offset/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message value")).toHaveValue("");
  });

  test("shows the failure when a put is rejected", async () => {
    vi.mocked(putStreamMessages).mockRejectedValue(new Error("value must be base64-encoded"));
    const user = userEvent.setup();

    render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={true}/>);

    await user.type(screen.getByLabelText("Message value"), "x");
    await user.click(screen.getByRole("button", {name: "Put message"}));

    expect(await screen.findByText("value must be base64-encoded")).toBeInTheDocument();
  });

  test("reads from the chosen cursor type and offers the next page", async () => {
    vi.mocked(readStreamMessages)
      .mockResolvedValueOnce({
        messages: [{partition: "1", offset: 0, timestamp: "2026-10-27T15:49:22Z", key: "k1", value: "hello", valueEncoding: "utf8"}],
        nextCursor: "c2",
      })
      .mockResolvedValueOnce({messages: [], nextCursor: "c3"});
    const user = userEvent.setup();

    render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={true}/>);

    await user.click(screen.getByRole("button", {name: "Read"}));
    expect(screen.getByLabelText("Partition").querySelectorAll("option")).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText("Partition"), "1");
    await user.selectOptions(screen.getByLabelText("Start from"), "AT_OFFSET");
    await user.clear(screen.getByLabelText("Offset"));
    await user.type(screen.getByLabelText("Offset"), "0");
    await user.click(screen.getByRole("button", {name: "Read messages"}));

    expect(readStreamMessages).toHaveBeenLastCalledWith(
      "oci", "streams", stream.id,
      {partition: "1", cursorType: "AT_OFFSET", offset: 0, time: undefined, limit: 10, cursor: undefined},
      expect.any(AbortSignal),
    );
    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText("k1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Read next"}));
    expect(readStreamMessages).toHaveBeenLastCalledWith(
      "oci", "streams", stream.id,
      expect.objectContaining({cursor: "c2"}),
      expect.any(AbortSignal),
    );
  });

  test("drops the saved cursor when the partition changes", async () => {
    vi.mocked(readStreamMessages).mockResolvedValue({messages: [], nextCursor: "c-p0"});
    const user = userEvent.setup();

    render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={true}/>);

    await user.click(screen.getByRole("button", {name: "Read"}));
    await user.click(screen.getByRole("button", {name: "Read messages"}));
    expect(await screen.findByRole("button", {name: "Read next"})).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Partition"), "1");

    expect(screen.queryByRole("button", {name: "Read next"})).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing read yet/)).toBeInTheDocument();
  });

  test("ignores a put that finishes after another stream is selected", async () => {
    let finish!: (value: {failures: number; entries: PutStreamMessageEntry[]}) => void;
    vi.mocked(putStreamMessages).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();

    const {rerender} = render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={true}/>);
    await user.type(screen.getByLabelText("Message value"), "old");
    await user.click(screen.getByRole("button", {name: "Put message"}));

    rerender(<StreamMessagesPanel cloud="oci" resource={{...stream, id: "ocid1.stream.oc1.iad.bbbb"}} runtimeReachable={true}/>);
    await user.type(screen.getByLabelText("Message value"), "draft");
    await act(async () => finish({failures: 0, entries: [{partition: "0", offset: 9}]}));

    expect(screen.getByLabelText("Message value")).toHaveValue("draft");
    expect(screen.queryByText(/at offset/)).not.toBeInTheDocument();
  });

  test("says so when a partition has no messages", async () => {
    vi.mocked(readStreamMessages).mockResolvedValue({messages: []});
    const user = userEvent.setup();

    render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={true}/>);

    await user.click(screen.getByRole("button", {name: "Read"}));
    expect(screen.getByText(/Nothing read yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Read messages"}));

    expect(await screen.findByText(/No messages from this position/)).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Read next"})).not.toBeInTheDocument();
  });

  test("marks a binary payload instead of showing garbage", async () => {
    vi.mocked(readStreamMessages).mockResolvedValue({
      messages: [{partition: "0", offset: 0, timestamp: "t", key: null, value: "//4A", valueEncoding: "base64"}],
    });
    const user = userEvent.setup();

    render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={true}/>);

    await user.click(screen.getByRole("button", {name: "Read"}));
    await user.click(screen.getByRole("button", {name: "Read messages"}));

    expect(await screen.findByText(/binary payload shown as base64/)).toBeInTheDocument();
    expect(screen.getByText("//4A")).toBeInTheDocument();
  });

  test("disables the controls when the runtime is unreachable", () => {
    render(<StreamMessagesPanel cloud="oci" resource={stream} runtimeReachable={false}/>);

    expect(screen.getByText("Runtime unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Put message"})).toBeDisabled();
  });

  test("asks for a stream when none is selected", () => {
    render(<StreamMessagesPanel cloud="oci" runtimeReachable={true}/>);

    expect(screen.getByText("Select a stream")).toBeInTheDocument();
  });
});
