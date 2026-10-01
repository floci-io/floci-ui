export type CloudProvider = "aws" | "azure" | "gcp" | "oci" | "system";

export interface ApiRequestEvent {
  provider: CloudProvider;
  service: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  timestamp: number;
}
