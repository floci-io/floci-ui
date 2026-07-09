# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
