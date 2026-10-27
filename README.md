<p align="center">
  <img src="docs/images/floci-black.svg#gh-light-mode-only" alt="Floci UI" width="460" />
  <img src="docs/images/floci-white.svg#gh-dark-mode-only" alt="Floci UI" width="460" />
</p>

<p align="center">
  <strong>Any Cloud. Locally.</strong><br />
  The web console for Floci: browse and manage AWS, Azure, GCP and OCI resources on your machine.
</p>

<p align="center">
  <a href="https://github.com/floci-io/floci-ui/releases/latest"><img src="https://img.shields.io/github/v/release/floci-io/floci-ui?label=latest%20release&color=blue" alt="Latest Release"></a>
  <a href="https://github.com/floci-io/floci-ui/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/floci-io/floci-ui/ci.yml?branch=main&label=ci" alt="CI Status"></a>
  <a href="https://hub.docker.com/r/floci/floci-ui"><img src="https://img.shields.io/docker/pulls/floci/floci-ui?label=docker%20pulls" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/floci/floci-ui"><img src="https://img.shields.io/docker/image-size/floci/floci-ui/latest?label=image%20size" alt="Docker Image Size"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#supported-services">Services</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Development</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

<p align="center">
  <img src="docs/images/floci-ui-console.png" alt="Floci UI console" width="900" />
</p>

---

## What is Floci UI?

