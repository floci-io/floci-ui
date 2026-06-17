import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { EKSClient } from "@aws-sdk/client-eks";
import { EC2Client } from "@aws-sdk/client-ec2";
import { RDSClient } from "@aws-sdk/client-rds";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const endpoint = process.env.FLOCI_ENDPOINT;
const region = process.env.AWS_REGION || "us-east-1";

// Floci derives the AWS account from AWS_ACCESS_KEY_ID: a value that is exactly
// 12 digits is used verbatim as the account id, and resources are isolated per
// account. Any other key (e.g. "test", "AKIA...") falls back to
// FLOCI_DEFAULT_ACCOUNT_ID (000000000000). We lean on that contract to scope the
// console to an account: the access key *is* the account id and the secret can
// be any non-empty string (Floci does not validate it).
const DEFAULT_ACCOUNT_ID = process.env.FLOCI_DEFAULT_ACCOUNT_ID || "000000000000";
const SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "floci";

export function isAccountId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{12}$/.test(value);
}

/** The account used when a request does not (validly) specify one. */
export function defaultAccountId(): string {
  const envKey = process.env.AWS_ACCESS_KEY_ID;
  return isAccountId(envKey) ? envKey : DEFAULT_ACCOUNT_ID;
}

/** Normalize a caller-supplied account id, falling back to the default. */
export function resolveAccountId(raw?: string | null): string {
  return isAccountId(raw) ? raw : defaultAccountId();
}

export type AwsClients = {
  s3: S3Client;
  lambda: LambdaClient;
  eks: EKSClient;
  ec2: EC2Client;
  rds: RDSClient;
  secretsManager: SecretsManagerClient;
};

export type AwsClientName = keyof AwsClients;

const clientCache = new Map<string, AwsClients>();

function buildClients(accountId: string): AwsClients {
  const base = {
    region,
    credentials: { accessKeyId: accountId, secretAccessKey: SECRET_ACCESS_KEY },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  };
  return {
    s3: new S3Client({ ...base, forcePathStyle: true }),
    lambda: new LambdaClient(base),
    eks: new EKSClient(base),
    ec2: new EC2Client(base),
    rds: new RDSClient(base),
    secretsManager: new SecretsManagerClient(base),
  };
}

/**
 * Return the cached AWS SDK client set bound to a given account. Clients are
 * cheap to build but each holds connection state, so we memoize one set per
 * resolved account id.
 */
export function awsClientsForAccount(accountId?: string | null): AwsClients {
  const id = resolveAccountId(accountId);
  let clients = clientCache.get(id);
  if (!clients) {
    clients = buildClients(id);
    clientCache.set(id, clients);
  }
  return clients;
}

// Default-account singletons, kept for surfaces that are not yet account-aware:
// the dedicated EC2, EKS, RDS and Secrets Manager routes. These ignore the
// x-floci-account-id header and always serve the default account, so they do not
// follow the console's active account. The Cloud Explorer proxy resolves clients
// per request via awsClientsForAccount() instead.
export const awsClients = awsClientsForAccount(defaultAccountId());

export const s3 = awsClients.s3;
export const lambda = awsClients.lambda;
export const eks = awsClients.eks;
export const ec2 = awsClients.ec2;
export const rds = awsClients.rds;
export const secretsManager = awsClients.secretsManager;
