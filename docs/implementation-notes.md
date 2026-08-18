# Implementation Notes

This document tracks the current architectural direction behind the new Floci UI shell.

## What Changed

- Introduced the Cloud Proxy API under `/api/clouds/*`.
- Added shared SPI contracts in `packages/api/src/cloud-spi`.
- Added the `CloudAdapterRegistry` to resolve cloud + service pairs.
- Moved the main UX toward `Console Home` and `Cloud Explorer`.
- Kept `Secrets Manager` as a dedicated AWS page during the transition.

## Adapters Currently Registered

- AWS Storage
- AWS k8s
- AWS Database
- AWS DynamoDB
- AWS Compute
- AWS Networking
- AWS Serverless
- Azure Storage
- Azure Database
- Azure Serverless
- GCP Storage

## Current UI Surface

The frontend currently exposes:

- `Console Home`
- `Cloud Explorer / storage`
- `Cloud Explorer / k8s`
- `Cloud Explorer / database`
- `Cloud Explorer / nosql`
- `Cloud Explorer / compute`
- `Cloud Explorer / networking`
- `Cloud Explorer / serverless`
- `/secretsmanager`

Not every registered adapter is already promoted into the visible sidebar for every provider. The README reflects the user-visible surface, not only what is registered in the backend.

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
