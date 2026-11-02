import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {Icon, Activity, CheckSquared as Check, ChevronDown, ChevronUp, DatabaseSquared as Database, HardDrive, Loader2, MessageSquare, PlusSquared as Plus, RefreshCwSquared as RefreshCw, Trash2, XSquared as X, ZapSquared as Zap} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import {
  createLambdaTrigger,
  deleteLambdaTrigger,
  listCloudResources,
  listLambdaTriggers,
} from "@/api/cloudProxyClient";
import type { CloudProvider } from "@/types/cloud";
import type { CloudResource, CreateLambdaTriggerInput, LambdaTrigger } from "@/types/resource";
import {Checkbox} from '@/components/sodium/ui/checkbox'
import {Hint} from '@/components/Hint'

interface LambdaTriggerPanelProps {
  cloud: CloudProvider;
  resource: CloudResource;
  runtimeReachable: boolean;
  initialRegisterOpen?: boolean;
  onClose?: () => void;
}

type TriggerType = "s3" | "dynamodb" | "sqs" | "kinesis";

function formatOptionLabel(label: string, maxLength = 35): string {
  if (label.length <= maxLength) return label;
  const keep = Math.floor((maxLength - 1) / 2);
  return `${label.slice(0, keep)}…${label.slice(-keep)}`;
}

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
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    resetForm();
    setIsRegisterOpen(initialRegisterOpen);
    setDeletingId(null);
    setDeleteError(null);
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
      setDeleteError(null);
      void qc.invalidateQueries({ queryKey: ["lambda-triggers", cloud, resource.id] });
    },
    onError: (err: Error) => {
      setDeleteError(err.message || "Failed to delete trigger.");
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
    <section className="inspector-section border-b border-line pb-3.5 mb-3.5">
      <div
        className="inspector-section-header flex items-center justify-between gap-2 mb-2.5 min-w-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon icon={Zap} className="text-accent-text shrink-0"  />
          <p className="metric-label m-0 whitespace-nowrap">
            Triggers ({triggers.length})
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Hint label="Refresh triggers"><Button variant="secondary" size="sm"
            className="shrink-0 inline-flex items-center justify-center"
            type="button"
            disabled={triggersQuery.isFetching}
            onClick={() => triggersQuery.refetch()}
          >
            <Icon icon={RefreshCw} size={14} className={triggersQuery.isFetching ? "spin" : ""} />
          </Button></Hint>
          <Button variant="secondary" size="sm"
            className="success shrink-0 whitespace-nowrap inline-flex items-center gap-1.5"
            type="button"
            onClick={() => {
              setIsRegisterOpen((prev) => !prev);
              setFormError(null);
            }}
          >
            <Icon icon={Plus} className="shrink-0" size={14} />
            <span>{isRegisterOpen ? "Close Trigger Form" : "Register Trigger"}</span>
            {isRegisterOpen ? <Icon icon={ChevronUp} className="shrink-0" size={14} /> : <Icon icon={ChevronDown} className="shrink-0" size={14} />}
          </Button>
          {onClose && (
            <Hint label="Close trigger panel"><Button variant="secondary" size="sm"
              className="ml-1 shrink-0 inline-flex items-center justify-center"
              type="button"
              onClick={onClose}
            >
              <Icon icon={X} size={14} />
            </Button></Hint>
          )}
        </div>
      </div>

      {/* Registration Form */}
      {isRegisterOpen && (
        <form className="p-3 mb-3.5 flex flex-col gap-2.5 bg-well border border-line"
          onSubmit={handleRegisterSubmit}
        >
          <div className="flex items-center justify-between gap-2 min-w-0"
          >
            <span className="type-caption text-text-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
              title={`Add Trigger to ${resource.name}`}
            >
              Add Trigger to {resource.name}
            </span>
            <span className="badge neutral compact shrink-0">
              AWS
            </span>
          </div>

          {/* Trigger Source Type Selector */}
          <div>
            <label className="metric-label block mb-1">
              Trigger Source
            </label>
            <div className="grid gap-1.5 grid-cols-4">
              <Button size="sm" variant={selectedType === "s3" ? 'primary' : 'secondary'}
                type="button" className="flex items-center justify-center gap-1 min-w-0"
                onClick={() => setSelectedType("s3")}
              >
                <Icon icon={HardDrive} className="shrink-0" size={14} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">S3</span>
              </Button>
              <Button size="sm" variant={selectedType === "dynamodb" ? 'primary' : 'secondary'}
                type="button" className="flex items-center justify-center gap-1 min-w-0"
                onClick={() => setSelectedType("dynamodb")}
              >
                <Icon icon={Database} className="shrink-0" size={14} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">DynamoDB</span>
              </Button>
              <Button size="sm" variant={selectedType === "sqs" ? 'primary' : 'secondary'}
                type="button" className="flex items-center justify-center gap-1 min-w-0"
                onClick={() => setSelectedType("sqs")}
              >
                <Icon icon={MessageSquare} className="shrink-0" size={14} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">SQS</span>
              </Button>
              <Button size="sm" variant={selectedType === "kinesis" ? 'primary' : 'secondary'}
                type="button" className="flex items-center justify-center gap-1 min-w-0"
                onClick={() => setSelectedType("kinesis")}
              >
                <Icon icon={Activity} className="shrink-0" size={14} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">Kinesis</span>
              </Button>
            </div>
          </div>

          {/* S3 Options */}
          {selectedType === "s3" && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="metric-label block mb-1" htmlFor="trigger-s3-bucket">
                  S3 Bucket *
                </label>
                {storageBucketsQuery.data && storageBucketsQuery.data.length > 0 ? (
                  <OptionSelect
                    id="trigger-s3-bucket" className="w-full min-w-0"
                    value={s3Bucket}
                    onValueChange={(value) => setS3Bucket(value)}
                  >
                    <option value="">Select an S3 bucket</option>
                    {storageBucketsQuery.data.map((b) => (
                      <option className="w-full" key={b.id} value={b.name} title={b.name}>
                        {formatOptionLabel(b.name)}
                      </option>
                    ))}
                  </OptionSelect>
                ) : (
                  <Input
                    id="trigger-s3-bucket"
                    className="w-full min-w-0"
                    placeholder="e.g. my-s3-bucket"
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                  />
                )}
              </div>

              <div>
                <label className="metric-label block mb-1">
                  Event Types *
                </label>
                <div className="flex flex-col gap-1 max-h-30 overflow-y-auto">
                  {S3_EVENT_OPTIONS.map((opt) => (
                    <label className="flex items-center gap-1.5 type-caption text-text-1 cursor-pointer"
                      key={opt.value}
                    >
                      <Checkbox
                        checked={s3Events.includes(opt.value)}
                        onCheckedChange={() => handleToggleS3Event(opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 grid-cols-2">
                <div className="min-w-0">
                  <label className="metric-label block mb-1" htmlFor="trigger-s3-prefix">
                    Prefix Filter (Optional)
                  </label>
                  <Input
                    id="trigger-s3-prefix"
                    className="w-full min-w-0"
                    placeholder="e.g. uploads/ or images/"
                    value={s3Prefix}
                    onChange={(e) => setS3Prefix(e.target.value)}
                  />
                </div>
                <div className="min-w-0">
                  <label className="metric-label block mb-1" htmlFor="trigger-s3-suffix">
                    Suffix Filter (Optional)
                  </label>
                  <Input
                    id="trigger-s3-suffix"
                    className="w-full min-w-0"
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
            <div className="flex flex-col gap-2">
              <div>
                <label className="metric-label block mb-1" htmlFor="trigger-dynamo-table">
                  DynamoDB Table *
                </label>
                {dynamoTablesQuery.data && dynamoTablesQuery.data.length > 0 ? (
                  <OptionSelect
                    id="trigger-dynamo-table" className="w-full min-w-0"
                    value={dynamoTable}
                    onValueChange={(value) => setDynamoTable(value)}
                  >
                    <option value="">Select a DynamoDB table...</option>
                    {dynamoTablesQuery.data.map((t) => (
                      <option key={t.id} value={t.name} title={t.name}>
                        {formatOptionLabel(t.name)}
                      </option>
                    ))}
                  </OptionSelect>
                ) : (
                  <Input
                    id="trigger-dynamo-table"
                    className="w-full min-w-0"
                    placeholder="e.g. users-table"
                    value={dynamoTable}
                    onChange={(e) => setDynamoTable(e.target.value)}
                  />
                )}
              </div>

              <div className="grid gap-2 grid-cols-2">
                <div className="min-w-0">
                  <label className="metric-label block mb-1" htmlFor="trigger-dynamo-batch">
                    Batch Size (1 - 10000)
                  </label>
                  <Input
                    id="trigger-dynamo-batch"
                    type="number"
                    className="w-full min-w-0"
                    min={1}
                    max={10000}
                    value={String(dynamoBatchSize)}
                    onChange={(e) => setDynamoBatchSize(Number(e.target.value))}
                  />
                </div>
                <div className="min-w-0">
                  <label className="metric-label block mb-1" htmlFor="trigger-dynamo-pos">
                    Starting Position
                  </label>
                  <OptionSelect
                    id="trigger-dynamo-pos" className="w-full min-w-0"
                    value={dynamoPosition}
                    onValueChange={(value) => setDynamoPosition(value as "LATEST" | "TRIM_HORIZON")}
                  >
                    <option value="LATEST">LATEST</option>
                    <option value="TRIM_HORIZON">TRIM_HORIZON</option>
                  </OptionSelect>
                </div>
              </div>

              <label className="flex items-center gap-1.5 type-caption cursor-pointer">
                <Checkbox
                  checked={dynamoEnabled}
                  onCheckedChange={(checked) => setDynamoEnabled(checked)}
                />
                <span>Enable trigger immediately</span>
              </label>
            </div>
          )}

          {/* SQS Options */}
          {selectedType === "sqs" && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="metric-label block mb-1" htmlFor="trigger-sqs-queue">
                  SQS Queue *
                </label>
                {sqsQueuesQuery.data && sqsQueuesQuery.data.length > 0 ? (
                  <OptionSelect
                    id="trigger-sqs-queue" className="w-full min-w-0"
                    value={sqsQueue}
                    onValueChange={(value) => setSqsQueue(value)}
                  >
                    <option value="">Select an SQS queue...</option>
                    {sqsQueuesQuery.data.map((q) => (
                      <option key={q.id} value={q.name} title={q.name}>
                        {formatOptionLabel(q.name)}
                      </option>
                    ))}
                  </OptionSelect>
                ) : (
                  <Input
                    id="trigger-sqs-queue"
                    className="w-full min-w-0"
                    placeholder="e.g. order-events-queue"
                    value={sqsQueue}
                    onChange={(e) => setSqsQueue(e.target.value)}
                  />
                )}
              </div>

              <div>
                <label className="metric-label block mb-1" htmlFor="trigger-sqs-batch">
                  Batch Size (1 - 10000)
                </label>
                <Input
                  id="trigger-sqs-batch"
                  type="number"
                  className="w-full min-w-0"
                  min={1}
                  max={10000}
                  value={String(sqsBatchSize)}
                  onChange={(e) => setSqsBatchSize(Number(e.target.value))}
                />
              </div>

              <label className="flex items-center gap-1.5 type-caption cursor-pointer">
                <Checkbox
                  checked={sqsEnabled}
                  onCheckedChange={(checked) => setSqsEnabled(checked)}
                />
                <span>Enable trigger immediately</span>
              </label>
            </div>
          )}

          {/* Kinesis Options */}
          {selectedType === "kinesis" && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="metric-label block mb-1" htmlFor="trigger-kinesis-stream">
                  Kinesis Stream *
                </label>
                {kinesisStreamsQuery.data && kinesisStreamsQuery.data.length > 0 ? (
                  <OptionSelect
                    id="trigger-kinesis-stream" className="w-full min-w-0"
                    value={kinesisStream}
                    onValueChange={(value) => setKinesisStream(value)}
                  >
                    <option value="">Select a Kinesis stream...</option>
                    {kinesisStreamsQuery.data.map((s) => (
                      <option key={s.id} value={s.name} title={s.name}>
                        {formatOptionLabel(s.name)}
                      </option>
                    ))}
                  </OptionSelect>
                ) : (
                  <Input
                    id="trigger-kinesis-stream"
                    className="w-full min-w-0"
                    placeholder="e.g. telemetry-stream"
                    value={kinesisStream}
                    onChange={(e) => setKinesisStream(e.target.value)}
                  />
                )}
              </div>

              <div className="grid gap-2 grid-cols-2">
                <div className="min-w-0">
                  <label className="metric-label block mb-1" htmlFor="trigger-kinesis-batch">
                    Batch Size
                  </label>
                  <Input
                    id="trigger-kinesis-batch"
                    type="number"
                    className="w-full min-w-0"
                    value={String(kinesisBatchSize)}
                    onChange={(e) => setKinesisBatchSize(Number(e.target.value))}
                  />
                </div>
                <div className="min-w-0">
                  <label className="metric-label block mb-1" htmlFor="trigger-kinesis-pos">
                    Starting Position
                  </label>
                  <OptionSelect
                    id="trigger-kinesis-pos" className="w-full min-w-0"
                    value={kinesisPosition}
                    onValueChange={(value) => setKinesisPosition(value as "LATEST" | "TRIM_HORIZON")}
                  >
                    <option value="LATEST">LATEST</option>
                    <option value="TRIM_HORIZON">TRIM_HORIZON</option>
                  </OptionSelect>
                </div>
              </div>

              <label className="flex items-center gap-1.5 type-caption cursor-pointer">
                <Checkbox
                  checked={kinesisEnabled}
                  onCheckedChange={(checked) => setKinesisEnabled(checked)}
                />
                <span>Enable trigger immediately</span>
              </label>
            </div>
          )}

          {formError && (
            <p className="error-text compact-text m-0">
              {formError}
            </p>
          )}

          <div className="flex items-center justify-end gap-1.5 mt-1">
            <Button variant="secondary" size="sm"
              type="button"
              disabled={createMutation.isPending}
              onClick={() => {
                setIsRegisterOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button variant="secondary" size="sm"
              className="success"
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Check} size={14} />}
              {createMutation.isPending ? "Registering..." : "Add Trigger"}
            </Button>
          </div>
        </form>
      )}

      {/* Triggers List */}
      {triggersQuery.isLoading ? (
        <div className="flex items-center gap-1.5 type-caption text-text-3 py-2 px-0">
          <Icon icon={Loader2} size={14} className="spin" />
          <span>Loading attached triggers...</span>
        </div>
      ) : triggers.length === 0 ? (
        <div className="empty compact p-3 text-center">
          <p className="muted compact-text m-0">
            No triggers attached to this function yet.
          </p>
          <p className="muted compact-text type-caption mt-1">
            Click &ldquo;Register Trigger&rdquo; to configure S3, DynamoDB, SQS, or Kinesis events.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {triggers.map((trig) => {
            const isDeletingThis = deletingId === trig.id;
            return (
              <div className="p-2.5 flex flex-col gap-1.5 bg-well border border-line"
                key={trig.id}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {trig.type === "s3" && <Icon icon={HardDrive} size={14} className="text-data-1" />}
                    {trig.type === "dynamodb" && <Icon icon={Database} size={14} className="text-data-2" />}
                    {trig.type === "sqs" && <Icon icon={MessageSquare} size={14} className="text-data-3" />}
                    {trig.type === "kinesis" && <Icon icon={Activity} size={14} className="text-data-4" />}
                    <span className="type-caption text-text-1">
                      {trig.sourceName}
                    </span>
                    <span className="badge neutral compact">{trig.type.toUpperCase()}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`runtime-state compact ${trig.status.toLowerCase() === "enabled" || trig.status.toLowerCase() === "active"
                        ? "ready"
                        : "pending"
                        }`}
                    >
                      {trig.status}
                    </span>

                    {isDeletingThis ? (
                      <div className="flex items-center gap-1">
                        <Button variant="destructive" size="sm"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(trig)}
                        >
                          {deleteMutation.isPending ? <Icon icon={Loader2} size={14} className="spin" /> : <Icon icon={Trash2} size={14} />}
                          Confirm
                        </Button>
                        <Button variant="secondary" size="sm"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            setDeletingId(null);
                            setDeleteError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Hint label="Remove trigger"><Button variant="destructive" size="sm"
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          setDeletingId(trig.id);
                          setDeleteError(null);
                        }}
                      >
                        <Icon icon={Trash2} size={14} />
                      </Button></Hint>
                    )}
                  </div>
                </div>

                {/* Trigger Details */}
                <div className="type-caption text-text-3 flex flex-col gap-0.5">
                  <div className="break-all">
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
                    <div className="flex gap-3">
                      {trig.details.batchSize !== undefined && (
                        <span><strong>Batch Size:</strong> {trig.details.batchSize}</span>
                      )}
                      {trig.details.startingPosition && (
                        <span><strong>Position:</strong> {trig.details.startingPosition}</span>
                      )}
                    </div>
                  )}
                </div>

                {isDeletingThis && deleteError && (
                  <p className="error-text compact-text mt-1 mx-0 mb-0">
                    {deleteError}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
