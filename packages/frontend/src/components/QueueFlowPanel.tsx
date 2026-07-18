import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Eraser,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteQueueMessage,
  getCloudResource,
  purgeQueue,
  receiveQueueMessages,
  sendQueueMessage,
} from "@/api/cloudProxyClient";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource, QueueMessage } from "@/types/resource";

interface QueueFlowPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

interface AttributeRow {
  key: string;
  value: string;
}

interface RedrivePolicy {
  deadLetterTargetArn?: string;
  maxReceiveCount?: number;
}

export function QueueFlowPanel({
  cloud,
  resource,
  runtimeReachable,
}: QueueFlowPanelProps) {
  const qc = useQueryClient();
  const queueId = resource?.id;

  const [sendBody, setSendBody] = useState('{\n  \n}');
  const [attributeRows, setAttributeRows] = useState<AttributeRow[]>([]);
  const [longPoll, setLongPoll] = useState(false);
  const [maxMessages, setMaxMessages] = useState(5);
  const [messages, setMessages] = useState<QueueMessage[]>([]);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [lastSentId, setLastSentId] = useState<string | null>(null);

  useEffect(() => {
    setSendBody('{\n  \n}');
    setAttributeRows([]);
    setMessages([]);
    setPurgeConfirm(false);
    setLastSentId(null);
  }, [queueId]);

  const detailKey = ["queue-detail", cloud, queueId];
  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) =>
      getCloudResource(cloud, "queue", queueId ?? "", signal),
    enabled: Boolean(queueId) && runtimeReachable,
    refetchInterval: 4000,
  });

  const live = detailQuery.data ?? resource;
  const isQueue = resource?.service === "queue";

  const sendMut = useMutation({
    mutationFn: () =>
      sendQueueMessage(cloud, queueId ?? "", sendBody, attributesRecord(attributeRows)),
    onSuccess: (message) => {
      setLastSentId(message.id);
      void qc.invalidateQueries({ queryKey: detailKey });
    },
  });

  const receiveMut = useMutation({
    mutationFn: () =>
      receiveQueueMessages(cloud, queueId ?? "", maxMessages, longPoll ? 5 : 0),
    onSuccess: (received) => {
      if (received.length === 0) return;
      setMessages((current) => {
        const seen = new Set(current.map((m) => m.receiptHandle));
        return [...received.filter((m) => !seen.has(m.receiptHandle)), ...current];
      });
      void qc.invalidateQueries({ queryKey: detailKey });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (message: QueueMessage) =>
      deleteQueueMessage(cloud, queueId ?? "", message.receiptHandle),
    onSuccess: (_, message) => {
      setMessages((current) => current.filter((m) => m.receiptHandle !== message.receiptHandle));
      void qc.invalidateQueries({ queryKey: detailKey });
    },
  });

  const purgeMut = useMutation({
    mutationFn: () => purgeQueue(cloud, queueId ?? ""),
    onSuccess: () => {
      setMessages([]);
      setPurgeConfirm(false);
      void qc.invalidateQueries({ queryKey: detailKey });
    },
  });

  if (!resource || !isQueue) {
    return (
      <section className="table-panel">
        <div className="empty compact">
          <h3>Select a queue</h3>
          <p>Select an SQS queue to send and receive messages.</p>
        </div>
      </section>
    );
  }

  const messagesAvailable = numberMetadata(live?.metadata.messagesAvailable);
  const messagesInFlight = numberMetadata(live?.metadata.messagesInFlight);
  const messagesDelayed = numberMetadata(live?.metadata.messagesDelayed);
  const fifo = Boolean(live?.metadata.fifo);
  const redrivePolicy = live?.metadata.redrivePolicy as RedrivePolicy | null | undefined;
  const dlqName = redrivePolicy?.deadLetterTargetArn?.split(":").pop() ?? null;

  const canOperate = Boolean(queueId) && runtimeReachable;

  return (
    <section className="table-panel queue-flow-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Queue Actions</p>
          <h3>
            <Inbox size={15} />
            Send and receive messages
          </h3>
          <p className="muted compact-text">
            {resource.name} {fifo ? "· FIFO queue" : "· Standard queue"}
          </p>
        </div>
        <div className="flow-row-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`runtime-state ${canOperate ? "ready" : "pending"}`}>
            {canOperate ? "Ready" : "Runtime unavailable"}
          </span>
          {purgeConfirm ? (
            <button
              className="button danger compact"
              type="button"
              disabled={purgeMut.isPending}
              onClick={() => purgeMut.mutate()}
            >
              {purgeMut.isPending ? <Loader2 size={13} className="spin" /> : <Eraser size={13} />}
              Confirm purge
            </button>
          ) : (
            <button
              className="button"
              type="button"
              disabled={!canOperate}
              onClick={() => setPurgeConfirm(true)}
            >
              <Eraser size={13} />
              Purge queue
            </button>
          )}
        </div>
      </div>

      <div className="queue-flow-diagram">
        <div className="queue-flow-node">
          <div className="queue-flow-node-icon">
            <Send size={16} />
          </div>
          <span className="queue-flow-node-label">Producer</span>
          <span className="queue-flow-node-sublabel">Your application</span>
        </div>

        <div className={`queue-flow-connector ${sendMut.isPending ? "flow-dot-active" : ""}`}>
          <span className="flow-dot" />
        </div>

        <div className="queue-flow-node queue-flow-node--active">
          <div className="queue-flow-node-icon">
            <Inbox size={16} />
          </div>
          <span className="queue-flow-node-label">{resource.name}</span>
          <span className="queue-flow-node-sublabel">Amazon SQS</span>
          <div className="queue-flow-metrics">
            <div className="queue-flow-metric">
              <strong>{messagesAvailable}</strong>
              <span>Available</span>
            </div>
            <div className="queue-flow-metric">
              <strong>{messagesInFlight}</strong>
              <span>In flight</span>
            </div>
            <div className="queue-flow-metric">
              <strong>{messagesDelayed}</strong>
              <span>Delayed</span>
            </div>
          </div>
        </div>

        <div
          className={`queue-flow-connector ${
            receiveMut.isPending || messagesAvailable > 0 ? "flow-dot-active" : ""
          }`}
        >
          <span className="flow-dot" />
        </div>

        <div className="queue-flow-node">
          <div className="queue-flow-node-icon">
            <Users size={16} />
          </div>
          <span className="queue-flow-node-label">Consumer</span>
          <span className="queue-flow-node-sublabel">Your application</span>
        </div>

        {redrivePolicy && (
          <div className="queue-flow-branch">
            <div className="queue-flow-node queue-flow-node--dlq">
              <div className="queue-flow-node-icon">
                <AlertTriangle size={16} />
              </div>
              <span className="queue-flow-node-label">{dlqName ?? "Dead-letter queue"}</span>
              <span className="queue-flow-node-sublabel">
                After {redrivePolicy.maxReceiveCount ?? "?"} failed receives
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="queue-actions-grid">
        <div className="queue-action-card">
          <div className="queue-action-card-header">
            <h4>
              <Send size={13} />
              Send a message
            </h4>
          </div>
          <textarea
            className="textarea code-textarea"
            value={sendBody}
            onChange={(event) => setSendBody(event.target.value)}
            spellCheck={false}
            placeholder="Message body"
            style={{ minHeight: 110 }}
          />
          {attributeRows.map((row, index) => (
            <div className="queue-attr-row" key={index}>
              <input
                className="input"
                placeholder="Attribute name"
                value={row.key}
                onChange={(event) => updateAttributeRow(index, { key: event.target.value })}
              />
              <input
                className="input"
                placeholder="Value"
                value={row.value}
                onChange={(event) => updateAttributeRow(index, { value: event.target.value })}
              />
              <button
                className="icon-btn"
                type="button"
                title="Remove attribute"
                onClick={() => setAttributeRows((rows) => rows.filter((_, i) => i !== index))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            className="button"
            type="button"
            onClick={() => setAttributeRows((rows) => [...rows, { key: "", value: "" }])}
          >
            <Plus size={13} />
            Add message attribute
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!canOperate || sendMut.isPending || !sendBody.trim()}
            onClick={() => sendMut.mutate()}
          >
            {sendMut.isPending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
            {sendMut.isPending ? "Sending" : "Send message"}
          </button>
          {sendMut.isError && (
            <p className="error-text compact-text">
              {sendMut.error instanceof Error ? sendMut.error.message : "Send failed"}
            </p>
          )}
          {lastSentId && !sendMut.isPending && !sendMut.isError && (
            <p className="muted compact-text">Sent — message id {lastSentId}</p>
          )}
        </div>

        <div className="queue-action-card">
          <div className="queue-action-card-header">
            <h4>
              <Users size={13} />
              Receive messages
            </h4>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                className="input"
                value={maxMessages}
                onChange={(event) => setMaxMessages(Number(event.target.value))}
                style={{ width: 64 }}
              >
                {[1, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <label className="muted compact-text" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={longPoll}
                  onChange={(event) => setLongPoll(event.target.checked)}
                />
                Long poll
              </label>
            </div>
          </div>
          <button
            className="button"
            type="button"
            disabled={!canOperate || receiveMut.isPending}
            onClick={() => receiveMut.mutate()}
          >
            {receiveMut.isPending ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            {receiveMut.isPending ? "Polling" : "Poll for messages"}
          </button>
          {receiveMut.isError && (
            <p className="error-text compact-text">
              {receiveMut.error instanceof Error ? receiveMut.error.message : "Receive failed"}
            </p>
          )}
          <div className="queue-message-list">
            {messages.length === 0 && (
              <p className="muted compact-text">No messages received yet.</p>
            )}
            {messages.map((message) => (
              <div className="queue-message-card" key={message.receiptHandle}>
                <div className="queue-message-card-header">
                  <span className="muted compact-text">
                    {message.id.slice(0, 12)}
                    {message.receiveCount !== null ? ` · receive #${message.receiveCount}` : ""}
                  </span>
                  <button
                    className="icon-btn danger"
                    type="button"
                    title="Delete message"
                    disabled={deleteMut.isPending && deleteMut.variables?.receiptHandle === message.receiptHandle}
                    onClick={() => deleteMut.mutate(message)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <pre className="queue-message-body">{message.body}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );

  function updateAttributeRow(index: number, patch: Partial<AttributeRow>) {
    setAttributeRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
}

function attributesRecord(rows: AttributeRow[]): Record<string, string> | undefined {
  const entries = rows
    .map((row) => [row.key.trim(), row.value] as const)
    .filter(([key]) => key.length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function numberMetadata(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
