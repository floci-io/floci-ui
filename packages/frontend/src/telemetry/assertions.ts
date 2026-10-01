import { assert } from "@/lib/assertions";
import type { ApiRequestEvent, CloudProvider } from "./types";

const CLOUD_PROVIDERS: ReadonlySet<CloudProvider> = new Set([
  "aws",
  "azure",
  "gcp",
  "oci",
  "system",
]);

export function assertApiRequestEvent(
  event: ApiRequestEvent,
): asserts event is ApiRequestEvent {
  assertCloudProvider(event.provider);
  assertNonEmptyString(event.service, "service");
  assertNonEmptyString(event.method, "method");
  assertNonEmptyString(event.path, "path");
  assertNonNegativeFiniteNumber(event.statusCode, "statusCode");
  assertNonNegativeFiniteNumber(event.latencyMs, "latencyMs");
  assertPositiveFiniteNumber(event.timestamp, "timestamp");
}

export function assertCloudProvider(
  provider: CloudProvider,
): asserts provider is CloudProvider {
  assert(
    CLOUD_PROVIDERS.has(provider),
    `Invalid cloud provider: ${String(provider)}`,
  );
}

function assertNonEmptyString(value: string, field: string) {
  assert(
    typeof value === "string" && value.trim() !== "",
    `Invalid API request event "${field}": expected string.`,
  );
}

function assertNonNegativeFiniteNumber(value: number, field: string) {
  assert(
    typeof value === "number" && Number.isFinite(value) && value >= 0,
    `Invalid API request event "${field}": expected non-negative number.`,
  );
}

function assertPositiveFiniteNumber(value: number, field: string) {
  assert(
    typeof value === "number" && Number.isFinite(value) && value > 0,
    `Invalid API request event "${field}": expected positive number.`,
  );
}
