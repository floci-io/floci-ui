import {useEffect, useState} from "react";
import {Inbox, Loader2, MessageSquare, RefreshCw, Send, Trash2} from "lucide-react";
import {useMutation, useQuery} from "@tanstack/react-query";
import {
  deleteQueueMessage,
  purgeQueue,
  receiveQueueMessages,
  sendQueueMessage,
  type SendMessageResult,
} from "@/api/cloudProxyClient";
import type {CloudProvider} from "@/types/cloud";
import type {CloudResource, QueueMessage} from "@/types/resource";

interface QueuePanelProps {
  cloud: CloudProvider;
  resource?: CloudResource;
  runtimeReachable: boolean;
}

export function QueuePanel({cloud, resource, runtimeReachable}: QueuePanelProps) {
  const [messageBody, setMessageBody] = useState("");
  const [sendResult, setSendResult] = useState<SendMessageResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  useEffect(() => {
    setMessageBody("");
    setSendResult(null);
    setSendError(null);
    setOpError(null);
  }, [resource?.id]);

  const isQueue = resource?.service === "queue" && resource.type === "queue";
  const canAct = Boolean(resource && isQueue && runtimeReachable);

  const sendMutation = useMutation({
    mutationFn: () =>
      sendQueueMessage(cloud, "queue", resource!.id, messageBody),
    onSuccess: (result) => {
      setSendResult(result);
      setSendError(null);
      setMessageBody("");
      void messagesQuery.refetch();
    },
    onError: (error) => {
      setSendError(error instanceof Error ? error.message : "Failed to send message");
    },
  });

  const messagesQuery = useQuery({
    queryKey: ["queue-messages", cloud, resource?.id],
    queryFn: ({signal}) =>
      receiveQueueMessages(cloud, "queue", resource!.id, 10, signal),
    enabled: canAct,
  });

  const deleteMessageMutation = useMutation({
    mutationFn: (receiptHandle: string) =>
      deleteQueueMessage(cloud, "queue", resource!.id, receiptHandle),
    onSuccess: () => {
      setOpError(null);
      void messagesQuery.refetch();
    },
    onError: (error) => {
      setOpError(error instanceof Error ? error.message : "Failed to delete message");
    },
  });

  const purgeMutation = useMutation({
    mutationFn: () => purgeQueue(cloud, "queue", resource!.id),
    onSuccess: () => {
      setOpError(null);
      void messagesQuery.refetch();
    },
    onError: (error) => {
      setOpError(error instanceof Error ? error.message : "Failed to purge queue");
    },
  });

  if (!resource || resource.service !== "queue") {
    return (
      <section className="table-panel">
        <div className="empty compact">
          <h3>Select a queue</h3>
          <p>
            Select an SQS queue to send a message and view the messages it
            currently holds.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <div className="dynamic-stage-header">
        <div>
          <p className="eyebrow">Queue Actions</p>
          <h3>
            <MessageSquare size={15} />
            {resource.name}
          </h3>
          <p className="muted compact-text">
            Send a message to this SQS queue and receive the messages it
            currently holds.
          </p>
        </div>
        <span className={`runtime-state ${canAct ? "ready" : "pending"}`}>
          {canAct ? "Ready" : "Runtime unavailable"}
        </span>
      </div>

      <div className="resource-create-inline">
        <div className="inspector-section-header">
          <label className="metric-label" htmlFor="queue-message-body">
            Message body
          </label>
        </div>
        <textarea
          id="queue-message-body"
          className="json-editor"
          value={messageBody}
          onChange={(event) => setMessageBody(event.target.value)}
          placeholder="Enter the message body to send"
          style={{minHeight: 120}}
          spellCheck={false}
        />
        <button
          className="button primary"
          type="button"
          disabled={!canAct || !messageBody.trim() || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
        >
          {sendMutation.isPending ? (
            <Loader2 size={13} />
          ) : (
            <Send size={13} />
          )}
          {sendMutation.isPending ? "Sending" : "Send message"}
        </button>

        {sendError && (
          <p className="error-text compact-text">{sendError}</p>
        )}

        {sendResult && (
          <p className="muted compact-text">
            Sent · Message ID <code>{sendResult.messageId}</code>
          </p>
        )}

        <div className="inspector-section-header" style={{marginTop: 16}}>
          <p className="metric-label">Messages in queue</p>
          <div className="button-row">
            <button
              className="button"
              type="button"
              disabled={!canAct || messagesQuery.isFetching}
              onClick={() => messagesQuery.refetch()}
            >
              <RefreshCw size={13} />
              {messagesQuery.isFetching ? "Loading" : "Receive"}
            </button>
            <button
              className="button danger"
              type="button"
              disabled={!canAct || purgeMutation.isPending}
              onClick={() => purgeMutation.mutate()}
            >
              {purgeMutation.isPending ? (
                <Loader2 size={13} />
              ) : (
                <Trash2 size={13} />
              )}
              {purgeMutation.isPending ? "Purging" : "Purge queue"}
            </button>
          </div>
        </div>

        {opError && (
          <p className="error-text compact-text">{opError}</p>
        )}

        {messagesQuery.isError ? (
          <p className="error-text compact-text">
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : "Failed to receive messages"}
          </p>
        ) : messagesQuery.isLoading ? (
          <p className="muted compact-text">Reading messages from the queue.</p>
        ) : (messagesQuery.data?.length ?? 0) === 0 ? (
          <div className="empty compact">
            <Inbox size={18} />
            <p>No messages available in this queue right now.</p>
          </div>
        ) : (
          <div className="queue-message-list">
            {messagesQuery.data?.map((message) => (
              <QueueMessageRow
                key={message.messageId}
                message={message}
                onDelete={() => deleteMessageMutation.mutate(message.receiptHandle)}
                isDeleting={deleteMessageMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function QueueMessageRow({
  message,
  onDelete,
  isDeleting,
}: {
  message: QueueMessage;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview =
    message.body.length > 160 ? `${message.body.slice(0, 160)}…` : message.body;

  return (
    <div className="queue-message-row">
      <div className="queue-message-head">
        <code className="queue-message-id">{message.messageId}</code>
        {message.md5OfBody && (
          <span className="badge neutral">md5 {message.md5OfBody}</span>
        )}
        <button
          className="button compact"
          type="button"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Collapse" : "View body"}
        </button>
        <button
          className="button compact danger"
          type="button"
          disabled={isDeleting}
          onClick={onDelete}
          title="Delete this message"
        >
          {isDeleting ? <Loader2 size={13} /> : <Trash2 size={13} />}
          Delete
        </button>
      </div>
      {expanded ? (
        <pre className="invoke-result success">{message.body || "(empty)"}</pre>
      ) : (
        <p className="muted compact-text mono">{preview || "(empty)"}</p>
      )}
    </div>
  );
}