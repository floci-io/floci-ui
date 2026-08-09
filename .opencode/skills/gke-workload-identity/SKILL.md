---
type: Skill
name: gke-workload-identity
title: GKE Workload Identity
description: "GKE Workload Identity configuration for keyless GCP authentication. Use when configuring GKE pods to authenticate to GCP APIs without service account key files, setting up IAM bindings between Kubernetes service accounts and GCP service accounts, or troubleshooting Workload Identity permission errors on GKE."
tags: [devops, gke, gcp, security, authentication, workload-identity]
timestamp: 2026-08-04T00:00:00Z
id: skill-gke-workload-identity
cdr_ref: null
created: 2026-01-16
modified: 2026-06-14
verified: 2026-08-04
age_days: 0
evidence: []
instruction_type: Security
priority: Critical
---

# GKE Workload Identity Skill

## What This Skill Provides

Patterns for configuring GKE Workload Identity so Kubernetes workloads
can authenticate to GCP services (Secret Manager, GCS, BigQuery, etc.)
without long-lived service account key files.

## When to Use This Skill

- Configuring a GKE pod to access GCP APIs (Secret Manager, GCS, BigQuery, etc.)
- Setting up IAM bindings between Kubernetes and GCP service accounts
- Replacing existing service account key files with Workload Identity
- Configuring External Secrets Operator with GCP Secret Manager backend
- Troubleshooting `PERMISSION_DENIED` or `403` errors from GKE workloads

## Core Patterns

### Workload Identity Binding

**Rule**: Bind a Kubernetes ServiceAccount to a GCP service account via
IAM annotation — no key files.

**Implementation**:
- Annotate the Kubernetes ServiceAccount:
  `iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com`
- Grant the GCP service account `roles/iam.workloadIdentityUser` for the KSA:
  `serviceAccount:<project>.svc.id.goog[<namespace>/<ksa-name>]`
- Enable Workload Identity on the GKE node pool (`--workload-metadata=GKE_METADATA`)

**References**: See @rule:devops/gke_workload_identity.md

### Least Privilege GCP Roles

**Rule**: Grant only the minimum GCP roles required per workload — one GCP
service account per application.

**Implementation**:
- Audit the exact GCP APIs the workload calls and grant only those roles
- Use separate GCP service accounts per application, not one shared account
- Never grant `roles/owner` or `roles/editor` to workload identities
- Use predefined or custom roles scoped to specific resources where possible

**References**: See @rule:devops/gke_workload_identity.md

### Validation and Troubleshooting

**Rule**: Verify the Workload Identity binding before deploying dependent workloads.

**Implementation**:
- Use `gcloud iam service-accounts get-iam-policy <gsa>` to confirm the binding
- Test authentication from within a pod using the metadata server endpoint
- Check node pool metadata server mode: must be `GKE_METADATA`, not `EXPOSED`

**References**: See @rule:devops/gke_workload_identity.md
