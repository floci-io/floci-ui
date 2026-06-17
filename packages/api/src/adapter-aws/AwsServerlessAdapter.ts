import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  ListFunctionsCommand,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import { awsServerlessSchema } from "../cloud-spi/serverlessSchema";
import type {
  CloudResource,
  CloudServiceAdapter,
  CreateResourceInput,
  ResourceQuery,
  ServiceSchema,
} from "../cloud-spi/types";
import { lambda as defaultLambda } from "../aws";

export class AwsServerlessAdapter implements CloudServiceAdapter {
  readonly cloud = "aws" as const;
  readonly service = "serverless" as const;

  constructor(private readonly lambda: LambdaClient = defaultLambda) {}

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

    if (!functionName) throw new Error("functionName is required");
    if (!runtime) throw new Error("runtime is required");
    if (!handler) throw new Error("handler is required");
    if (!role) throw new Error("role is required");

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
          ZipFile: new TextEncoder().encode(code),
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
