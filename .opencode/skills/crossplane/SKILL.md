---
type: Skill
name: crossplane
title: Crossplane
description: "Crossplane composition patterns for cloud-agnostic infrastructure as code. Use when writing Crossplane Compositions, XRDs (CompositeResourceDefinitions), or Claims, managing cloud resources declaratively from Kubernetes, or designing platform team infrastructure abstractions with Crossplane."
tags: [devops, crossplane, infrastructure, iac, kubernetes, cloud]
timestamp: 2026-08-04T00:00:00Z
id: skill-crossplane
cdr_ref: null
created: 2026-01-16
modified: 2026-06-14
verified: 2026-08-04
age_days: 0
evidence: []
instruction_type: Generation
priority: Standard
---

# Crossplane Skill

## What This Skill Provides

Patterns for authoring Crossplane Compositions and XRDs that provide
developer-facing infrastructure abstractions backed by cloud provider
managed resources.

## When to Use This Skill

- Writing Crossplane Compositions or XRDs
- Creating developer-facing composite resource Claims
- Designing platform team infrastructure abstractions
- Migrating Terraform resource definitions to Crossplane
- Debugging Composition or Claim reconciliation issues

## Core Patterns

### XRD > Composition > Claim Hierarchy

**Rule**: Define a clear three-layer hierarchy for each infrastructure domain.

**Implementation**:
- **XRD**: Defines the API schema (the "CRD for platform users")
- **Composition**: Maps XRD fields to one or more cloud provider managed resources
- **Claim**: What application teams use to request infrastructure
- Keep XRDs stable; evolve Compositions without breaking Claim consumers

**References**: See @rule:devops/crossplane_compositions.md

### DRY Compositions with PatchSets

**Rule**: Avoid duplicating managed resource definitions across Compositions.

**Implementation**:
- Use `patchSets` for groups of patches applied to multiple resources
- Use `transforms` for value mapping rather than hardcoding environment-specific values
- Parameterize Compositions via XRD fields rather than forking per environment

**References**: See @rule:devops/crossplane_compositions.md

### Composition Validation and Testing

**Rule**: Validate Compositions before applying to production clusters.

**Implementation**:
- Use `crossplane beta validate` to lint XRDs and Compositions
- Test Claim rendering in an isolated dev cluster before promoting
- Monitor Composition health via `crossplane beta trace`

**References**: See @rule:devops/crossplane_compositions.md
