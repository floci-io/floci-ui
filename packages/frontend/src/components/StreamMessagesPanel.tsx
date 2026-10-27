import {useEffect, useRef, useState} from "react";
import {Inbox, Loader2, Send} from "lucide-react";
import {
  putStreamMessages,
  readStreamMessages,
  type PutStreamMessageEntry,
  type StreamCursorType,
  type StreamMessage,
} from "@/api/cloudProxyClient";
import {useAccountId} from "@/lib/accountStore";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface StreamMessagesPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

type StreamTab = "put" | "read";

const CURSOR_TYPES: Array<{value: StreamCursorType; label: string}> = [
  {value: "TRIM_HORIZON", label: "Oldest message (TRIM_HORIZON)"},
  {value: "LATEST", label: "Only new messages (LATEST)"},
  {value: "AT_OFFSET", label: "At offset (AT_OFFSET)"},
  {value: "AFTER_OFFSET", label: "After offset (AFTER_OFFSET)"},
  {value: "AT_TIME", label: "At time (AT_TIME)"},
];

const DEFAULT_LIMIT = 10;

function partitionCount(resource?: CloudResource): number {
  const count = Number(resource?.metadata?.partitions);
  return Number.isInteger(count) && count > 0 ? count : 1;
}

export function StreamMessagesPanel({cloud, resource, runtimeReachable}: StreamMessagesPanelProps) {
  const accountId = useAccountId();
  const [tab, setTab] = useState<StreamTab>("put");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [putEntry, setPutEntry] = useState<PutStreamMessageEntry | null>(null);
  const [putError, setPutError] = useState<string | null>(null);
  const [putting, setPutting] = useState(false);
  const [partition, setPartition] = useState("0");
  const [cursorType, setCursorType] = useState<StreamCursorType>("TRIM_HORIZON");
  const [offset, setOffset] = useState("0");
  const [time, setTime] = useState("");
  const [limit, setLimit] = useState<number | "">(DEFAULT_LIMIT);
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasRead, setHasRead] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const activePut = useRef<object | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    activePut.current = null;
    setTab("put");
    setKey("");
    setValue("");
    setPutEntry(null);
    setPutError(null);
    setPutting(false);
    setPartition("0");
    setCursorType("TRIM_HORIZON");
    setOffset("0");
    setTime("");
    setLimit(DEFAULT_LIMIT);
    setMessages([]);
    setNextCursor(undefined);
    setHasRead(false);
    setReadError(null);
    setReading(false);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [accountId, cloud, resource?.id]);

  const isStream = resource?.service === "streams" && resource.type === "stream";
  const canUseStream = Boolean(isStream && runtimeReachable);
  const needsOffset = cursorType === "AT_OFFSET" || cursorType === "AFTER_OFFSET";
  const needsTime = cursorType === "AT_TIME";
  const timeIso = time && !Number.isNaN(Date.parse(time)) ? new Date(time).toISOString() : undefined;
  const readReady = canUseStream && (!needsOffset || /^\d+$/.test(offset)) && (!needsTime || Boolean(timeIso));

  const changeTab = (next: StreamTab) => {
    if (next === tab) return;
    setTab(next);
    setPutError(null);
    setReadError(null);
  };

  const submitPut = async () => {
    if (!resource || !canUseStream || !value) return;
    setPutError(null);
    setPutEntry(null);
    setPutting(true);
    const request = {};
    activePut.current = request;
    try {
      const result = await putStreamMessages(cloud, "streams", resource.id, [{key: key || undefined, value}]);
      if (activePut.current !== request) return;
      setPutEntry(result.entries[0] ?? {});
      setValue("");
    } catch (error) {
      if (activePut.current !== request) return;
      setPutError(error instanceof Error ? error.message : "Failed to put the message.");
    } finally {
      if (activePut.current === request) {
        activePut.current = null;
        setPutting(false);
      }
    }
  };

  const changeReadPosition = (apply: () => void) => {
    apply();
    setNextCursor(undefined);
    setMessages([]);
    setHasRead(false);
    setReadError(null);
  };

  const read = async (continueFrom?: string) => {
    if (!resource || !readReady) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setReadError(null);
    setReading(true);
    try {
      const result = await readStreamMessages(
        cloud,
        "streams",
        resource.id,
        {
          partition,
          cursorType,
          offset: needsOffset ? Number(offset) : undefined,
          time: needsTime ? timeIso : undefined,
          limit: limit || DEFAULT_LIMIT,
          cursor: continueFrom,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setMessages(result.messages);
      setNextCursor(result.nextCursor);
      setHasRead(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      setReadError(error instanceof Error ? error.message : "Failed to read messages.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setReading(false);
      }
    }
  };

  if (!resource || resource.service !== "streams") {
    return (
      <section className="table-panel">
        <div className="empty compact">
          <h2>Select a stream</h2>
          <p>Select an OCI stream to put messages on it or read them back.</p>
        </div>
      </section>
    );
  }

  const partitions = Array.from({length: partitionCount(resource)}, (_, index) => String(index));

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Stream Actions</p>
          <h2><Send size={15} /> Messages</h2>
          <p className="muted compact-text">
            Put a message on this stream, or read a partition from the position you choose. Reads do not consume messages.
          </p>
        </div>
        <span className={`runtime-state ${canUseStream ? "ready" : "pending"}`}>
          {canUseStream ? "Ready" : runtimeReachable ? "Not a stream" : "Runtime unavailable"}
        </span>
      </div>

      <div className="resource-create-inline">
        <div className="drawer-tabs">
          <button type="button" className={`drawer-tab ${tab === "put" ? "active" : ""}`} onClick={() => changeTab("put")}>
            <Send size={13} /> Put
          </button>
          <button type="button" className={`drawer-tab ${tab === "read" ? "active" : ""}`} onClick={() => changeTab("read")}>
            <Inbox size={13} /> Read
          </button>
        </div>

        {tab === "put" && (
          <>
            <div style={{marginBottom: "16px"}}>
              <label className="metric-label" htmlFor="stream-message-key" style={{display: "block", marginBottom: "6px"}}>
                Key (optional)
              </label>
              <input
                id="stream-message-key"
                type="text"
                className="button"
                value={key}
                disabled={putting}
                onChange={(event) => setKey(event.target.value)}
                placeholder="Messages with the same key go to the same partition"
                style={{width: "100%", cursor: "text", padding: "4px 8px", minHeight: 32}}
              />
            </div>
            <div style={{marginBottom: "16px"}}>
              <label className="metric-label" htmlFor="stream-message-value" style={{display: "block", marginBottom: "6px"}}>
                Message value
              </label>
              <textarea
                id="stream-message-value"
                className="json-editor"
                value={value}
                disabled={putting}
                onChange={(event) => setValue(event.target.value)}
                spellCheck={false}
                placeholder="Message value"
                style={{minHeight: 120, width: "100%", display: "block"}}
              />
            </div>
            <button
              className="button primary"
              type="button"
              disabled={!canUseStream || !value || putting}
              onClick={() => void submitPut()}
            >
              {putting ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              {putting ? "Putting" : "Put message"}
            </button>
            {putError && <p className="error-text compact-text">{putError}</p>}
            {putEntry && (
              <p className="muted compact-text">
                Put on partition <code>{putEntry.partition ?? "?"}</code> at offset <code>{putEntry.offset ?? "?"}</code>.
              </p>
            )}
          </>
        )}

        {tab === "read" && (
          <>
            <div style={{display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px"}}>
              <div>
                <label className="metric-label" htmlFor="stream-partition" style={{display: "block", marginBottom: "6px"}}>Partition</label>
                <select
                  id="stream-partition"
                  className="button"
                  value={partition}
                  disabled={!canUseStream || reading}
                  onChange={(event) => changeReadPosition(() => setPartition(event.target.value))}
                >
                  {partitions.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
              <div>
                <label className="metric-label" htmlFor="stream-cursor-type" style={{display: "block", marginBottom: "6px"}}>Start from</label>
                <select
                  id="stream-cursor-type"
                  className="button"
                  value={cursorType}
                  disabled={!canUseStream || reading}
                  onChange={(event) => changeReadPosition(() => setCursorType(event.target.value as StreamCursorType))}
                >
                  {CURSOR_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              {needsOffset && (
                <div>
                  <label className="metric-label" htmlFor="stream-offset" style={{display: "block", marginBottom: "6px"}}>Offset</label>
                  <input
                    id="stream-offset"
                    type="number"
                    min={0}
                    className="button"
                    value={offset}
                    disabled={!canUseStream || reading}
                    onChange={(event) => changeReadPosition(() => setOffset(event.target.value))}
                    style={{width: 96, cursor: "text", padding: "4px 8px", minHeight: 32}}
                  />
                </div>
              )}
              {needsTime && (
                <div>
                  <label className="metric-label" htmlFor="stream-time" style={{display: "block", marginBottom: "6px"}}>Time</label>
                  <input
                    id="stream-time"
                    type="datetime-local"
                    className="button"
                    value={time}
                    disabled={!canUseStream || reading}
                    onChange={(event) => changeReadPosition(() => setTime(event.target.value))}
                    style={{cursor: "text", padding: "4px 8px", minHeight: 32}}
                  />
                </div>
              )}
              <div>
                <label className="metric-label" htmlFor="stream-limit" style={{display: "block", marginBottom: "6px"}}>Limit (up to 100)</label>
                <input
                  id="stream-limit"
                  type="number"
                  min={1}
                  max={100}
                  className="button"
                  value={limit}
                  disabled={!canUseStream || reading}
                  aria-label="Max messages to read"
                  style={{width: 72, padding: "4px 8px", textAlign: "center", minHeight: 32}}
                  onChange={(event) => {
                    if (event.target.value === "") {
                      setLimit("");
                      return;
                    }
                    const parsed = parseInt(event.target.value, 10);
                    if (!isNaN(parsed)) setLimit(parsed);
                  }}
                  onBlur={(event) => {
                    const parsed = parseInt(event.target.value, 10);
                    setLimit(isNaN(parsed) ? DEFAULT_LIMIT : Math.min(100, Math.max(1, parsed)));
                  }}
                />
              </div>
            </div>

            <div style={{display: "flex", gap: "8px", marginBottom: "8px"}}>
              <button className="button primary" type="button" disabled={!readReady || reading} onClick={() => void read()}>
                {reading ? <Loader2 size={13} className="spin" /> : <Inbox size={13} />}
                {reading ? "Reading" : "Read messages"}
              </button>
              {hasRead && nextCursor && (
                <button className="button" type="button" disabled={!readReady || reading} onClick={() => void read(nextCursor)}>
                  Read next
                </button>
              )}
            </div>

            {readError && <p className="error-text compact-text">{readError}</p>}
            {!reading && !hasRead && (
              <p className="muted compact-text">Nothing read yet. Choose a partition and a start position, then read.</p>
            )}
            {!reading && hasRead && messages.length === 0 && (
              <p className="muted compact-text">No messages from this position on partition <code>{partition}</code>.</p>
            )}
            {!reading && messages.length > 0 && (
              <p className="muted compact-text">
                <strong>{messages.length}</strong> message{messages.length !== 1 ? "s" : ""} read.
              </p>
            )}
            {messages.map((message) => (
              <div className="inspector-section" key={`${message.partition}-${message.offset}`}>
                <div className="inspector-section-header">
                  <p className="metric-label">
                    Partition <code>{message.partition}</code> · offset <code>{message.offset}</code> · {message.timestamp}
                  </p>
                </div>
                <p className="muted compact-text">
                  Key: {message.key === null ? <em>none</em> : <code>{message.key}</code>}
                  {message.valueEncoding === "base64" && " · binary payload shown as base64"}
                </p>
                <pre className="invoke-result success">{message.value}</pre>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
