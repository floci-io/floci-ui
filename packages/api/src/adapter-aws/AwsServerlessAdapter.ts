import { NotFoundError, ValidationError } from '../cloud-spi/errors'
import {
  AddPermissionCommand,
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  DeleteEventSourceMappingCommand,
  DeleteFunctionCommand,
  GetEventSourceMappingCommand,
  GetFunctionCommand,
  InvokeCommand,
  type InvokeCommandOutput,
  ListEventSourceMappingsCommand,
  type ListEventSourceMappingsCommandOutput,
  ListFunctionsCommand,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import {
  GetBucketNotificationConfigurationCommand,
  type GetBucketNotificationConfigurationCommandOutput,
  ListBucketsCommand,
  PutBucketNotificationConfigurationCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  DescribeTableCommand,
  UpdateTableCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import {
  DescribeStreamSummaryCommand,
  type KinesisClient,
} from "@aws-sdk/client-kinesis";
import { awsServerlessSchema } from "../cloud-spi/serverlessSchema";
import type {
  CloudResource,
  CloudServiceAdapter,
  CreateLambdaTriggerInput,
  CreateResourceInput,
  DeleteLambdaTriggerOptions,
  LambdaTrigger,
  ResourceQuery,
  ServerlessInvokeResult,
  ServiceSchema,
} from "../cloud-spi/types";
import {
  dynamodb as defaultDynamoDb,
  kinesis as defaultKinesis,
  lambda as defaultLambda,
  s3 as defaultS3,
  sqs as defaultSqs,
} from "../aws";
import { createZipArchive, handlerFileName } from "./zipArchive";

export class AwsServerlessAdapter implements CloudServiceAdapter {
  readonly cloud = "aws" as const;
  readonly service = "serverless" as const;

  constructor(
    private readonly lambda: LambdaClient = defaultLambda,
    private readonly s3: S3Client = defaultS3,
    private readonly dynamodb: DynamoDBClient = defaultDynamoDb,
    private readonly sqs: SQSClient = defaultSqs,
    private readonly kinesis: KinesisClient = defaultKinesis,
  ) {}

  schema(): ServiceSchema {
    return awsServerlessSchema();
  }

  async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
    const res = await this.lambda.send(new ListFunctionsCommand({}));
    const resources: CloudResource[] = (res.Functions ?? []).map((fn) => ({
      id: fn.FunctionName ?? fn.FunctionArn ?? "",
      name: fn.FunctionName ?? "",
      cloud: "aws" as const,
      service: "serverless" as const,
      type: "lambda",
      region: null,
      createdAt: null,
      status: fn.State ?? null,
      metadata: {
        arn: fn.FunctionArn,
        runtime: fn.Runtime,
        handler: fn.Handler,
        lastModified: fn.LastModified,
        memorySize: fn.MemorySize,
        timeout: fn.Timeout,
        codeSize: fn.CodeSize,
        packageType: fn.PackageType,
        description: fn.Description,
      },
    }));

    return filterBySearch(resources, query.search);
  }

  async get(id: string): Promise<CloudResource | null> {
    try {
      const res = await this.lambda.send(
        new GetFunctionCommand({ FunctionName: id }),
      );
      const config = res.Configuration;

      if (!config) return null;

      return {
        id: config.FunctionName ?? config.FunctionArn ?? id,
        name: config.FunctionName ?? id,
        cloud: "aws",
        service: "serverless",
        type: "lambda",
        region: null,
        createdAt: null,
        status: config.State ?? null,
        metadata: {
  arn: config.FunctionArn,
  runtime: config.Runtime,
  handler: config.Handler,
  lastModified: config.LastModified,
  memorySize: config.MemorySize,
  timeout: config.Timeout,
  codeSize: config.CodeSize,
  packageType: config.PackageType,
  description: config.Description,
  role: config.Role,
  version: config.Version,
  codeSha256: config.CodeSha256,
  environment: config.Environment?.Variables,
},
      };
    } catch (error) {
      if (hasHttpStatus(error, 404)) return null;
      throw error;
    }
  }

  async create(input: CreateResourceInput): Promise<CloudResource> {
    const values = input.values;

    const functionName = String(
      values.functionName ?? values.name ?? "",
    ).trim();
    const runtime = String(values.runtime ?? "").trim();
    const handler = String(values.handler ?? "").trim();
    const role = String(values.role ?? "").trim();
    const description = String(values.description ?? "").trim();
    const memorySize = Number(values.memorySize ?? 128);
    const timeout = Number(values.timeout ?? 3);
    const code =
      String(values.code ?? "").trim() ||
      `
exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Hello from Floci Cloud Explorer",
      event
    })
  };
};
`.trim();

    if (!functionName) throw new ValidationError("functionName is required");
    if (!runtime) throw new ValidationError("runtime is required");
    if (!handler) throw new ValidationError("handler is required");
    if (!role) throw new ValidationError("role is required");

    const res = await this.lambda.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: runtime as never,
        Handler: handler,
        Role: role,
        Description: description || undefined,
        MemorySize: Number.isFinite(memorySize) ? memorySize : 128,
        Timeout: Number.isFinite(timeout) ? timeout : 3,
        Code: {
          // Must be a real archive: the runtime looks for the handler's module
          // inside it, so raw source text is rejected outright.
          ZipFile: createZipArchive([
            { name: handlerFileName(handler, runtime), content: code },
          ]),
        },
      }),
    );

    return {
      id: res.FunctionName ?? res.FunctionArn ?? functionName,
      name: res.FunctionName ?? functionName,
      cloud: "aws",
      service: "serverless",
      type: "lambda",
      region: null,
      createdAt: null,
      status: res.State ?? null,
      metadata: {
        arn: res.FunctionArn,
        runtime: res.Runtime,
        handler: res.Handler,
        lastModified: res.LastModified,
        memorySize: res.MemorySize,
        timeout: res.Timeout,
        codeSize: res.CodeSize,
        packageType: res.PackageType,
        description: res.Description,
        role: res.Role,
        version: res.Version,
        codeSha256: res.CodeSha256,
      },
    };
  }

  async delete(id: string): Promise<void> {
    await this.lambda.send(new DeleteFunctionCommand({ FunctionName: id }));
  }

  async invoke(id: string, payload: string): Promise<ServerlessInvokeResult> {
    const startedAt = performance.now();
    const res = await this.lambda.send(
      new InvokeCommand({
        FunctionName: id,
        Payload: new TextEncoder().encode(payload || "{}"),
        // Tail returns the last 4 KB of the execution log, base64 encoded.
        LogType: "Tail",
      }),
    );
    const executionDuration = Math.round(performance.now() - startedAt);

    return {
      statusCode: res.StatusCode ?? 0,
      payload: decodePayload(res.Payload),
      ...(res.FunctionError ? { functionError: res.FunctionError } : {}),
      ...(res.LogResult ? { logResult: decodeLogResult(res.LogResult) } : {}),
      executionDuration,
    };
  }

  async listLambdaTriggers(functionName: string): Promise<LambdaTrigger[]> {
    const triggers: LambdaTrigger[] = [];

    // Resolve function to ensure it exists and get ARN
    const fnResource = await this.get(functionName);
    const fnArn = (fnResource?.metadata?.arn as string) || "";

    // 1. Fetch Event Source Mappings with pagination loop
    let nextMarker: string | undefined = undefined;
    do {
      const res: ListEventSourceMappingsCommandOutput = await this.lambda.send(
        new ListEventSourceMappingsCommand({
          FunctionName: functionName,
          Marker: nextMarker,
        }),
      );
      for (const esm of res.EventSourceMappings ?? []) {
        const arn = esm.EventSourceArn ?? "";
        let type: 'dynamodb' | 'sqs' | 'kinesis' = 'dynamodb';
        let sourceName = arn;

        if (arn.includes(":dynamodb:") || arn.includes(":table/")) {
          type = "dynamodb";
          sourceName = arn.split(":table/")[1]?.split("/")[0] ?? arn;
        } else if (arn.includes(":sqs:")) {
          type = "sqs";
          sourceName = arn.split(":").pop() ?? arn;
        } else if (arn.includes(":kinesis:")) {
          type = "kinesis";
          sourceName = arn.split(":stream/")[1] ?? arn;
        }

        triggers.push({
          id: esm.UUID ?? "",
          type,
          sourceArn: arn,
          sourceName,
          status: esm.State ?? "Enabled",
          createdAt: esm.LastModified
            ? (typeof esm.LastModified === "number"
                ? new Date(esm.LastModified * 1000).toISOString()
                : new Date(esm.LastModified).toISOString())
            : null,
          details: {
            batchSize: esm.BatchSize,
            startingPosition: esm.StartingPosition,
            filterCriteria: esm.FilterCriteria?.Filters
              ? { filters: esm.FilterCriteria.Filters }
              : undefined,
          },
        });
      }
      nextMarker = res.NextMarker;
    } while (nextMarker);

    // 2. Fetch S3 Bucket Notifications targeting this Lambda
    const bucketsRes = await this.s3.send(new ListBucketsCommand({}));

    for (const bucket of bucketsRes.Buckets ?? []) {
      if (!bucket.Name) continue;
      try {
        const config = await this.s3.send(
          new GetBucketNotificationConfigurationCommand({ Bucket: bucket.Name }),
        );
        for (const [index, conf] of (config.LambdaFunctionConfigurations ?? []).entries()) {
          const confArn = conf.LambdaFunctionArn ?? "";
          const isMatch =
            (Boolean(fnArn) && confArn === fnArn) ||
            confArn.endsWith(`:${functionName}`) ||
            confArn === functionName;

          if (isMatch) {
            const prefix = conf.Filter?.Key?.FilterRules?.find(
              (r) => r.Name?.toLowerCase() === "prefix",
            )?.Value;
            const suffix = conf.Filter?.Key?.FilterRules?.find(
              (r) => r.Name?.toLowerCase() === "suffix",
            )?.Value;

            triggers.push({
              id: conf.Id ?? `${bucket.Name}-${index}`,
              type: "s3",
              sourceArn: `arn:aws:s3:::${bucket.Name}`,
              sourceName: bucket.Name,
              status: "Active",
              createdAt: bucket.CreationDate
                ? new Date(bucket.CreationDate).toISOString()
                : null,
              details: {
                events: conf.Events ? [...conf.Events] : ["s3:ObjectCreated:*"],
                prefix,
                suffix,
              },
            });
          }
        }
      } catch (bucketErr) {
        if (!hasHttpStatus(bucketErr, 403) && !hasHttpStatus(bucketErr, 404)) {
          // Tolerable per-bucket lookup failure
        }
      }
    }

    return triggers;
  }

  async createLambdaTrigger(
    functionName: string,
    input: CreateLambdaTriggerInput,
  ): Promise<LambdaTrigger> {
    if (!input.type) throw new ValidationError("Trigger type is required");

    if (input.type === "s3") {
      const bucketName = String(input.bucketName ?? "").trim();
      if (!bucketName) throw new ValidationError("bucketName is required for S3 trigger");

      const fn = await this.get(functionName);
      if (!fn) throw new NotFoundError(`Function ${functionName} not found`);
      const fnArn = (fn?.metadata?.arn as string) || `arn:aws:lambda:us-east-1:000000000000:function:${functionName}`;

      // 1. Ensure invocation permission for S3 with deterministic StatementId
      const statementId = `s3-trigger-${functionName}-${bucketName}`;
      try {
        await this.lambda.send(
          new AddPermissionCommand({
            FunctionName: functionName,
            StatementId: statementId,
            Action: "lambda:InvokeFunction",
            Principal: "s3.amazonaws.com",
            SourceArn: `arn:aws:s3:::${bucketName}`,
          }),
        );
      } catch {
        // Ignore if permission already exists or conflict
      }

      // 2. Read existing configuration without masking errors
      const current = await this.s3.send(
        new GetBucketNotificationConfigurationCommand({ Bucket: bucketName }),
      );

      const lambdaConfigs = [...(current.LambdaFunctionConfigurations ?? [])];
      const triggerId = `lambda-trigger-${Date.now()}`;
      const filterRules: Array<{ Name: "prefix" | "suffix"; Value: string }> = [];

      if (input.prefix) filterRules.push({ Name: "prefix", Value: input.prefix });
      if (input.suffix) filterRules.push({ Name: "suffix", Value: input.suffix });

      lambdaConfigs.push({
        Id: triggerId,
        LambdaFunctionArn: fnArn,
        Events: input.events && input.events.length > 0 ? (input.events as never) : ["s3:ObjectCreated:*"],
        Filter: filterRules.length > 0 ? { Key: { FilterRules: filterRules } } : undefined,
      });

      await this.s3.send(
        new PutBucketNotificationConfigurationCommand({
          Bucket: bucketName,
          NotificationConfiguration: {
            ...current,
            LambdaFunctionConfigurations: lambdaConfigs,
          },
        }),
      );

      return {
        id: triggerId,
        type: "s3",
        sourceArn: `arn:aws:s3:::${bucketName}`,
        sourceName: bucketName,
        status: "Active",
        createdAt: new Date().toISOString(),
        details: {
          events: input.events && input.events.length > 0 ? input.events : ["s3:ObjectCreated:*"],
          prefix: input.prefix,
          suffix: input.suffix,
        },
      };
    }

    if (input.type === "dynamodb") {
      const tableName = String(input.tableName ?? "").trim();
      if (!tableName) throw new ValidationError("tableName is required for DynamoDB trigger");

      let streamArn = "";
      let sourceName = tableName;

      if (tableName.startsWith("arn:aws:dynamodb:") && tableName.includes("/stream/")) {
        streamArn = tableName;
        sourceName = tableName.split(":table/")[1]?.split("/")[0] ?? tableName;
      } else {
        sourceName = tableName;
        const desc = await this.dynamodb.send(
          new DescribeTableCommand({ TableName: tableName }),
        );
        streamArn = desc.Table?.LatestStreamArn ?? "";

        if (!streamArn) {
          await this.dynamodb.send(
            new UpdateTableCommand({
              TableName: tableName,
              StreamSpecification: {
                StreamEnabled: true,
                StreamViewType: "NEW_AND_OLD_IMAGES",
              },
            }),
          );
          const reDesc = await this.dynamodb.send(
            new DescribeTableCommand({ TableName: tableName }),
          );
          streamArn = reDesc.Table?.LatestStreamArn ?? "";
        }
      }

      if (!streamArn) {
        throw new ValidationError(`DynamoDB stream is not enabled or stream ARN could not be resolved for table: ${tableName}`);
      }

      const res = await this.lambda.send(
        new CreateEventSourceMappingCommand({
          FunctionName: functionName,
          EventSourceArn: streamArn,
          BatchSize: Number.isFinite(input.batchSize) ? input.batchSize : 100,
          StartingPosition: input.startingPosition ?? "LATEST",
          Enabled: input.enabled ?? true,
        }),
      );

      return {
        id: res.UUID ?? "",
        type: "dynamodb",
        sourceArn: streamArn,
        sourceName,
        status: res.State ?? "Enabled",
        createdAt: new Date().toISOString(),
        details: {
          batchSize: res.BatchSize ?? input.batchSize ?? 100,
          startingPosition: res.StartingPosition ?? input.startingPosition ?? "LATEST",
        },
      };
    }

    if (input.type === "sqs") {
      const queueInput = String(input.queueNameOrUrl ?? "").trim();
      if (!queueInput) throw new ValidationError("queueNameOrUrl is required for SQS trigger");

      let queueArn = "";
      let queueName = queueInput;

      if (queueInput.startsWith("arn:aws:sqs:")) {
        queueArn = queueInput;
        queueName = queueInput.split(":").pop() ?? queueInput;
      } else if (queueInput.startsWith("http://") || queueInput.startsWith("https://")) {
        queueName = queueInput.split("/").pop() ?? queueInput;
        const attrs = await this.sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: queueInput,
            AttributeNames: ["QueueArn"],
          }),
        );
        queueArn = attrs.Attributes?.QueueArn ?? "";
      } else {
        queueName = queueInput;
        const urlRes = await this.sqs.send(
          new GetQueueUrlCommand({ QueueName: queueInput }),
        );
        if (!urlRes.QueueUrl) {
          throw new ValidationError(`Failed to resolve QueueUrl for queue: ${queueInput}`);
        }
        const attrs = await this.sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: urlRes.QueueUrl,
            AttributeNames: ["QueueArn"],
          }),
        );
        queueArn = attrs.Attributes?.QueueArn ?? "";
      }

      if (!queueArn) {
        throw new ValidationError(`Failed to resolve QueueArn for queue: ${queueInput}`);
      }

      const res = await this.lambda.send(
        new CreateEventSourceMappingCommand({
          FunctionName: functionName,
          EventSourceArn: queueArn,
          BatchSize: Number.isFinite(input.batchSize) ? input.batchSize : 10,
          Enabled: input.enabled ?? true,
        }),
      );

      return {
        id: res.UUID ?? "",
        type: "sqs",
        sourceArn: queueArn,
        sourceName: queueName,
        status: res.State ?? "Enabled",
        createdAt: new Date().toISOString(),
        details: {
          batchSize: res.BatchSize ?? input.batchSize ?? 10,
        },
      };
    }

    if (input.type === "kinesis") {
      const streamInput = String(input.streamName ?? "").trim();
      if (!streamInput) throw new ValidationError("streamName is required for Kinesis trigger");

      let streamArn = "";
      let streamName = streamInput;

      if (streamInput.startsWith("arn:aws:kinesis:")) {
        streamArn = streamInput;
        streamName = streamInput.split(":stream/")[1] ?? streamInput;
      } else {
        streamName = streamInput;
        const desc = await this.kinesis.send(
          new DescribeStreamSummaryCommand({ StreamName: streamName }),
        );
        streamArn = desc.StreamDescriptionSummary?.StreamARN ?? "";
      }

      if (!streamArn) {
        throw new ValidationError(`Failed to resolve Kinesis Stream ARN for stream: ${streamInput}`);
      }

      const res = await this.lambda.send(
        new CreateEventSourceMappingCommand({
          FunctionName: functionName,
          EventSourceArn: streamArn,
          BatchSize: Number.isFinite(input.batchSize) ? input.batchSize : 100,
          StartingPosition: input.startingPosition ?? "LATEST",
          Enabled: input.enabled ?? true,
        }),
      );

      return {
        id: res.UUID ?? "",
        type: "kinesis",
        sourceArn: streamArn,
        sourceName: streamName,
        status: res.State ?? "Enabled",
        createdAt: new Date().toISOString(),
        details: {
          batchSize: res.BatchSize ?? input.batchSize ?? 100,
          startingPosition: res.StartingPosition ?? input.startingPosition ?? "LATEST",
        },
      };
    }

    throw new ValidationError(`Unsupported trigger type: ${input.type}`);
  }

  async deleteLambdaTrigger(
    functionName: string,
    triggerId: string,
    options?: DeleteLambdaTriggerOptions,
  ): Promise<void> {
    const fn = await this.get(functionName);
    const fnArn = (fn?.metadata?.arn as string) || "";

    if (options?.type === "s3" || options?.bucket) {
      const bucketName = options?.bucket;
      if (bucketName) {
        const config = await this.s3.send(
          new GetBucketNotificationConfigurationCommand({ Bucket: bucketName }),
        );
        const configs = config.LambdaFunctionConfigurations ?? [];
        let targetIndex = -1;
        for (let i = 0; i < configs.length; i++) {
          const c = configs[i]!;
          const isFuncMatch =
            !fnArn ||
            c.LambdaFunctionArn === fnArn ||
            c.LambdaFunctionArn?.endsWith(`:${functionName}`) ||
            c.LambdaFunctionArn === functionName;
          if (!isFuncMatch) continue;

          // If config has stored Id, strictly match Id; if Id is absent, match synthetic index ID
          const isIdMatch = c.Id ? c.Id === triggerId : `${bucketName}-${i}` === triggerId;
          if (isIdMatch) {
            targetIndex = i;
            break;
          }
        }

        if (targetIndex === -1) {
          throw new NotFoundError(
            `Trigger ${triggerId} on bucket ${bucketName} not found or does not belong to function ${functionName}`,
          );
        }

        const filtered = configs.filter((_, i) => i !== targetIndex);
        await this.s3.send(
          new PutBucketNotificationConfigurationCommand({
            Bucket: bucketName,
            NotificationConfiguration: {
              ...config,
              LambdaFunctionConfigurations: filtered,
            },
          }),
        );
        return;
      }

      // If bucket not specified, search all buckets
      const bucketsRes = await this.s3.send(new ListBucketsCommand({}));
      for (const bucket of bucketsRes.Buckets ?? []) {
        if (!bucket.Name) continue;
        try {
          const config = await this.s3.send(
            new GetBucketNotificationConfigurationCommand({ Bucket: bucket.Name }),
          );
          const configs = config.LambdaFunctionConfigurations ?? [];
          let targetIndex = -1;
          for (let i = 0; i < configs.length; i++) {
            const c = configs[i]!;
            const isFuncMatch =
              !fnArn ||
              c.LambdaFunctionArn === fnArn ||
              c.LambdaFunctionArn?.endsWith(`:${functionName}`) ||
              c.LambdaFunctionArn === functionName;
            if (!isFuncMatch) continue;

            const isIdMatch = c.Id ? c.Id === triggerId : `${bucket.Name}-${i}` === triggerId;
            if (isIdMatch) {
              targetIndex = i;
              break;
            }
          }

          if (targetIndex !== -1) {
            const filtered = configs.filter((_, i) => i !== targetIndex);
            await this.s3.send(
              new PutBucketNotificationConfigurationCommand({
                Bucket: bucket.Name,
                NotificationConfiguration: {
                  ...config,
                  LambdaFunctionConfigurations: filtered,
                },
              }),
            );
            return;
          }
        } catch {
          // Continue searching other buckets
        }
      }

      throw new NotFoundError(
        `S3 trigger ${triggerId} not found or does not belong to function ${functionName}`,
      );
    }

    // Event Source Mapping deletion: verify function ownership first
    const esm = await this.lambda.send(
      new GetEventSourceMappingCommand({ UUID: triggerId }),
    );
    const esmFuncArn = esm.FunctionArn ?? "";
    const isOwner =
      esmFuncArn === functionName ||
      esmFuncArn.endsWith(`:${functionName}`) ||
      (Boolean(fnArn) && esmFuncArn === fnArn);

    if (!isOwner) {
      throw new ValidationError(
        `Event source mapping ${triggerId} does not belong to function ${functionName}`,
      );
    }

    await this.lambda.send(new DeleteEventSourceMappingCommand({ UUID: triggerId }));
  }
}

function decodePayload(payload: InvokeCommandOutput["Payload"]): string {
  if (!payload) return "";
  return new TextDecoder().decode(payload);
}

/** Lambda returns the tailed log base64 encoded; surface it as plain text. */
function decodeLogResult(logResult: string): string {
  try {
    return Buffer.from(logResult, "base64").toString("utf8");
  } catch {
    return logResult;
  }
}

function filterBySearch(
  resources: CloudResource[],
  search?: string,
): CloudResource[] {
  const normalized = search?.trim().toLowerCase();
  if (!normalized) return resources;
  return resources.filter((r) => r.name.toLowerCase().includes(normalized));
}

function hasHttpStatus(error: unknown, status: number): boolean {
  if (typeof error !== "object" || error === null) return false;
  const metadata = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata;
  return metadata?.httpStatusCode === status;
}
