import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { awsQueueSchema } from "../cloud-spi/queueSchema";
import type {
  CloudResource,
  CloudServiceAdapter,
  CreateResourceInput,
  ResourceQuery,
  ServiceSchema,
} from "../cloud-spi/types";
import { sqs as defaultSqs } from "../aws";

// SQS queue URLs contain slashes, so we key resources by queue NAME (the last
// URL segment) and resolve the URL on demand — keeps ids safe in route params.
function nameFromUrl(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? url;
}

export class AwsQueueAdapter implements CloudServiceAdapter {
  readonly cloud = "aws" as const;
  readonly service = "queue" as const;

  constructor(private readonly sqs: SQSClient = defaultSqs) {}

  schema(): ServiceSchema {
    return awsQueueSchema();
  }

  private async toResource(queueUrl: string): Promise<CloudResource> {
    let attrs: Record<string, string> = {};
    try {
      const res = await this.sqs.send(
        new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["All"] }),
      );
      attrs = res.Attributes ?? {};
    } catch {
      /* attributes are best-effort */
    }
    const created = attrs.CreatedTimestamp
      ? new Date(Number(attrs.CreatedTimestamp) * 1000).toISOString()
      : null;
    return {
      id: nameFromUrl(queueUrl),
      name: nameFromUrl(queueUrl),
      cloud: "aws",
      service: "queue",
      type: "queue",
      region: null,
      createdAt: created,
      status: null,
      metadata: {
        url: queueUrl,
        arn: attrs.QueueArn,
        messages: attrs.ApproximateNumberOfMessages,
        inFlight: attrs.ApproximateNumberOfMessagesNotVisible,
        delayed: attrs.ApproximateNumberOfMessagesDelayed,
        fifo: attrs.FifoQueue === "true",
        visibilityTimeout: attrs.VisibilityTimeout,
      },
    };
  }

  async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
    const res = await this.sqs.send(new ListQueuesCommand({}));
    const urls = res.QueueUrls ?? [];
    const resources = await Promise.all(urls.map((url) => this.toResource(url)));
    return filterBySearch(resources, query.search);
  }

  async get(id: string): Promise<CloudResource | null> {
    try {
      const res = await this.sqs.send(new GetQueueUrlCommand({ QueueName: id }));
      if (!res.QueueUrl) return null;
      return this.toResource(res.QueueUrl);
    } catch (error) {
      if (isNonExistentQueue(error)) return null;
      throw error;
    }
  }

  async create(input: CreateResourceInput): Promise<CloudResource> {
    const values = input.values;
    const queueName = String(values.queueName ?? values.name ?? "").trim();
    if (!queueName) throw new Error("queueName is required");
    const fifo = String(values.fifo ?? "false") === "true";

    const res = await this.sqs.send(
      new CreateQueueCommand({
        QueueName: queueName,
        ...(fifo ? { Attributes: { FifoQueue: "true" } } : {}),
      }),
    );
    return this.toResource(res.QueueUrl ?? queueName);
  }

  async delete(id: string): Promise<void> {
    const res = await this.sqs.send(new GetQueueUrlCommand({ QueueName: id }));
    if (res.QueueUrl) {
      await this.sqs.send(new DeleteQueueCommand({ QueueUrl: res.QueueUrl }));
    }
  }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
  const normalized = search?.trim().toLowerCase();
  if (!normalized) return resources;
  return resources.filter((r) => r.name.toLowerCase().includes(normalized));
}

function isNonExistentQueue(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "QueueDoesNotExist";
}