A Web UI for the [Floci](https://github.com/floci-io/floci) local emulators. It emulates nothing itself: the API turns the UI's requests into real cloud-SDK calls against the runtimes you already run, and the UI shows only what they return. No demo rows, no mock metrics, real empty states.

| Emulator | Cloud | Port |
|---|---|:-:|
| [floci](https://github.com/floci-io/floci) | AWS | 4566 |
| [floci-az](https://github.com/floci-io/floci-az) | Azure | 4577 |
| [floci-gcp](https://github.com/floci-io/floci-gcp) | GCP | 4588 |
| [floci-oci](https://github.com/floci-io/floci-oci) | OCI | 4599 |

## Quick Start

```bash
docker compose up                              # AWS only
docker compose --profile multicloud up         # AWS + Azure + GCP + OCI
```

Open **http://localhost:4500**.

<details>
<summary>Other ways to run it</summary>

**From Floci itself.** Floci starts the console on demand at `http://localhost:4566/_floci/ui` (needs the Docker socket mounted; see the [Floci docs](https://floci.io/floci/ui/)).

**Podman.** `floci` mounts the host container socket to start Lambda and Postgres containers, and rootless Podman has no `/var/run/docker.sock`. Point the mount at Podman's Docker-compatible socket in a `.env` file:

```bash
echo "FLOCI_CONTAINER_SOCKET=$XDG_RUNTIME_DIR/podman/podman.sock" >> .env
podman-compose up
```

Without it, `up` aborts with `statfs /var/run/docker.sock: no such file or directory` and no service starts.

**Single image**, UI and API on one port:

```bash
docker run -p 4500:4500 -e FLOCI_ENDPOINT=http://host.docker.internal:4566 floci/floci-ui
```

</details>

## Features

- **One console, four clouds.** Pick the cloud in Settings; the nav is built from what each runtime supports.
- **Generic Cloud Explorer.** List, search, create, inspect (Plain Text, JSON and Table views) and delete, with multi-select and bulk delete. Every service renders from a schema.
- **Honest availability.** A service without an adapter, or one the runtime cannot serve yet, is a disabled row with the reason in its tooltip.
- **Rich workspaces where a flat form is not enough:**

| Area | What you get |
|---|---|
| Storage | Object browser with prefixes, upload, download, copy, delete; Empty bucket for S3, including object versions and delete markers |
| Databases | DynamoDB records with paged scans, key queries on the table or a secondary index, and a PartiQL editor; Cosmos DB, Azure SQL / PostgreSQL and Aurora DSQL data explorers with a query editor (DSQL signs in with an IAM token); RDS update and snapshots |
| Compute | EC2 launch, power actions, AMIs, tags, console output; EKS nodegroups and Fargate profiles; Lambda invoke with tailed logs |
| Networking | VPC wizard, subnets, security groups, gateways, route tables, Elastic IPs |
| Messaging | SQS send, receive and purge |
| Workflows and logs | Step Functions execution history; CloudWatch Logs streams, events and Logs Insights; GCP Cloud Logging entries with severity and time filters |
| Security | Secrets (reveal on demand), KMS encrypt and decrypt, IAM users, roles and policies |
| Email | SES mailbox with HTML, text and raw MIME preview |
| Settings | Light, dark or system theme; account switcher |

For SES raw messages, the mailbox decodes the captured MIME headers and bodies
for search and preview while preserving the original `RawData`. Explicit fields
returned by the runtime take precedence over MIME-derived values. Messages that
cannot be parsed remain available in the raw view.

## Supported Services

Generated from the service catalog and adapter registry, so it never drifts. After changing either, run `cd packages/api && bun run scripts/service-matrix.ts`.

| Group | Service | AWS | Azure | GCP | OCI |
|---|---|:-:|:-:|:-:|:-:|
| Compute | Compute | ✅ | ✅ | ✅ | – |
| Compute | k8s Engine | 👁 | 👁 | ✅ | ✅ |
| Compute | Serverless | ✅ | ✅ | ✅ | ✅ |
| Compute | Containers | ✅ | ✅ | ✅ | – |
| Compute | Container Registry | ✅ | – | – | – |
| Compute | SageMaker AI | ✅ | – | – | – |
| Storage | Storage | ✅ | ✅ | ✅ | ✅ |
| Storage | Table Storage | – | ✅ | – | – |
| Databases | Database | ✅ | ✅ | ✅ | – |
| Databases | Aurora DSQL | ✅ | – | – | – |
| Databases | NoSQL | ✅ | ✅ | ✅ | – |
| Networking | Networking | 👁 | ✅ | ✅ | – |
| Networking | Load Balancing | ✅ | – | – | – |
| Networking | CDN | ✅ | – | – | – |
| Networking | DNS | ✅ | – | – | – |
| Integration | Messaging | ✅ | ✅ | ✅ | ✅ |
| Integration | API Gateway | ✅ | – | – | – |
| Integration | SNS | ✅ | – | – | – |
| Integration | Queue Storage | – | ✅ | – | – |
| Integration | Streams | ✅ | ✅ | – | ✅ |
| Integration | Events | ✅ | – | – | – |
| Integration | Email | 👁 | – | – | – |
| Integration | Cloud Scheduler | – | – | ✅ | – |
| Integration | Workflows | ✅ | – | – | – |
| Provisioning | Infrastructure as Code | ✅ | – | – | – |
| Provisioning | Configuration | ✅ | ✅ | – | – |
| Security | Identity | ✅ | – | – | ✅ |
| Security | Cognito | ✅ | – | – | – |
| Security | Secrets Manager | ✅ | ✅ | ✅ | ✅ |
| Security | Key Management | ✅ | ✅ | 👁 | ✅ |
| Security | Certificates | – | ✅ | – | – |
| Security | Parameter Store | ✅ | – | – | – |
| Observability | Logs | ✅ | – | 👁 | – |
| Observability | CloudWatch | ✅ | – | – | – |

✅ list, inspect, create, delete · 👁 read-only or partial · ⏳ adapter registered, runtime gap · – not available

Known runtime gaps (the adapter is ready, the emulator is not):

- RDS `CreateDBSnapshot`: Floci answers 501; listing works.
- AKS clusters never leave `Failed` locally, so AKS stays read-only.

Adding a service is a catalog row, a schema and an adapter, with no frontend change. See [AGENTS.md](AGENTS.md).

<p align="center">
  <img src="docs/images/floci-ui-console-azure.png" alt="Azure console home with services grouped by category" width="900" />
</p>

## Architecture

![floci-unified-ui-architecture.png](docs/images/floci-unified-ui-architecture.png)


```text
Browser → /api/clouds/* → Cloud Adapter Registry → provider adapter → local runtime
```

The UI knows no cloud, the proxy knows no implementation, adapters translate, runtimes execute. Code lives in `packages/api` (Bun, Hono, AWS SDK v3) and `packages/frontend` (React, Vite).

## Development

Requires Node 22.22+ or 24.15+, pnpm 9+, Bun, and a running Floci (`docker compose up floci` is enough).

```bash
pnpm install
cp .env.example packages/api/.env
pnpm dev                 # UI :4500 + API :4501
```

Before opening a PR:

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm build
```

Frontend e2e tests use mocked `/api/*` and need no emulator: `pnpm --filter @floci/frontend test:e2e`.

### Configuration

Set in `packages/api/.env` (defaults shown).

| Variable | Default |
|---|---|
| `FLOCI_CLOUD` | unset: a standalone console that serves every cloud and opens on AWS. An emulator that starts the console sets its own cloud (`aws`, `az`, `gcp` or `oci`), and the console then serves that cloud alone |
| `FLOCI_ENDPOINT` | `http://localhost:4566` |
| `FLOCI_AZURE_ENDPOINT` | `http://localhost:4577` |
| `FLOCI_GCP_ENDPOINT` | `http://localhost:4588` |
| `FLOCI_OCI_ENDPOINT` | `http://localhost:4599` |
| `FLOCI_AZURE_ACCOUNT_NAME` / `_SUBSCRIPTION_ID` / `_RESOURCE_GROUP` | `devstoreaccount1` / `00000000-0000-0000-0000-000000000000` / `floci-local` |
| `FLOCI_GCP_PROJECT` / `_LOCATION` | `floci-local` / `us-central1` |
| `FLOCI_OCI_REGION` | `us-ashburn-1` |
| `FLOCI_OCI_TENANCY_ID` | Floci-OCI's built-in tenancy |
| `FLOCI_OCI_NAMESPACE` | unset, discovered from the runtime |
| `FLOCI_DEFAULT_ACCOUNT_ID` | `000000000000` |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `us-east-1`, `test`, `test` |
| `PORT` | `4501` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:4500` |

`CORS_ALLOWED_ORIGINS` is a comma separated allow-list. It gates Secrets Manager and KMS encrypt, decrypt, sign, verify, rotate, and cancel-deletion routes. The bodyless key mutation routes also reject untrusted browser origins on the request itself. The console reaches the API same-origin and does not need an allow-list entry.

### Remote hosts and reverse proxies

For a standalone console behind a reverse proxy, give the console its own origin
and send all paths to the UI/API service (`4500` for the single image). This includes
`/assets/*`, `/api/*`, and frontend routes such as `/console/aws` and `/settings`.
Sending frontend routes to Floci core (`4566`) can return S3 `NoSuchBucket` XML on
a page refresh instead of the console's HTML.

The standalone console uses root-relative assets, API URLs and frontend routes.
Proxying only `/_floci/ui*` while another service owns `/` does not add base-path
support; use a separate console hostname instead of a partial path mapping.

Set `FLOCI_ENDPOINT` on the service running the API, using an address reachable
from that service. For example, on a shared Compose network it is
`http://floci:4566`. In a container, `http://localhost:4566` refers to that container,
not the host or the Floci service. `FLOCI_CORE_URL` and `FLOCI_AWS_ENDPOINT` are not
configuration variables used by this API.

The browser requests `/api/clouds/aws/status`; the API probes the runtime's
`/_floci/health`. A `localhost:4566` address in a runtime error describes the API's
configured endpoint. Check `/api/clouds/aws/status` through the console origin
and refresh a frontend route when troubleshooting the proxy.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED` on `/api/*` | The API is down. Run `pnpm dev:api`, then `curl localhost:4501/api/clouds`. |
| `EADDRINUSE` on 4501 | Another API is running. Stop it first. |
| Cloud shows `Not connected` | Check the runtime: `curl localhost:4566/_floci/health` (Azure `:4577/_floci/health`, GCP `:4588/_floci-gcp/health`, OCI `:4599/_floci-oci/health`), then `curl localhost:4501/api/clouds/<cloud>/status`. |
| One service is unavailable | `curl "localhost:4501/api/clouds/<cloud>/status?services=all"`. `errorCode` tells you why: `operation_not_implemented` (the runtime lacks it), `runtime_unavailable` (unreachable), `operation_not_supported` (no adapter). |
| AWS auth errors | Keep `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as `test`, matching the runtime. |
| An S3 bucket looks empty but will not delete (`BucketNotEmpty`) | It still holds object versions or delete markers, which the object list does not show. Select it and use **Empty bucket**, then delete it. Empty bucket lists every version with `ListObjectVersions` before deleting any, deletes them by version ID with `DeleteObjects` (1,000 per request), then checks nothing is left. It holds only object keys and version IDs in memory, never object contents, and stops starting requests after 120 seconds, and a delete request that gets no answer within 25 seconds ends the run. Either reports `runtime_unavailable` even though the runtime is up; when the message says deletion had started, run Empty bucket again to continue. It is not atomic: a failure or timeout part way through can leave some versions deleted, and something writing to the bucket meanwhile makes it fail rather than report success. Uploads, deletes and copies the console still has running on that bucket refuse it with `resource_conflict` (409) before anything is deleted, and are themselves refused while it runs. |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Prefer the Cloud Explorer and generic SPI over new pages, keep placeholders explicit, and update this README when the visible surface changes.

## Community

[floci-dash](https://github.com/ofsazib/floci-dash) is a community AWS dashboard on Cloudscape with an EC2 web terminal (AWS only). Built something for Floci? Open a PR to list it.

## License

[MIT](LICENSE), part of the [Floci](https://floci.io) ecosystem.
