import {useEffect, useRef, useState} from "react";
import {Inbox, Loader2, Send, Trash2} from "lucide-react";
import {
  deleteQueueMessage,
  purgeQueue,
  receiveQueueMessages,
  sendQueueMessage,
  type QueueMessage,
} from "@/api/cloudProxyClient";
import {useAccountId} from "@/lib/accountStore";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource} from "@/types/resource";

interface SqsMessagingPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

type MessagingTab = "send" | "receive" | "purge";

export function SqsMessagingPanel({cloud, resource, runtimeReachable}: SqsMessagingPanelProps) {
  const accountId = useAccountId();
  const [tab, setTab] = useState<MessagingTab>("send");
  const [body, setBody] = useState("");
  const [sendResult, setSendResult] = useState<{messageId: string} | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [maxMessages, setMaxMessages] = useState<number | "">(10);
  const [attrKey, setAttrKey] = useState("");
  const [attrValue, setAttrValue] = useState("");
  const [customAttributes, setCustomAttributes] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<QueueMessage[]>([]);
  const [hasPolled, setHasPolled] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [deletingHandle, setDeletingHandle] = useState<string | null>(null);
  const [purgeConfirming, setPurgeConfirming] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [purged, setPurged] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setTab("send");
    setBody("");
    setSendResult(null);
    setSendError(null);
    setSending(false);
    setMaxMessages(10);
    setAttrKey("");
    setAttrValue("");
    setCustomAttributes({});
    setMessages([]);
    setHasPolled(false);
    setReceiveError(null);
    setReceiving(false);
    setDeletingHandle(null);
    setPurgeConfirming(false);
    setPurgeError(null);
    setPurging(false);
    setPurged(false);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [accountId, resource?.id]);

  const isQueue = resource?.service === "messaging" && (resource.type === "queue" || resource.type === "fifo-queue");
  const canUseQueue = Boolean(isQueue && runtimeReachable);

  const changeTab = (next: MessagingTab) => {
    if (next === tab) return;
    setTab(next);
    setSendError(null);
    setReceiveError(null);
    setPurgeConfirming(false);
    setPurgeError(null);
    setPurged(false);
  };

  const submitSend = async () => {
    if (!resource || !canUseQueue || !body) return;
    setSendError(null);
    setSendResult(null);
    setSending(true);
    try {
      const result = await sendQueueMessage(cloud, "messaging", resource.id, body, Object.keys(customAttributes).length > 0 ? customAttributes : undefined);
      setSendResult({messageId: result.messageId});
      setBody("");
      setCustomAttributes({});
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  };

  const loadMessages = async () => {
    if (!resource || !canUseQueue) return;
    setReceiveError(null);
    setReceiving(true);
    try {
      const received = await receiveQueueMessages(cloud, "messaging", resource.id, maxMessages || 10);
      setMessages(received);
      setHasPolled(true);
    } catch (error) {
      setReceiveError(error instanceof Error ? error.message : "Failed to receive messages.");
    } finally {
      setReceiving(false);
    }
  };

  const removeMessage = async (receiptHandle: string) => {
    if (!resource) return;
    setDeletingHandle(receiptHandle);
    try {
      await deleteQueueMessage(cloud, "messaging", resource.id, receiptHandle);
      setMessages((current) => current.filter((message) => message.receiptHandle !== receiptHandle));
    } catch (error) {
      setReceiveError(error instanceof Error ? error.message : "Failed to delete the message.");
    } finally {
      setDeletingHandle(null);
    }
  };

  const submitPurge = async () => {
    if (!resource || !canUseQueue) return;
    setPurgeError(null);
    setPurging(true);
    try {
      await purgeQueue(cloud, "messaging", resource.id);
      setPurged(true);
      setPurgeConfirming(false);
      setMessages([]);
    } catch (error) {
      setPurgeError(error instanceof Error ? error.message : "Failed to purge the queue.");
    } finally {
      setPurging(false);
    }
  };

  if (!resource || resource.service !== "messaging") {
    return (
      <section className="table-panel">
        <div className="empty compact">
          <h3>Select a queue</h3>
          <p>Select an SQS queue to send, receive, or purge its messages.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Queue Actions</p>
          <h3><Send size={15} /> Messages</h3>
          <p className="muted compact-text">
            Send, peek, and delete messages on this queue without leaving the console.
          </p>
        </div>
        <span className={`runtime-state ${canUseQueue ? "ready" : "pending"}`}>
          {canUseQueue ? "Ready" : runtimeReachable ? "Not a queue" : "Runtime unavailable"}
        </span>
      </div>

      <div className="resource-create-inline">
        <div className="drawer-tabs">
          <button type="button" className={`drawer-tab ${tab === "send" ? "active" : ""}`} onClick={() => changeTab("send")}>
            <Send size={13} /> Send
          </button>
          <button type="button" className={`drawer-tab ${tab === "receive" ? "active" : ""}`} onClick={() => changeTab("receive")}>
            <Inbox size={13} /> Receive
          </button>
          <button type="button" className={`drawer-tab ${tab === "purge" ? "active" : ""}`} onClick={() => changeTab("purge")}>
            <Trash2 size={13} /> Purge
          </button>
        </div>

        {tab === "send" && (
          <>
            <div style={{ marginBottom: "16px" }}>
              <label className="metric-label" htmlFor="sqs-message-body" style={{ display: "block", marginBottom: "6px" }}>Message body</label>
              <textarea
                id="sqs-message-body"
                className="json-editor"
                value={body}
                disabled={sending}
                onChange={(event) => setBody(event.target.value)}
                spellCheck={false}
                placeholder="Message body"
                style={{minHeight: 120, width: "100%", display: "block"}}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label className="metric-label" style={{ display: "block", marginBottom: "6px" }}>Custom attributes</label>
              <div style={{display: "flex", gap: "8px", marginBottom: "8px"}}>
                <input
                  type="text"
                  className="button"
                  placeholder="Key"
                  value={attrKey}
                  onChange={(e) => setAttrKey(e.target.value)}
                  disabled={sending}
                  maxLength={256}
                  style={{flex: 1, cursor: "text", padding: "4px 8px", minHeight: 32}}
                />
              <input
                type="text"
                className="button"
                placeholder="Value"
                value={attrValue}
                onChange={(e) => setAttrValue(e.target.value)}
                disabled={sending}
                style={{flex: 1, cursor: "text", padding: "4px 8px", minHeight: 32}}
              />
              <button
                className="button"
                type="button"
                disabled={!attrKey.trim() || !attrValue.trim() || Object.keys(customAttributes).length >= 10 || sending}
                title={Object.keys(customAttributes).length >= 10 ? "Maximum 10 attributes allowed" : ""}
                onClick={() => {
                  setCustomAttributes(prev => Object.fromEntries(
                    Object.entries(prev).concat([[attrKey.trim(), attrValue]])
                  ));
                  setAttrKey("");
                  setAttrValue("");
                }}
              >
                Add attribute
              </button>
            </div>
            {Object.keys(customAttributes).length > 0 && (
              <ul className="muted compact-text" style={{listStyle: "none", padding: 0, marginBottom: "16px"}}>
                {Object.entries(customAttributes).map(([k, v]) => (
                  <li key={k} style={{display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-muted)", padding: "4px 8px", borderRadius: "4px", marginBottom: "4px"}}>
                    <span style={{wordBreak: "break-all"}}><strong>{k}</strong>: {v}</span>
                    <button
                      className="button"
                      type="button"
                      disabled={sending}
                      aria-label="Remove attribute"
                      style={{padding: "2px 4px", minWidth: "unset"}}
                      onClick={() => {
                        setCustomAttributes(prev => Object.fromEntries(
                          Object.entries(prev).filter(([key]) => key !== k)
                        ));
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </div>

            <button
              className="button primary"
              type="button"
              disabled={!canUseQueue || !body || sending}
              onClick={() => void submitSend()}
            >
              {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              {sending ? "Sending" : "Send"}
            </button>
            {sendError && <p className="error-text compact-text">{sendError}</p>}
            {sendResult && (
              <p className="muted compact-text">
                Sent. Message ID <code>{sendResult.messageId}</code>
              </p>
            )}
          </>
        )}

        {tab === "receive" && (
          <>
            <p className="muted compact-text">
              A receive is a non-consuming peek: messages stay in the queue until you delete them here.
            </p>
            <label className="metric-label" htmlFor="sqs-max-messages">Max messages (up to 10)</label>
            <input
              id="sqs-max-messages"
              type="number"
              className="button"
              value={maxMessages}
              min={1}
              max={10}
              disabled={!canUseQueue || receiving}
              aria-label="Max messages to receive"
              style={{width: 64, padding: "2px 6px", textAlign: "center", marginBottom: 12, display: "block"}}
              onChange={(event) => {
                if (event.target.value === "") {
                  setMaxMessages("");
                } else {
                  const parsed = parseInt(event.target.value, 10);
                  if (!isNaN(parsed)) setMaxMessages(parsed);
                }
              }}
              onBlur={(event) => {
                const val = parseInt(event.target.value, 10);
                const clamped = isNaN(val) ? 1 : Math.min(10, Math.max(1, val));
                setMaxMessages(clamped);
              }}
            />
            <button
              className="button primary"
              type="button"
              disabled={!canUseQueue || receiving}
              onClick={() => void loadMessages()}
            >
              {receiving ? <Loader2 size={13} className="spin" /> : <Inbox size={13} />}
              {receiving ? "Receiving" : "Receive messages"}
            </button>
            {receiveError && <p className="error-text compact-text">{receiveError}</p>}
            {!receiving && messages.length === 0 && !hasPolled && (
              <p className="muted compact-text">No messages received yet. Click &ldquo;Receive messages&rdquo; to poll the queue.</p>
            )}
            {!receiving && messages.length === 0 && hasPolled && (
              <p className="muted compact-text"><strong>0</strong> messages received.</p>
            )}
            {!receiving && messages.length > 0 && (
              <p className="muted compact-text">
                <strong>{messages.length}</strong> message{messages.length !== 1 ? "s" : ""} received.
              </p>
            )}
            {messages.map((message) => (
              <div className="inspector-section" key={message.receiptHandle}>
                <div className="inspector-section-header">
                  <p className="metric-label">
                    <code>{message.messageId}</code>
                  </p>
                  <button
                    className="button"
                    type="button"
                    disabled={deletingHandle === message.receiptHandle}
                    onClick={() => void removeMessage(message.receiptHandle)}
                  >
                    {deletingHandle === message.receiptHandle ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Delete
                  </button>
                </div>
                <pre className="invoke-result success">{message.body}</pre>
                {message.messageAttributes && Object.keys(message.messageAttributes).length > 0 && (
                  <details style={{marginTop: 4}}>
                    <summary className="metric-label" style={{cursor: "pointer", userSelect: "none"}}>
                      Custom Attributes ({Object.keys(message.messageAttributes).length})
                    </summary>
                    <table style={{width: "100%", borderCollapse: "collapse", marginTop: 4, fontSize: "0.8em"}}>
                      <tbody>
                        {Object.entries(message.messageAttributes).map(([key, value]) => (
                          <tr key={key}>
                            <td className="metric-label" style={{paddingRight: 12, verticalAlign: "top", whiteSpace: "nowrap"}}>{key}</td>
                            <td><code style={{wordBreak: "break-all"}}>{value}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                {message.attributes && Object.keys(message.attributes).length > 0 && (
                  <details style={{marginTop: 4}}>
                    <summary className="metric-label" style={{cursor: "pointer", userSelect: "none"}}>
                      System Attributes ({Object.keys(message.attributes).length})
                    </summary>
                    <table style={{width: "100%", borderCollapse: "collapse", marginTop: 4, fontSize: "0.8em"}}>
                      <tbody>
                        {Object.entries(message.attributes).map(([key, value]) => (
                          <tr key={key}>
                            <td className="metric-label" style={{paddingRight: 12, verticalAlign: "top", whiteSpace: "nowrap"}}>{key}</td>
                            <td><code style={{wordBreak: "break-all"}}>{value}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "purge" && (
          <>
            <p className="muted compact-text">
              Purging deletes every message currently in this queue. This cannot be undone.
            </p>
            {!purgeConfirming ? (
              <button
                className="button"
                type="button"
                disabled={!canUseQueue}
                onClick={() => setPurgeConfirming(true)}
              >
                <Trash2 size={13} /> Purge queue
              </button>
            ) : (
              <div className="resource-create-inline">
                <p className="error-text compact-text">
                  Delete all messages in {resource.name}? This cannot be undone.
                </p>
                <button
                  className="button primary"
                  type="button"
                  disabled={purging}
                  onClick={() => void submitPurge()}
                >
                  {purging ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                  {purging ? "Purging" : "Confirm purge"}
                </button>
                <button className="button" type="button" disabled={purging} onClick={() => setPurgeConfirming(false)}>
                  Cancel
                </button>
              </div>
            )}
            {purgeError && <p className="error-text compact-text">{purgeError}</p>}
            {purged && <p className="muted compact-text">Queue purged.</p>}
          </>
        )}
      </div>
    </section>
  );
}
