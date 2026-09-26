import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  HardDrive,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  createLambdaTrigger,
  deleteLambdaTrigger,
  listCloudResources,
  listLambdaTriggers,
} from "@/api/cloudProxyClient";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource, CreateLambdaTriggerInput, LambdaTrigger } from "@/types/resource";

interface LambdaTriggerPanelProps {
  cloud: CloudProvider;
  resource: CloudResource;
  runtimeReachable: boolean;
  initialRegisterOpen?: boolean;
  onClose?: () => void;
}

type TriggerType = "s3" | "dynamodb" | "sqs" | "kinesis";

const S3_EVENT_OPTIONS = [
  { value: "s3:ObjectCreated:*", label: "All object create events (s3:ObjectCreated:*)" },
  { value: "s3:ObjectCreated:Put", label: "Put (s3:ObjectCreated:Put)" },
  { value: "s3:ObjectCreated:Post", label: "Post (s3:ObjectCreated:Post)" },
  { value: "s3:ObjectCreated:Copy", label: "Copy (s3:ObjectCreated:Copy)" },
  { value: "s3:ObjectCreated:CompleteMultipartUpload", label: "Complete Multipart Upload" },
  { value: "s3:ObjectRemoved:*", label: "All object removal events (s3:ObjectRemoved:*)" },
  { value: "s3:ObjectRemoved:Delete", label: "Delete (s3:ObjectRemoved:Delete)" },
];

