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
  const [messages, setMessages] = useState<QueueMessage[]>([]);
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
    setMessages([]);
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
      const result = await sendQueueMessage(cloud, "messaging", resource.id, body);
      setSendResult({messageId: result.messageId});
      setBody("");
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
      const received = await receiveQueueMessages(cloud, "messaging", resource.id, 10);
      setMessages(received);
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
            <label className="metric-label" htmlFor="sqs-message-body">Message body</label>
            <textarea
              id="sqs-message-body"
              className="json-editor"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              spellCheck={false}
              placeholder="Message body"
              style={{minHeight: 120}}
            />
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
            {!receiving && messages.length === 0 && (
              <p className="muted compact-text">No messages received yet.</p>
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
