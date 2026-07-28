# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- AWS Lambda invoke, including the tailed execution log and handler errors.
- Per-service status: `GET /api/clouds/:cloud/services/:service/status` and
  `GET /api/clouds/:cloud/status?services=all`, with an `errorCode` that distinguishes a
  runtime that does not implement a service from one that cannot be reached.
- `packages/api/scripts/service-matrix.ts` generates the README coverage table from the
  service catalog and adapter registry.
- Grouped sidebar sections, a loading skeleton, and a tooltip explaining why a service is
  unavailable.

### Changed

- Service availability is derived from one catalog plus the adapter registry and served to
  the frontend. Registering an adapter is now the only step needed for a service to appear;
  the sidebar, Console Home, and Cloud Explorer no longer hardcode it.
- Adapters throw typed errors that are mapped to HTTP in one place, so AWS SDK failures
  return 400/403/404/409/429 instead of a blanket 502.
- Both GCP adapters share a runtime client that reports Google's error message instead of a
  bare HTTP status.

### Fixed

- AWS Lambda creation failed against the runtime: inline code was sent as raw text where a
  deployment archive is required, so "create" could never succeed.
- Azure serverless was advertised as available even though the Floci-AZ runtime answers 501
  NotImplemented; it now reports `coming_soon` with that reason. GCP Cloud Functions invoke
  is likewise advertised as `coming_soon` — contrary to the 0.2.0 note below, it was never
  implemented.
- AWS networking advertised create and delete as available while the adapter threw, and its
  `get()` always returned null so inspect never worked.
- A schema was served for services with no registered adapter, so the UI rendered a table
  that then failed on every request.
- GCP runtime status reported "reachable" whenever the port was open, because the probe
  ignored the HTTP status. Cloud status was also inferred solely from the storage adapter.
- Table columns bound to `metadata` fields — including Serverless "Runtime" and
  "Last Updated" — rendered blank on every row.
- An unknown service slug silently redirected to Storage instead of reporting it.

## [0.2.0] - 2026-07-08

### Added

- AWS Secrets Manager console page: list, inspect, create, and delete secrets (scheduled or forced deletion).
- Azure Functions in the Cloud Explorer: list, inspect, create, delete, and invoke.
- GCP Cloud Functions in the Cloud Explorer, including invoke support.
- Serverless invoke panel payload tooling: pre-invoke validation plus format, sample, and clear payload actions.
- Account switcher scoping the Cloud Explorer to a selectable AWS account.
- Service information dialog describing each service's capabilities, runtime adapter, and connection state.

### Changed

- Decluttered the Cloud Explorer service view: the resource table now leads the page, diagnostics moved into a compact topbar ⓘ info dialog, and the resource inspector only renders when a resource is selected.
- Migrated the Secrets Manager frontend to the shared `HttpClient`/`ApiRegistry` pattern and wired it into the navigation shell.
- Updated all JavaScript dependencies and adapted the codebase to TypeScript 6 and stricter ESLint rules.
- Streamlined the local development setup.

### Fixed

- Secrets drawer opening partially off-screen.
- Duplicate serverless invoke client export.

## [0.1.0] - 2026-06-14

### Added

- Theme-aware Floci brand logo (light/dark) and a brand-aligned indigo color palette sourced from floci.io.
- `multicloud` Docker Compose profile to start the Azure and GCP emulators alongside the AWS runtime.
- Continuous Integration workflow running lint, type-check, test, and build on pull requests.
- Multi-architecture (`amd64` + `arm64`) Docker release workflow that publishes `floci/floci-ui` on version tags.
- End-to-end integration workflow that runs the full stack against the real `floci/floci` runtime image.
- Conventional Commits validation on pull requests.
- Contributor tooling: `CONTRIBUTING.md`, issue and pull request templates, `CODEOWNERS`, and Dependabot configuration.

### Changed

- **Breaking:** standardized local ports to the Floci `45xx` range — UI now on `4500` and API on `4501` (were `3000`/`3001`).
- Consolidated `docker-compose.dev.yml` into a single `docker-compose.yml`.
- Reorganized Dockerfiles under `docker/` and added a packaging image that bundles CI-built artifacts for releases.
- Upgraded the frontend stack: React 19, Vite 8, React Router 7, and ESLint 10 (migrated to flat config), plus grouped dependency updates.
- Upgraded the API dependencies: AWS SDK and Hono.
- Bumped pinned GitHub Actions (`checkout`, `setup-node`, `pnpm/action-setup`, `setup-qemu`).
- Revamped the README with the brand logo, status badges, a connected-console screenshot, and a quick-start section.
- Moved the README logo assets into `docs/images/`.

### Removed

- `docker-compose.dev.yml` (folded into `docker-compose.yml`).

[Unreleased]: https://github.com/floci-io/floci-ui/compare/0.2.0...HEAD
[0.2.0]: https://github.com/floci-io/floci-ui/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/floci-io/floci-ui/releases/tag/0.1.0