export function LambdaTriggerPanel({
  cloud,
  resource,
  runtimeReachable,
  initialRegisterOpen = true,
  onClose,
}: LambdaTriggerPanelProps) {
  const qc = useQueryClient();
  const [isRegisterOpen, setIsRegisterOpen] = useState(initialRegisterOpen);
  const [selectedType, setSelectedType] = useState<TriggerType>("s3");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    resetForm();
    setIsRegisterOpen(initialRegisterOpen);
    setDeletingId(null);
  }, [resource.id, initialRegisterOpen]);

  // Form State
  // S3
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Events, setS3Events] = useState<string[]>(["s3:ObjectCreated:*"]);
  const [s3Prefix, setS3Prefix] = useState("");
  const [s3Suffix, setS3Suffix] = useState("");

  // DynamoDB
  const [dynamoTable, setDynamoTable] = useState("");
  const [dynamoBatchSize, setDynamoBatchSize] = useState(100);
  const [dynamoPosition, setDynamoPosition] = useState<"LATEST" | "TRIM_HORIZON">("LATEST");
  const [dynamoEnabled, setDynamoEnabled] = useState(true);

  // SQS
  const [sqsQueue, setSqsQueue] = useState("");
  const [sqsBatchSize, setSqsBatchSize] = useState(10);
  const [sqsEnabled, setSqsEnabled] = useState(true);

  // Kinesis
  const [kinesisStream, setKinesisStream] = useState("");
  const [kinesisBatchSize, setKinesisBatchSize] = useState(100);
  const [kinesisPosition, setKinesisPosition] = useState<"LATEST" | "TRIM_HORIZON">("LATEST");
  const [kinesisEnabled, setKinesisEnabled] = useState(true);

  const [formError, setFormError] = useState<string | null>(null);

  // Query triggers
  const triggersQuery = useQuery({
    queryKey: ["lambda-triggers", cloud, resource.id],
    queryFn: ({ signal }) => listLambdaTriggers(cloud, resource.id, signal),
    enabled: cloud === "aws" && runtimeReachable,
  });

  // Query resources for dropdown helpers
  const storageBucketsQuery = useQuery({
    queryKey: ["cloud-resources", cloud, "storage"],
    queryFn: ({ signal }) => listCloudResources(cloud, "storage", undefined, signal),
    enabled: cloud === "aws" && isRegisterOpen && selectedType === "s3",
  });

  const dynamoTablesQuery = useQuery({
    queryKey: ["cloud-resources", cloud, "nosql"],
    queryFn: ({ signal }) => listCloudResources(cloud, "nosql", undefined, signal),
    enabled: cloud === "aws" && isRegisterOpen && selectedType === "dynamodb",
  });

  const sqsQueuesQuery = useQuery({
    queryKey: ["cloud-resources", cloud, "messaging"],
    queryFn: ({ signal }) => listCloudResources(cloud, "messaging", undefined, signal),
    enabled: cloud === "aws" && isRegisterOpen && selectedType === "sqs",
  });

  const kinesisStreamsQuery = useQuery({
    queryKey: ["cloud-resources", cloud, "streams"],
    queryFn: ({ signal }) => listCloudResources(cloud, "streams", undefined, signal),
    enabled: cloud === "aws" && isRegisterOpen && selectedType === "kinesis",
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (input: CreateLambdaTriggerInput) =>
      createLambdaTrigger(cloud, resource.id, input),
    onSuccess: () => {
      setIsRegisterOpen(false);
      setFormError(null);
      resetForm();
      void qc.invalidateQueries({ queryKey: ["lambda-triggers", cloud, resource.id] });
    },
    onError: (err: Error) => {
      setFormError(err.message || "Failed to register trigger.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (trigger: LambdaTrigger) => {
      return deleteLambdaTrigger(cloud, resource.id, trigger.id, {
        type: trigger.type,
        bucket: trigger.type === "s3" ? trigger.sourceName : undefined,
      });
    },
    onSuccess: () => {
      setDeletingId(null);
      void qc.invalidateQueries({ queryKey: ["lambda-triggers", cloud, resource.id] });
    },
  });

  const resetForm = () => {
    setS3Bucket("");
    setS3Events(["s3:ObjectCreated:*"]);
    setS3Prefix("");
    setS3Suffix("");
    setDynamoTable("");
    setDynamoBatchSize(100);
    setDynamoPosition("LATEST");
    setDynamoEnabled(true);
    setSqsQueue("");
    setSqsBatchSize(10);
    setSqsEnabled(true);
    setKinesisStream("");
    setKinesisBatchSize(100);
    setKinesisPosition("LATEST");
    setKinesisEnabled(true);
    setFormError(null);
  };

  const handleToggleS3Event = (evt: string) => {
    setS3Events((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt],
    );
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (selectedType === "s3") {
      if (!s3Bucket.trim()) {
        setFormError("Please select or enter an S3 bucket name.");
        return;
      }
      if (s3Events.length === 0) {
        setFormError("Please select at least one S3 event type.");
        return;
      }
      createMutation.mutate({
        type: "s3",
        bucketName: s3Bucket.trim(),
        events: s3Events,
        prefix: s3Prefix.trim() || undefined,
        suffix: s3Suffix.trim() || undefined,
      });
    } else if (selectedType === "dynamodb") {
      if (!dynamoTable.trim()) {
        setFormError("Please select or enter a DynamoDB table name.");
        return;
      }
      createMutation.mutate({
        type: "dynamodb",
        tableName: dynamoTable.trim(),
        batchSize: Number(dynamoBatchSize) || 100,
        startingPosition: dynamoPosition,
        enabled: dynamoEnabled,
      });
    } else if (selectedType === "sqs") {
      if (!sqsQueue.trim()) {
        setFormError("Please select or enter an SQS queue name or URL.");
        return;
      }
      createMutation.mutate({
        type: "sqs",
        queueNameOrUrl: sqsQueue.trim(),
        batchSize: Number(sqsBatchSize) || 10,
        enabled: sqsEnabled,
      });
    } else if (selectedType === "kinesis") {
      if (!kinesisStream.trim()) {
        setFormError("Please select or enter a Kinesis stream name.");
        return;
      }
      createMutation.mutate({
        type: "kinesis",
        streamName: kinesisStream.trim(),
        batchSize: Number(kinesisBatchSize) || 100,
        startingPosition: kinesisPosition,
        enabled: kinesisEnabled,
      });
    }
  };

  const triggers = triggersQuery.data ?? [];

  return (
    <section className="inspector-section" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "14px", marginBottom: "14px" }}>
      <div
        className="inspector-section-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "10px",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <Zap size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <p className="metric-label" style={{ margin: 0, fontWeight: 600, whiteSpace: "nowrap" }}>
            Triggers ({triggers.length})
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <button
            className="button compact"
            type="button"
            title="Refresh triggers"
            disabled={triggersQuery.isFetching}
            onClick={() => triggersQuery.refetch()}
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RefreshCw size={12} className={triggersQuery.isFetching ? "spin" : ""} />
          </button>
          <button
            className="button success compact"
            type="button"
            style={{
              flexShrink: 0,
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
            onClick={() => {
              setIsRegisterOpen((prev) => !prev);
              setFormError(null);
            }}
          >
            <Plus size={13} style={{ flexShrink: 0 }} />
            <span>{isRegisterOpen ? "Close Trigger Form" : "Register Trigger"}</span>
            {isRegisterOpen ? <ChevronUp size={12} style={{ flexShrink: 0 }} /> : <ChevronDown size={12} style={{ flexShrink: 0 }} />}
          </button>
          {onClose && (
            <button
              className="button compact"
              type="button"
              title="Close trigger panel"
              onClick={onClose}
              style={{
                marginLeft: "4px",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Registration Form */}
      {isRegisterOpen && (
        <form
          onSubmit={handleRegisterSubmit}
          style={{
            background: "var(--bg-card, #161b22)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "12px",
            marginBottom: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              minWidth: 0,
            }}
          >
            <span
              title={`Add Trigger to ${resource.name}`}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              Add Trigger to {resource.name}
            </span>
            <span className="badge neutral compact" style={{ flexShrink: 0 }}>
              AWS
            </span>
          </div>

          {/* Trigger Source Type Selector */}
          <div>
            <label className="metric-label" style={{ display: "block", marginBottom: "4px" }}>
              Trigger Source
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
              <button
                type="button"
                className={`button compact ${selectedType === "s3" ? "primary" : ""}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
                onClick={() => setSelectedType("s3")}
              >
                <HardDrive size={13} />
                S3
              </button>
              <button
                type="button"
                className={`button compact ${selectedType === "dynamodb" ? "primary" : ""}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
                onClick={() => setSelectedType("dynamodb")}
              >
                <Database size={13} />
                DynamoDB
              </button>
              <button
                type="button"
                className={`button compact ${selectedType === "sqs" ? "primary" : ""}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
                onClick={() => setSelectedType("sqs")}
              >
                <MessageSquare size={13} />
                SQS
              </button>
              <button
                type="button"
                className={`button compact ${selectedType === "kinesis" ? "primary" : ""}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
                onClick={() => setSelectedType("kinesis")}
              >
                <Activity size={13} />
                Kinesis
              </button>
            </div>
          </div>

          {/* S3 Options */}
          {selectedType === "s3" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>
                <label className="metric-label" htmlFor="trigger-s3-bucket" style={{ display: "block", marginBottom: "3px" }}>
                  S3 Bucket *
                </label>
                {storageBucketsQuery.data && storageBucketsQuery.data.length > 0 ? (
                  <select
                    id="trigger-s3-bucket"
                    className="input"
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                  >
                    <option value="">Select an S3 bucket...</option>
                    {storageBucketsQuery.data.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="trigger-s3-bucket"
                    className="input"
                    placeholder="e.g. my-s3-bucket"
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                  />
                )}
              </div>

              <div>
                <label className="metric-label" style={{ display: "block", marginBottom: "4px" }}>
                  Event Types *
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "120px", overflowY: "auto" }}>
                  {S3_EVENT_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={s3Events.includes(opt.value)}
                        onChange={() => handleToggleS3Event(opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label className="metric-label" htmlFor="trigger-s3-prefix" style={{ display: "block", marginBottom: "3px" }}>
                    Prefix Filter (Optional)
                  </label>
                  <input
                    id="trigger-s3-prefix"
                    className="input"
                    placeholder="e.g. uploads/ or images/"
                    value={s3Prefix}
                    onChange={(e) => setS3Prefix(e.target.value)}
                  />
                </div>
                <div>
                  <label className="metric-label" htmlFor="trigger-s3-suffix" style={{ display: "block", marginBottom: "3px" }}>
                    Suffix Filter (Optional)
                  </label>
                  <input
                    id="trigger-s3-suffix"
                    className="input"
                    placeholder="e.g. .jpg or .json"
                    value={s3Suffix}
                    onChange={(e) => setS3Suffix(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* DynamoDB Options */}
          {selectedType === "dynamodb" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>
                <label className="metric-label" htmlFor="trigger-dynamo-table" style={{ display: "block", marginBottom: "3px" }}>
                  DynamoDB Table *
                </label>
                {dynamoTablesQuery.data && dynamoTablesQuery.data.length > 0 ? (
                  <select
                    id="trigger-dynamo-table"
                    className="input"
                    value={dynamoTable}
                    onChange={(e) => setDynamoTable(e.target.value)}
                  >
                    <option value="">Select a DynamoDB table...</option>
                    {dynamoTablesQuery.data.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="trigger-dynamo-table"
                    className="input"
                    placeholder="e.g. users-table"
                    value={dynamoTable}
                    onChange={(e) => setDynamoTable(e.target.value)}
                  />
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label className="metric-label" htmlFor="trigger-dynamo-batch" style={{ display: "block", marginBottom: "3px" }}>
                    Batch Size (1 - 10000)
                  </label>
                  <input
                    id="trigger-dynamo-batch"
                    type="number"
                    className="input"
                    min={1}
                    max={10000}
                    value={dynamoBatchSize}
                    onChange={(e) => setDynamoBatchSize(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="metric-label" htmlFor="trigger-dynamo-pos" style={{ display: "block", marginBottom: "3px" }}>
                    Starting Position
                  </label>
                  <select
                    id="trigger-dynamo-pos"
                    className="input"
                    value={dynamoPosition}
                    onChange={(e) => setDynamoPosition(e.target.value as "LATEST" | "TRIM_HORIZON")}
                  >
                    <option value="LATEST">LATEST</option>
                    <option value="TRIM_HORIZON">TRIM_HORIZON</option>
                  </select>
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={dynamoEnabled}
                  onChange={(e) => setDynamoEnabled(e.target.checked)}
                />
                <span>Enable trigger immediately</span>
              </label>
            </div>
          )}

          {/* SQS Options */}
          {selectedType === "sqs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>
                <label className="metric-label" htmlFor="trigger-sqs-queue" style={{ display: "block", marginBottom: "3px" }}>
                  SQS Queue *
                </label>
                {sqsQueuesQuery.data && sqsQueuesQuery.data.length > 0 ? (
                  <select
                    id="trigger-sqs-queue"
                    className="input"
                    value={sqsQueue}
                    onChange={(e) => setSqsQueue(e.target.value)}
                  >
                    <option value="">Select an SQS queue...</option>
                    {sqsQueuesQuery.data.map((q) => (
                      <option key={q.id} value={q.name}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="trigger-sqs-queue"
                    className="input"
                    placeholder="e.g. order-events-queue"
                    value={sqsQueue}
                    onChange={(e) => setSqsQueue(e.target.value)}
                  />
                )}
              </div>

              <div>
                <label className="metric-label" htmlFor="trigger-sqs-batch" style={{ display: "block", marginBottom: "3px" }}>
                  Batch Size (1 - 10000)
                </label>
                <input
                  id="trigger-sqs-batch"
                  type="number"
                  className="input"
                  min={1}
                  max={10000}
                  value={sqsBatchSize}
                  onChange={(e) => setSqsBatchSize(Number(e.target.value))}
                />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={sqsEnabled}
                  onChange={(e) => setSqsEnabled(e.target.checked)}
                />
                <span>Enable trigger immediately</span>
              </label>
            </div>
          )}

          {/* Kinesis Options */}
          {selectedType === "kinesis" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>
                <label className="metric-label" htmlFor="trigger-kinesis-stream" style={{ display: "block", marginBottom: "3px" }}>
                  Kinesis Stream *
                </label>
                {kinesisStreamsQuery.data && kinesisStreamsQuery.data.length > 0 ? (
                  <select
                    id="trigger-kinesis-stream"
                    className="input"
                    value={kinesisStream}
                    onChange={(e) => setKinesisStream(e.target.value)}
                  >
                    <option value="">Select a Kinesis stream...</option>
                    {kinesisStreamsQuery.data.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="trigger-kinesis-stream"
                    className="input"
                    placeholder="e.g. telemetry-stream"
                    value={kinesisStream}
                    onChange={(e) => setKinesisStream(e.target.value)}
                  />
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label className="metric-label" htmlFor="trigger-kinesis-batch" style={{ display: "block", marginBottom: "3px" }}>
                    Batch Size
                  </label>
                  <input
                    id="trigger-kinesis-batch"
                    type="number"
                    className="input"
                    value={kinesisBatchSize}
                    onChange={(e) => setKinesisBatchSize(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="metric-label" htmlFor="trigger-kinesis-pos" style={{ display: "block", marginBottom: "3px" }}>
                    Starting Position
                  </label>
                  <select
                    id="trigger-kinesis-pos"
                    className="input"
                    value={kinesisPosition}
                    onChange={(e) => setKinesisPosition(e.target.value as "LATEST" | "TRIM_HORIZON")}
                  >
                    <option value="LATEST">LATEST</option>
                    <option value="TRIM_HORIZON">TRIM_HORIZON</option>
                  </select>
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={kinesisEnabled}
                  onChange={(e) => setKinesisEnabled(e.target.checked)}
                />
                <span>Enable trigger immediately</span>
              </label>
            </div>
          )}

          {formError && (
            <p className="error-text compact-text" style={{ margin: 0 }}>
              {formError}
            </p>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px", marginTop: "4px" }}>
            <button
              className="button compact"
              type="button"
              disabled={createMutation.isPending}
              onClick={() => {
                setIsRegisterOpen(false);
                resetForm();
              }}
            >
              Cancel
            </button>
            <button
              className="button success compact"
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
              {createMutation.isPending ? "Registering..." : "Add Trigger"}
            </button>
          </div>
        </form>
      )}

      {/* Triggers List */}
      {triggersQuery.isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--muted)", padding: "8px 0" }}>
          <Loader2 size={13} className="spin" />
          <span>Loading attached triggers...</span>
        </div>
      ) : triggers.length === 0 ? (
        <div className="empty compact" style={{ padding: "12px", textAlign: "center" }}>
          <p className="muted compact-text" style={{ margin: 0 }}>
            No triggers attached to this function yet.
          </p>
          <p className="muted compact-text" style={{ fontSize: "11px", marginTop: "4px" }}>
            Click &ldquo;Register Trigger&rdquo; to configure S3, DynamoDB, SQS, or Kinesis events.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {triggers.map((trig) => {
            const isDeletingThis = deletingId === trig.id;
            return (
              <div
                key={trig.id}
                style={{
                  background: "var(--bg-card, #161b22)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {trig.type === "s3" && <HardDrive size={14} style={{ color: "#38bdf8" }} />}
                    {trig.type === "dynamodb" && <Database size={14} style={{ color: "#34d399" }} />}
                    {trig.type === "sqs" && <MessageSquare size={14} style={{ color: "#fbbf24" }} />}
                    {trig.type === "kinesis" && <Activity size={14} style={{ color: "#f472b6" }} />}
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>
                      {trig.sourceName}
                    </span>
                    <span className="badge neutral compact">{trig.type.toUpperCase()}</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      className={`runtime-state compact ${
                        trig.status.toLowerCase() === "enabled" || trig.status.toLowerCase() === "active"
                          ? "ready"
                          : "pending"
                      }`}
                    >
                      {trig.status}
                    </span>

                    {isDeletingThis ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <button
                          className="button danger compact"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(trig)}
                        >
                          {deleteMutation.isPending ? <Loader2 size={11} className="spin" /> : <Trash2 size={11} />}
                          Confirm
                        </button>
                        <button
                          className="button compact"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => setDeletingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="button compact danger"
                        type="button"
                        title="Remove trigger"
                        disabled={deleteMutation.isPending}
                        onClick={() => setDeletingId(trig.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Trigger Details */}
                <div style={{ fontSize: "11px", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "2px" }}>
                  <div style={{ wordBreak: "break-all" }}>
                    <strong>Source ARN:</strong> {trig.sourceArn}
                  </div>
                  {trig.type === "s3" && (
                    <>
                      {trig.details.events && trig.details.events.length > 0 && (
                        <div>
                          <strong>Events:</strong> {trig.details.events.join(", ")}
                        </div>
                      )}
                      {trig.details.prefix && (
                        <div>
                          <strong>Prefix:</strong> <code>{trig.details.prefix}</code>
                        </div>
                      )}
                      {trig.details.suffix && (
                        <div>
                          <strong>Suffix:</strong> <code>{trig.details.suffix}</code>
                        </div>
                      )}
                    </>
                  )}
                  {(trig.type === "dynamodb" || trig.type === "sqs" || trig.type === "kinesis") && (
                    <div style={{ display: "flex", gap: "12px" }}>
                      {trig.details.batchSize !== undefined && (
                        <span><strong>Batch Size:</strong> {trig.details.batchSize}</span>
                      )}
                      {trig.details.startingPosition && (
                        <span><strong>Position:</strong> {trig.details.startingPosition}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
