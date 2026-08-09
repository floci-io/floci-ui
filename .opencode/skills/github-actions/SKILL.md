---
type: Skill
name: github-actions
title: GitHub Actions
description: "GitHub Actions CI/CD pipeline patterns. Use when writing or reviewing GitHub Actions workflows, setting up reusable or organization-level workflows, configuring OIDC for cloud authentication, or implementing automated build and deploy pipelines."
tags: [devops, github-actions, cicd, automation, oidc]
timestamp: 2026-08-04T00:00:00Z
id: skill-github-actions
cdr_ref: null
created: 2026-01-16
modified: 2026-06-14
verified: 2026-08-04
age_days: 0
evidence: []
instruction_type: Generation
priority: Standard
---

# GitHub Actions Skill

## What This Skill Provides

Patterns and best practices for GitHub Actions including reusable workflows,
OIDC-based cloud authentication, pipeline organization, security controls,
and concurrency management.

## When to Use This Skill

- Writing or reviewing GitHub Actions workflow files
- Setting up reusable or organization-level shared workflows
- Configuring OIDC for AWS, GCP, or Azure authentication
- Structuring CI (build/test) and CD (deploy) pipelines
- Debugging workflow failures or optimizing pipeline performance

## Core Patterns

### Reusable Workflows

**Rule**: Structure pipelines as composable units using `workflow_call`.

**Implementation**:
- Create organization-level reusable workflows triggered by `workflow_call`
- Version reusable workflows using Git tags or commit SHAs
- Separate build, test, and deploy concerns into distinct callable workflows
- Use composite actions for small, reusable step groups

**References**: See @rule:devops/github_actions.md

### OIDC Cloud Authentication

**Rule**: Use OIDC for all cloud provider authentication — no long-lived credentials.

**Implementation**:
- Configure GitHub's OIDC provider in AWS, GCP, or Azure IAM
- Set `permissions: id-token: write` at the workflow or job level
- Never store cloud credentials as GitHub Secrets

**References**: See @rule:devops/github_actions.md, @rule:devops/gke_workload_identity.md

### Security Controls

**Rule**: Apply least privilege and proper concurrency controls to all workflows.

**Implementation**:
- Declare minimal `permissions` at the workflow and job level
- Use `concurrency` groups to prevent conflicting parallel deployments
- Pin third-party action versions to a full commit SHA, not a tag

**References**: See @rule:devops/github_actions.md

### Pipeline Organization

**Rule**: Separate CI and CD concerns; group related workflows by function.

**Implementation**:
- Use separate workflows for build/test and deploy stages
- Group workflows in subdirectories by domain (e.g., `.github/workflows/deploy/`)
- Use descriptive workflow and job names for readable run summaries

**References**: See @rule:devops/github_actions.md
