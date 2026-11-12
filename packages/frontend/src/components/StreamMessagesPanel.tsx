import {useEffect, useRef, useState} from "react";
import {Icon, Inbox, Loader2, Send} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import {Textarea} from '@/components/sodium/ui/textarea'
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
import {DateTimeInput} from '@/components/DateTimeInput'
import {EmptyState} from '@/components/EmptyState'

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
        <EmptyState compact title="Select a stream" description="Select an OCI stream to put messages on it or read them back."/>
      </section>
    );
  }

  const partitions = Array.from({length: partitionCount(resource)}, (_, index) => String(index));

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Stream Actions</p>
          <h2><Icon icon={Send}  /> Messages</h2>
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
          <Button variant={tab === "put" ? 'secondary' : 'ghost'} type="button" onClick={() => changeTab("put")}>
            <Icon icon={Send} size={14} /> Put
          </Button>
          <Button variant={tab === "read" ? 'secondary' : 'ghost'} type="button" onClick={() => changeTab("read")}>
            <Icon icon={Inbox} size={14} /> Read
          </Button>
        </div>

        {tab === "put" && (
          <>
            <div className="mb-4">
              <label className="metric-label block mb-1.5" htmlFor="stream-message-key">
                Key (optional)
              </label>
              <Input
                id="stream-message-key"
                type="text"
                className="button w-full cursor-text"
                value={key}
                disabled={putting}
                onChange={(event) => setKey(event.target.value)}
                placeholder="Messages with the same key go to the same partition"
              />
            </div>
            <div className="mb-4">
              <label className="metric-label block mb-1.5" htmlFor="stream-message-value">
                Message value
              </label>
              <Textarea
                id="stream-message-value"
                className="json-editor w-full block"
                value={value}
                disabled={putting}
                onChange={(event) => setValue(event.target.value)}
                spellCheck={false}
                placeholder="Message value"
              />
            </div>
            <Button
              type="button"
              disabled={!canUseStream || !value || putting}
              onClick={() => void submitPut()}
            >
              {putting ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Send} size={14} />}
              {putting ? "Putting" : "Put message"}
            </Button>
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
            <div className="flex gap-3 flex-wrap mb-3">
              <div>
                <label className="metric-label block mb-1.5" htmlFor="stream-partition">Partition</label>
                <OptionSelect
                  id="stream-partition"
                  value={partition}
                  disabled={!canUseStream || reading}
                  onValueChange={(value) => changeReadPosition(() => setPartition(value))}
                >
                  {partitions.map((id) => <option key={id} value={id}>{id}</option>)}
                </OptionSelect>
              </div>
              <div>
                <label className="metric-label block mb-1.5" htmlFor="stream-cursor-type">Start from</label>
                <OptionSelect
                  id="stream-cursor-type"
                  value={cursorType}
                  disabled={!canUseStream || reading}
                  onValueChange={(value) => changeReadPosition(() => setCursorType(value as StreamCursorType))}
                >
                  {CURSOR_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </OptionSelect>
              </div>
              {needsOffset && (
                <div>
                  <label className="metric-label block mb-1.5" htmlFor="stream-offset">Offset</label>
                  <Input
                    id="stream-offset"
                    type="number"
                    min={0}
                    className="button w-24 cursor-text"
                    value={offset}
                    disabled={!canUseStream || reading}
                    onChange={(event) => changeReadPosition(() => setOffset(event.target.value))}
                  />
                </div>
              )}
              {needsTime && (
                <div>
                  <label className="metric-label block mb-1.5" htmlFor="stream-time">Time</label>
                  <DateTimeInput
                    id="stream-time"
                    value={time}
                    disabled={!canUseStream || reading}
                    onValueChange={(next) => changeReadPosition(() => setTime(next))}
                  />
                </div>
              )}
              <div>
                <label className="metric-label block mb-1.5" htmlFor="stream-limit">Limit (up to 100)</label>
                <Input
                  id="stream-limit"
                  type="number"
                  min={1}
                  max={100}
                  className="button w-18 text-center"
                  value={String(limit)}
                  disabled={!canUseStream || reading}
                  aria-label="Max messages to read"
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

            <div className="flex gap-2 mb-2">
              <Button type="button" disabled={!readReady || reading} onClick={() => void read()}>
                {reading ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Inbox} size={14} />}
                {reading ? "Reading" : "Read messages"}
              </Button>
              {hasRead && nextCursor && (
                <Button variant="secondary" type="button" disabled={!readReady || reading} onClick={() => void read(nextCursor)}>
                  Read next
                </Button>
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
