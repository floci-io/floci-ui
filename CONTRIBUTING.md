# Contributing to Floci UI

Thank you for your interest in contributing! Floci UI is the web console / DevTools
for the [Floci](https://floci.io) local cloud emulator. It is a community-driven
project and all contributions are welcome.

## Ways to Contribute

- **Bug reports**: open an issue with a minimal reproduction (steps, expected vs. actual)
- **Feature requests**: open an issue describing the console feature or service page you need
- **Pull requests**: bug fixes, new service UI, or UX improvements
- **Service coverage**: wire a new Floci-backed service into the console

## Project Layout

This is a pnpm workspace monorepo with two packages:

| Package | Stack | Responsibility |
|---|---|---|
| `packages/frontend` | React + Vite + TypeScript | The console UI served on port `4500` |
| `packages/api` | Bun + Hono + AWS SDK v3 | Backend on port `4501` that translates the UI's REST/JSON requests into AWS SDK calls against Floci core |

The frontend talks only to `/api/*` (proxied to `packages/api`); the API talks to the
Floci emulators. Never have the frontend reach a cloud endpoint directly.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- [Bun](https://bun.sh/) (required by `packages/api`)
- Docker (optional, only for running the full stack via `docker compose`)

### Install

```bash
git clone https://github.com/floci-io/floci-ui.git
cd floci-ui
pnpm install
```

### Run

The UI needs three components running: Floci core (`:4566`), the API (`:4501`), and the
frontend (`:4500`).

**Option A, Docker Compose (recommended):**

```bash
docker compose up                        # AWS-only
docker compose --profile multicloud up   # adds Azure + GCP emulators
```

**Option B, local dev (three terminals):**

```bash
# 1. Floci core (see README for the docker run / local-clone options)
# 2. API backend
pnpm dev:api
# 3. Frontend
pnpm dev
```

Open the UI at http://127.0.0.1:4500/. See [README.md](README.md) for full setup,
environment variables, and troubleshooting.

### Checks

Run these before opening a PR:

```bash
pnpm lint          # eslint (frontend)
pnpm type-check    # tsc on both packages
pnpm test          # bun test (api)
pnpm build         # production build
```

## Branching Model

Floci UI uses a **tag-driven release model**. Docker images are never published on PR
merge, only when a version tag is pushed, which the Release Cut workflow does.

| Branch / ref | Purpose | Docker published? |
|---|---|---|
| `main` | Integration branch: all PRs merge here. Treated as unstable. | No |
| `X.Y.Z` tag | Signals a release. Triggers the multi-arch Docker publish pipeline. | Yes (`floci/floci-ui:x.y.z`, `floci/floci-ui:latest`) |

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

> **The PR title should follow this format**, since it becomes the squash-merge commit message.

### Format

```
<type>[optional scope]: <description>
```

- **type**: one of the values in the table below (lowercase)
- **scope**: optional, in parentheses, identifies the package or service area
  (e.g. `frontend`, `api`, `s3`, `ec2`, `serverless`, `docker`, `ci`)
- **description**: short summary in the imperative mood, no trailing period
- Append `!` before the colon to signal a breaking change: `feat(api)!:`

| Type | When to use | Version bump |
|------|-------------|--------------|
| `feat` | New console feature, service page, or API route | minor |
| `fix` | Bug fix or compatibility correction | patch |
| `perf` | Performance improvement | patch |
| `revert` | Reverts a previous commit | patch |
| `docs` | Documentation only | none |
| `style` | Formatting, whitespace, no logic change | none |
| `chore` | Build, CI, dependencies, housekeeping | none |
| `refactor` | Code restructure without behavior change | none |
| `test` | Adding or updating tests | none |
| `build` | Build system or tooling changes | none |
| `ci` | CI workflow changes | none |
| `BREAKING CHANGE` | Footer or `!` suffix, incompatible change | major |

### Valid examples ✅

```
feat(s3): add object preview panel to the bucket explorer
fix(api): handle missing region in EC2 status call
perf(frontend): memoize the service catalog query
chore: bump vite to 5.4
docs: update README with multicloud compose profile
refactor(serverless): extract lambda env-var mapping
test(api): cover the clouds/aws/status route
feat(api)!: change resource list response shape
ci: add multi-arch release workflow
```

### Invalid examples ❌

```
Add object preview                   # missing type
Feature: add something               # "Feature" is not a valid type
feat : space before colon            # space before colon
feat(s3)add missing colon            # missing colon
FIX(api): uppercase type             # type must be lowercase
feat(my scope): scope has spaces     # scope cannot contain spaces
wip: still working on this           # "wip" is not a recognised type
```

Do not include `Co-Authored-By` trailers for AI tools in commit messages. Attribution
should be limited to human contributors.

## Architecture & Agent Instructions

See [AGENTS.md](AGENTS.md) for a detailed description of the architecture (frontend →
`/api/*` → Cloud Proxy → adapters), the schema-driven multi-cloud model, and the canonical
pattern for adding a new service to the Cloud Explorer.

`AGENTS.md` is the canonical agent-instructions file for this repository, following the
[AGENTS.md standard](https://agents.md/). The agent-specific filenames are symlinks to it,
so there is a single source of truth. If your coding agent expects a different filename,
create a local symlink to `AGENTS.md` instead of copying the file:

```bash
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
ln -s ../AGENTS.md .github/copilot-instructions.md
```

## Adding a New Service UI

When wiring a new service into the console, follow these rules:

- Use existing Floci AWS-compatible endpoints. Do not add custom backend endpoints
  just for the UI unless the core project explicitly accepts that contract.
- In `packages/api`, add a route that calls the appropriate AWS SDK v3 client against
  Floci core. Never invent a custom protocol.
- In `packages/frontend`, add the service page and register it in the navigation.
- Prefer real empty states over sample data; show placeholders when a service is not
  wired yet. No decorative data or fake operational metrics.
- Keep service status notes in the README accurate.
- Add verification notes for any newly wired operations.

## Pull Request Guidelines

1. Branch off `main`: `git checkout -b feat/my-feature`
2. Open a PR targeting `main`.
3. Make sure `pnpm lint`, `pnpm type-check`, `pnpm test`, and `pnpm build` all pass before requesting review.
4. Keep PRs focused: one feature or fix per PR.
5. Reference any related issues in the PR description.

Docker images are never built on contributor PRs, so merging to `main` is always cheap.

## Release Process (maintainers)

Releases are cut when there is something worth shipping. Unlike the emulators, floci-ui is
not on a fixed train.

Releases are cut from `main` with the **Release Cut** workflow (Actions -> Release Cut ->
Run workflow). semantic-release analyzes the Conventional Commits since the last tag, bumps
the version in `package.json` and `packages/frontend/package.json`, regenerates
`CHANGELOG.md`, commits, tags, and publishes the GitHub Release. Use the `dry-run` input to
preview the next version and release notes without releasing anything.

The tag push then triggers `.github/workflows/release.yml`, which builds the frontend bundle
and the API binary, then packages and pushes a multi-arch (`linux/amd64,linux/arm64`)
image as `floci/floci-ui:x.y.z` and `floci/floci-ui:latest`.

Publishing requires the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets, and
the Release Cut workflow requires `GH_TOKEN` to be a fine-grained PAT with contents:write.
The default `GITHUB_TOKEN` cannot be used: tags pushed with it do not trigger other
workflows, so `release.yml` would never run.

`CHANGELOG.md` is generated. Do not edit it by hand; a genuine correction goes in a PR
carrying the `changelog-edit` label.

Nothing is published on PR merge: only a release cut produces artifacts.

## Testing Policy for Pull Requests

As a project policy:

- Pull requests that introduce new behavior should include tests that validate it
  (`bun test` in `packages/api`), or a clear note on why they can't be tested in isolation.
- Pull requests that fix bugs should include a regression test whenever realistic.
- Documentation, formatting, dependency housekeeping, or low-risk refactors may not
  require new tests, but `pnpm lint`, `pnpm type-check`, and the existing suite must
  still pass.

All checks (`pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm build`) must pass before merge.

## Reporting Security Issues

Please do **not** open public issues for security vulnerabilities. Report them privately
using [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability).
