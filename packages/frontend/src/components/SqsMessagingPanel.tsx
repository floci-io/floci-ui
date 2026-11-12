import {useEffect, useRef, useState} from "react";
import {Icon, Inbox, Loader2, Send, Trash2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {Textarea} from '@/components/sodium/ui/textarea'
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
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/sodium/ui/collapsible'
import {EmptyState} from '@/components/EmptyState'

interface SqsMessagingPanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
  onMessagesChanged?: () => void;
}

type MessagingTab = "send" | "receive" | "purge";

export function SqsMessagingPanel({cloud, resource, runtimeReachable, onMessagesChanged}: SqsMessagingPanelProps) {
  const isOci = cloud === "oci";
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
  }, [accountId, cloud, resource?.id]);

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
      const result = await sendQueueMessage(cloud, "messaging", resource.id, body, !isOci && Object.keys(customAttributes).length > 0 ? customAttributes : undefined);
      setSendResult({messageId: result.messageId});
      setBody("");
      setCustomAttributes({});
      onMessagesChanged?.();
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
      onMessagesChanged?.();
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
      onMessagesChanged?.();
    } catch (error) {
      setReceiveError(error instanceof Error ? error.message : "Failed to delete the message.");
    } finally {
      setDeletingHandle(null);
    }
  };

  const submitPurge = async () => {
    if (!resource || !canUseQueue || isOci) return;
    setPurgeError(null);
    setPurging(true);
    try {
      await purgeQueue(cloud, "messaging", resource.id);
      setPurged(true);
      setPurgeConfirming(false);
      setMessages([]);
      onMessagesChanged?.();
    } catch (error) {
      setPurgeError(error instanceof Error ? error.message : "Failed to purge the queue.");
    } finally {
      setPurging(false);
    }
  };

  if (!resource || resource.service !== "messaging") {
    return (
      <section className="table-panel">
        <EmptyState compact title="Select a queue" description={<>{isOci ? "Select an OCI queue to send, receive, or delete its messages." : "Select an SQS queue to send, receive, or purge its messages."}</>}/>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Queue Actions</p>
          <h2><Icon icon={Send}  /> Messages</h2>
          <p className="muted compact-text">
            {isOci ? "Send, receive, and delete OCI Queue messages here." : "Send, peek, and delete messages on this queue without leaving the console."}
          </p>
          {isOci && <p className="muted compact-text">Channels and long polling are not available here because these shared controls use immediate, unfiltered receives.</p>}
        </div>
        <span className={`runtime-state ${canUseQueue ? "ready" : "pending"}`}>
          {canUseQueue ? "Ready" : runtimeReachable ? "Not a queue" : "Runtime unavailable"}
        </span>
      </div>

      <div className="resource-create-inline">
        <div className="drawer-tabs">
          <Button variant={tab === "send" ? 'secondary' : 'ghost'} type="button" onClick={() => changeTab("send")}>
            <Icon icon={Send} size={14} /> Send
          </Button>
          <Button variant={tab === "receive" ? 'secondary' : 'ghost'} type="button" onClick={() => changeTab("receive")}>
            <Icon icon={Inbox} size={14} /> Receive
          </Button>
          {!isOci && (
            <Button variant={tab === "purge" ? 'secondary' : 'ghost'} type="button" onClick={() => changeTab("purge")}>
              <Icon icon={Trash2} size={14} /> Purge
            </Button>
          )}
        </div>

        {tab === "send" && (
          <>
            <div className="mb-4">
              <label className="metric-label block mb-1.5" htmlFor="sqs-message-body">Message body</label>
              <Textarea
                id="sqs-message-body"
                className="json-editor w-full block"
                value={body}
                disabled={sending}
                onChange={(event) => setBody(event.target.value)}
                spellCheck={false}
                placeholder="Message body"
              />
            </div>

            {!isOci && <div className="mb-4">
              <label className="metric-label block mb-1.5">Custom attributes</label>
              <div className="flex gap-2 mb-2">
                <Input aria-label="Attribute key"
                  type="text"
                  className="button flex-1 cursor-text"
                  placeholder="Key"
                  value={attrKey}
                  onChange={(e) => setAttrKey(e.target.value)}
                  disabled={sending}
                  maxLength={256}
                />
              <Input aria-label="Attribute value"
                type="text"
                className="button flex-1 cursor-text"
                placeholder="Value"
                value={attrValue}
                onChange={(e) => setAttrValue(e.target.value)}
                disabled={sending}
              />
              <Button title={Object.keys(customAttributes).length >= 10 ? "Maximum 10 attributes allowed" : ""} variant="secondary"
                type="button"
                disabled={!attrKey.trim() || !attrValue.trim() || Object.keys(customAttributes).length >= 10 || sending}
                onClick={() => {
                  setCustomAttributes(prev => Object.fromEntries(
                    Object.entries(prev).concat([[attrKey.trim(), attrValue]])
                  ));
                  setAttrKey("");
                  setAttrValue("");
                }}
              >
                Add attribute
              </Button>
            </div>
            {Object.keys(customAttributes).length > 0 && (
              <ul className="muted compact-text p-0 mb-4 list-none">
                {Object.entries(customAttributes).map(([k, v]) => (
                  <li className="flex justify-between items-center py-1 px-2 mb-1 bg-well" key={k}>
                    <span className="break-all"><strong>{k}</strong>: {v}</span>
                    <Button variant="secondary"
                      className="min-w-0"
                      type="button"
                      disabled={sending}
                      aria-label="Remove attribute"
                      onClick={() => {
                        setCustomAttributes(prev => Object.fromEntries(
                          Object.entries(prev).filter(([key]) => key !== k)
                        ));
                      }}
                    >
                      <Icon icon={Trash2} size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            </div>}

            <Button
              type="button"
              disabled={!canUseQueue || !body || sending}
              onClick={() => void submitSend()}
            >
              {sending ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Send} size={14} />}
              {sending ? "Sending" : "Send"}
            </Button>
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
              {isOci
                ? "Receives use the queue visibility timeout. Delete a message here, or it becomes available again when a nonzero timeout expires."
                : "A receive is a non-consuming peek: messages stay in the queue until you delete them here."}
            </p>
            <label className="metric-label" htmlFor="sqs-max-messages">Max messages (up to 10)</label>
            <Input
              id="sqs-max-messages"
              type="number"
              className="button w-16 text-center mb-3 block"
              value={String(maxMessages)}
              min={1}
              max={10}
              disabled={!canUseQueue || receiving}
              aria-label="Max messages to receive"
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
            <Button
              type="button"
              disabled={!canUseQueue || receiving}
              onClick={() => void loadMessages()}
            >
              {receiving ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Inbox} size={14} />}
              {receiving ? "Receiving" : "Receive messages"}
            </Button>
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
                  <Button variant="secondary"
                    type="button"
                    disabled={deletingHandle === message.receiptHandle}
                    onClick={() => void removeMessage(message.receiptHandle)}
                  >
                    {deletingHandle === message.receiptHandle ? (
                      <Icon icon={Loader2} size={14} className="spin" />
                    ) : (
                      <Icon icon={Trash2} size={14} />
                    )}
                    Delete
                  </Button>
                </div>
                <pre className="invoke-result success">{message.body}</pre>
                {message.messageAttributes && Object.keys(message.messageAttributes).length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger>Custom Attributes ({Object.keys(message.messageAttributes).length})</CollapsibleTrigger>
                    <CollapsibleContent>
                    <table className="w-full border-collapse mt-1 type-caption">
                      <tbody>
                        {Object.entries(message.messageAttributes).map(([key, attribute]) => (
                          <tr key={key}>
                            <td className="metric-label pr-3 align-top whitespace-nowrap">{key}</td>
                            <td className="metric-label pr-3 align-top whitespace-nowrap">{attribute.dataType}</td>
                            <td><code className="break-all">{attribute.value}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CollapsibleContent>
                  </Collapsible>
                )}
                {message.attributes && Object.keys(message.attributes).length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger>System Attributes ({Object.keys(message.attributes).length})</CollapsibleTrigger>
                    <CollapsibleContent>
                    <table className="w-full border-collapse mt-1 type-caption">
                      <tbody>
                        {Object.entries(message.attributes).map(([key, value]) => (
                          <tr key={key}>
                            <td className="metric-label pr-3 align-top whitespace-nowrap">{key}</td>
                            <td><code className="break-all">{value}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            ))}
          </>
        )}

        {tab === "purge" && !isOci && (
          <>
            <p className="muted compact-text">
              Purging deletes every message currently in this queue. This cannot be undone.
            </p>
            {!purgeConfirming ? (
              <Button variant="secondary"
                type="button"
                disabled={!canUseQueue}
                onClick={() => setPurgeConfirming(true)}
              >
                <Icon icon={Trash2} size={14} /> Purge queue
              </Button>
            ) : (
              <div className="resource-create-inline">
                <p className="error-text compact-text">
                  Delete all messages in {resource.name}? This cannot be undone.
                </p>
                <Button
                  type="button"
                  disabled={purging}
                  onClick={() => void submitPurge()}
                >
                  {purging ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Trash2} size={14} />}
                  {purging ? "Purging" : "Confirm purge"}
                </Button>
                <Button variant="secondary" type="button" disabled={purging} onClick={() => setPurgeConfirming(false)}>
                  Cancel
                </Button>
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
