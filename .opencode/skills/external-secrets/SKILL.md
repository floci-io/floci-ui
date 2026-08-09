---
type: Skill
name: external-secrets
title: External Secrets
description: "External Secrets Operator (ESO) patterns for syncing secrets from cloud secret stores into Kubernetes. Use when integrating AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or other backends with Kubernetes workloads, designing secret rotation strategies, or following DRY secrets management patterns across namespaces."
tags: [devops, secrets, kubernetes, security, external-secrets, cloud]
timestamp: 2026-08-04T00:00:00Z
id: skill-external-secrets
cdr_ref: null
created: 2026-01-16
modified: 2026-06-14
verified: 2026-08-04
age_days: 0
evidence: []
instruction_type: Security
priority: Critical
---

# External Secrets Skill

## What This Skill Provides

Patterns for configuring External Secrets Operator to synchronize secrets
from cloud providers into Kubernetes, including ClusterSecretStore setup,
ExternalSecret resources, DRY secret organization, and secret rotation.

## When to Use This Skill

- Setting up `ExternalSecret` or `ClusterSecretStore` resources
- Integrating AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault
- Designing secret naming conventions and sync intervals
- Implementing secret rotation without requiring pod restarts
- Avoiding duplicated secret definitions across namespaces

## Core Patterns

### ClusterSecretStore Configuration

**Rule**: Define a single `ClusterSecretStore` per secret backend, shared
across all namespaces.

**Implementation**:
- Use `ClusterSecretStore` (not namespace-scoped `SecretStore`) for team-wide backends
- Authenticate using Workload Identity (GKE) or IRSA (EKS) — never static credentials
- Reference the store by name from `ExternalSecret` resources in any namespace

**References**: See @rule:devops/external_secrets_operator.md

### DRY Secret Management

**Rule**: Define secret paths and key structures once; reference them consistently
across environments.

**Implementation**:
- Establish a naming convention: `/<env>/<service>/<secret-name>`
- Use `dataFrom` bulk sync for services with many keys to avoid one entry per key
- Centralize secret path definitions in a shared Helm values file or ConfigMap

**References**: See @rule:devops/secrets_management_dry.md, @rule:devops/external_secrets_operator.md

### Secret Rotation

**Rule**: Design for automatic secret rotation without application downtime.

**Implementation**:
- Set `refreshInterval` on `ExternalSecret` to match the backend's rotation schedule
- Use ESO's `creationPolicy: Merge` to avoid disrupting existing consumers
- Ensure applications read secrets at startup or watch for `Secret` updates

**References**: See @rule:devops/external_secrets_operator.md
