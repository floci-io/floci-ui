<p align="center">
  <img src="docs/images/floci-black.svg#gh-light-mode-only" alt="Floci UI" width="460" />
  <img src="docs/images/floci-white.svg#gh-dark-mode-only" alt="Floci UI" width="460" />
</p>

<p align="center">
  <strong>Any Cloud. Locally.</strong><br />
  A local-first, cloud-aware runtime console for Floci and compatible local cloud emulators.
</p>

<p align="center">
  <a href="https://github.com/floci-io/floci-ui/releases/latest"><img src="https://img.shields.io/github/v/release/floci-io/floci-ui?label=latest%20release&color=blue" alt="Latest Release"></a>
  <a href="https://github.com/floci-io/floci-ui/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/floci-io/floci-ui/ci.yml?branch=main&label=ci" alt="CI Status"></a>
  <a href="https://hub.docker.com/r/floci/floci-ui"><img src="https://img.shields.io/docker/pulls/floci/floci-ui?label=docker%20pulls" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/floci/floci-ui"><img src="https://img.shields.io/docker/image-size/floci/floci-ui/latest?label=image%20size" alt="Docker Image Size"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT"></a>
</p>

<p align="center">
  <img src="docs/images/floci-ui-console.png" alt="Floci UI console" width="900" />
</p>

Floci UI is the web console for the Floci ecosystem. The current app is centered on a unified `Cloud Explorer` and a cloud-aware `Console Home`. It renders only real data returned by local runtimes and explicit placeholders for work that is not wired yet.

No fake resources, no demo rows, and no mock operational data are shown in normal mode.

## Quick Start

AWS-only stack:

```bash
docker compose up
```

Full multi-cloud stack:

```bash
docker compose --profile multicloud up
```

