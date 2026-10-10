# Implementation Notes

This document tracks the current architectural direction behind the new Floci UI shell.

## What Changed

- Introduced the Cloud Proxy API under `/api/clouds/*`.
- Added shared SPI contracts in `packages/api/src/cloud-spi`.
- Added the `CloudAdapterRegistry` to resolve cloud + service pairs.
- Moved the main UX toward `Console Home` and `Cloud Explorer`.
- Kept `Secrets Manager` as a dedicated AWS page during the transition.

## Registered Adapters and UI Surface

Registered adapters are not listed here, because a hand-written list drifts. The source of truth is `packages/api/src/cloudProxy.ts`, which registers every adapter, and `packages/api/src/cloud-spi/serviceCatalog.ts`, which defines the services.

The README "Supported Services" table is generated from both, per cloud and per service. After changing either, regenerate it:

    cd packages/api && bun run scripts/service-matrix.ts

The visible console is `Console Home`, `Cloud Explorer` for each catalog service, and the dedicated `/secretsmanager` page. Not every registered adapter is promoted into the visible sidebar for every provider; the README reflects the user-visible surface, not only what is registered in the backend.

## Active Transitional State

The codebase is in a hybrid stage:

- Unified shell and metadata-driven proxy are the default direction.
- Some AWS workflows still depend on provider-specific panels inside the new shell.
- `Secrets Manager` remains outside Cloud Explorer for now.
- Old AWS legacy pages were intentionally removed instead of being carried forward.

## Next Cleanup Targets

- Move remaining dedicated AWS workflows into Cloud Explorer where practical.
- Keep provider-neutral contracts ahead of new provider-specific UI.
- Continue reducing README drift whenever the visible navigation changes.