Open [http://localhost:4500](http://localhost:4500).

## What The UI Actually Exposes Today

The sidebar and Console Home are rendered from `GET /api/clouds/:cloud/services`,
so this table is derived from the service catalog and the adapter registry rather
than maintained by hand. Regenerate it after any change to either:

```bash
cd packages/api && bun run scripts/service-matrix.ts
```

| Group | Service | AWS | Azure | GCP |
|---|---|---|---|---|
| Compute | Compute | Yes (list, inspect, create, delete) | No | No |
| Compute | EKS / AKS / GKE | Yes (list, inspect) | No | Yes (list, create, inspect, delete) |
| Compute | Serverless | Yes (list, create, inspect, delete) | Runtime gap | Yes (list, create, inspect, delete) |
| Storage | Storage | Yes (list, create, delete, inspect) | Yes (list, create, delete, inspect) | Yes (list, create, delete, inspect) |
| Databases | Database | Yes (list, inspect) | Yes (list, create, delete, inspect) | Yes (list, create, inspect, delete) |
| Networking | Networking | Yes (list) | No | No |
| Security | Secrets Manager / Key Vault | Yes (legacy page) | Yes (list, create, delete, inspect) | No |
| Observability | CloudWatch Logs / Logs | Yes (list, create, delete, inspect) | No | No |

Console Home is available for all three clouds.

Runtime gaps — an adapter exists but the local runtime does not implement it:

- Azure Serverless: the Floci-AZ runtime returns 501 NotImplemented for the Azure Functions endpoint.

Services marked `No` render as a disabled sidebar row whose tooltip carries the
server-supplied reason. Adding one is a catalog row in
`packages/api/src/cloud-spi/serviceCatalog.ts` plus an adapter — no frontend change.

<p align="center">
  <img src="docs/images/floci-ui-console-azure.png" alt="Azure console home, showing services grouped by category with per-cloud naming and coming-soon reasons" width="900" />
</p>

Azure on the same build: the nav is grouped by category, `k8s Engine` is labelled
`AKS` for this provider, and every unavailable service carries a reason — Serverless
reads `coming soon` because the Floci-AZ runtime answers 501 for Azure Functions,
even though an adapter is registered.

## Current Capability Snapshot

<details>
<summary><strong>Storage</strong></summary>

Cloud Explorer storage is the most complete unified category today.

- AWS S3 buckets are normalized as `storage` resources with type `bucket`.
- Azure Blob containers are normalized as `storage` resources with type `container`.
- GCP Cloud Storage buckets are normalized as `storage` resources with type `bucket`.
- Shared resource table, shared inspector, runtime status strip, and schema-driven create/delete flows.
- Object/blob browser with prefix navigation.
- Upload, download, delete, copy, and create-folder-prefix actions.
- Azure folder markers are hidden and rendered as folders in the browser.
- Size and last-modified metadata are shown when returned by the runtime.

Current gaps:

- No bulk multi-select actions yet.
- No tag/policy/version management in the unified view.
- Folder creation is prefix-based, not a real filesystem directory.

</details>

<details>
<summary><strong>k8s Engine</strong></summary>

AWS only, through the unified shell.

- EKS clusters can be listed and inspected.
- Cluster metadata, node groups, and related details are surfaced when returned by Floci AWS Core.

Current gaps:

- No AKS or GKE adapter yet.
- No generic cluster creation flow in Cloud Explorer.

</details>

<details>
<summary><strong>Database</strong></summary>

Two different database models are currently exposed under one category:

- AWS RDS: list and inspect oriented.
- Azure Cosmos DB NoSQL: database, container, and document workflows.

Cosmos DB currently includes:

- List, create, and delete databases.
- List, create, and delete containers.
- Create, edit, and delete documents/items.
- SQL query editor for documents.

Current gaps:

- No unified cross-provider database contract beyond the shared category shell.
- No GCP database adapter yet.
- AWS DynamoDB is not rebuilt into the new Cloud Explorer model yet.

</details>

<details>
<summary><strong>Compute</strong></summary>

AWS only, through the unified shell plus AWS-specific panels where the workflow is too rich for a flat generic form.

- List EC2 instances and AMIs as normalized resources.
- Launch instances.
- Start, stop, reboot, and terminate instances.
- Create AMIs.
- Edit tags.
- View console output.

Current gaps:

- No Azure VM or GCP compute adapter yet.
- Compute creation still uses an AWS-specific panel because it needs dependent selectors.

</details>

<details>
<summary><strong>Networking</strong></summary>

AWS only, through the unified shell plus an AWS-specific networking panel.

- VPC list and inspect through the unified resource table.
- VPC creation and delete, the VPC wizard, subnets, security groups, internet
  gateways, NAT gateways, route tables, and Elastic IP workflows — all in the
  Networking panel.

Current gaps:

- No Azure VNet or GCP VPC adapter yet.
- Create and delete are advertised as `partial` in the unified schema and are
  handled by the Networking panel, because they need dependent selectors that a
  flat generic form cannot express.
- Advanced multi-cloud networking normalization is still pending.

</details>

<details>
<summary><strong>Serverless</strong></summary>

AWS and GCP, both through the unified shell.

- AWS Lambda and GCP Cloud Functions list, create, inspect, and delete.
- AWS Lambda invoke is wired, including the tailed execution log and handler errors.
- Lambda creation packages inline code into a real deployment archive.
- The navigation entry appears for any cloud with a registered adapter.

Current gaps:

- Azure Functions is registered but the Floci-AZ runtime answers 501 NotImplemented,
  so it reports `coming_soon` with that reason rather than appearing available.
- GCP Cloud Functions invoke is not wired yet; the capability is advertised as
  `coming_soon` instead of being silently missing.
- Old AWS Lambda page is gone; all future work should stay in the unified model.

</details>

<details>
<summary><strong>Secrets Manager</strong></summary>

This is the only dedicated AWS page still outside Cloud Explorer.

- List secrets.
- Inspect metadata.
- Reveal current value on demand.
- Create secrets.
- Update values.
- Delete secrets, including force delete.

Current gaps:

- Not migrated into the Cloud Explorer contract yet.
- No Azure or GCP secret adapter yet.

</details>

## Product Direction

Floci UI is evolving toward a metadata-driven, cloud-aware console where one web app can render multiple local runtimes through the same shell.

The guiding rules are:

- The UI does not know clouds.
- The proxy does not know internal implementations.
- The SPI defines the contracts.
- The adapters perform the translation.
- The runtimes execute the real behavior.

## Architecture

![Floci Unified UI Multi-Cloud Architecture](docs/images/floci-unified-ui-architecture.png)

Short implementation notes live in [docs/implementation-notes.md](docs/implementation-notes.md).

## Project Structure

```text
packages/
  api/
    src/
      cloud-spi/
      registry/
      adapter-aws/
      adapter-azure/
      adapter-gcp/
      routes/
      service/
  frontend/
    src/
      api/
      components/
      features/
      pages/
```

High-level runtime flow:

```text
Browser
  -> frontend (React/Vite)
  -> /api/clouds/*
  -> Cloud Adapter Registry
  -> provider adapter
  -> local runtime
```

## Setup

### Docker Compose

Default compose stack:

- `floci-ui` on `http://localhost:4500`
- `floci-api` on `http://localhost:4501`
- `floci` on `http://localhost:4566`

Start AWS-only:

```bash
docker compose up
```

Start AWS + Azure + GCP:

```bash
docker compose --profile multicloud up
```

Convenience targets:

```bash
make up
make up-multicloud
make down
make logs
```

### Manual Local Development

Prerequisites:

- Node.js 20+
- pnpm 9+
- Bun
- A running local runtime: Floci core, and optionally Floci-AZ / Floci-GCP

Install dependencies:

```bash
pnpm install
```

Configure the API environment:

```bash
cp .env.example packages/api/.env
```

Important: the API runs from `packages/api` and loads environment variables from `packages/api/.env`.

Start Floci AWS Core with Docker:

```bash
docker run -d --name floci \
  -p 4566:4566 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e FLOCI_DEFAULT_REGION=us-east-1 \
  -u root \
  floci/floci:latest
```

Or from a local clone:

```bash
git clone https://github.com/floci-io/floci.git ../floci
cd ../floci
./mvnw clean quarkus:dev
```

Optional local runtimes:

- Floci-AZ on `http://localhost:4577`
- Floci-GCP on `http://localhost:4588`

Start the UI stack:

```bash
pnpm dev
```

That starts:

- frontend on `http://localhost:4500`
- API on `http://localhost:4501`

Split commands:

```bash
pnpm dev:api
pnpm dev:web
```

## Environment

Default API environment values:

```bash
FLOCI_ENDPOINT=http://localhost:4566
FLOCI_AZURE_ENDPOINT=http://localhost:4577
FLOCI_AZURE_ACCOUNT_NAME=devstoreaccount1
FLOCI_GCP_ENDPOINT=http://localhost:4588
FLOCI_GCP_PROJECT=floci-local
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
PORT=4501
```

`VITE_MOCK_MODE=false` is kept in `.env.example`, but the current app is intended to run against real local runtimes.

## Verification

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

## Troubleshooting

### `http proxy error` or `ECONNREFUSED` on `/api/*`

The frontend is up, but the API is not reachable on `http://localhost:4501`.

Check:

```bash
pnpm dev:api
curl http://localhost:4501/api/clouds
```

### `EADDRINUSE` on port `4501`

Another API process is already running. Stop it first or kill the process holding port `4501`.

### Runtime shows `Not connected` or `Runtime unavailable`

Check the runtime directly:

```bash
curl http://localhost:4566/_floci/health
curl http://localhost:4577/_floci/health
curl http://localhost:4588/_floci-gcp/health
curl http://localhost:4501/api/clouds/aws/status
curl http://localhost:4501/api/clouds/azure/status
curl http://localhost:4501/api/clouds/gcp/status
```

### A single service shows as unavailable while the cloud is connected

Cloud status reflects the runtime; each service is probed separately. Ask which
service is failing and why:

```bash
curl http://localhost:4501/api/clouds/azure/status?services=all
curl http://localhost:4501/api/clouds/azure/services/serverless/status
```

`errorCode` distinguishes the cases: `operation_not_implemented` means the local
runtime does not implement that service, `runtime_unavailable` means it cannot be
reached, and `operation_not_supported` means no adapter is registered.

### Credentials or endpoint mismatch

For AWS local development, keep API credentials aligned with the runtime:

```bash
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

## Contributing

When adding new UI surface:

- Prefer the Cloud Explorer and Cloud Proxy model over new legacy pages.
- Reuse the SPI contracts before creating provider-specific response shapes.
- Keep placeholders explicit instead of inventing fake data.
- Update this README when the visible UI surface changes.

## License

[MIT](LICENSE) — part of the [Floci](https://floci.io) ecosystem.
