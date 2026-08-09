---
type: Skill
name: helm-charts
title: Helm Charts
description: "Helm chart authoring patterns including chart libraries, wrapper charts, template helpers, and packaging standards. Use when creating or reviewing Helm charts, building chart library abstractions, packaging Kubernetes applications, or designing multi-environment Helm deployments."
tags: [devops, helm, kubernetes, charts, packaging]
timestamp: 2026-08-04T00:00:00Z
id: skill-helm-charts
cdr_ref: null
created: 2026-01-16
modified: 2026-06-14
verified: 2026-08-04
age_days: 0
evidence: []
instruction_type: Generation
priority: Standard
---

# Helm Charts Skill

## What This Skill Provides

Helm chart design patterns including library charts, wrapper charts, template
helper conventions, and packaging and distribution workflows for Kubernetes
applications.

## When to Use This Skill

- Creating a new Helm chart or chart library
- Reviewing or refactoring an existing Helm chart
- Packaging and publishing charts to a chart repository or OCI registry
- Designing multi-environment value override strategies
- Building wrapper charts around upstream community charts

## Core Patterns

### Chart Library Pattern

**Rule**: Centralize shared templates in a library chart to eliminate
duplication across application charts.

**Implementation**:
- Create a `type: library` chart with shared `_helpers.tpl` templates
- Application charts declare the library as a dependency
- Store library charts in a dedicated shared chart repository
- Library charts cannot be installed directly — only used as dependencies

**References**: See @rule:devops/helm_chart_library.md, @rule:devops/helm_template_helpers.md

### Wrapper Charts

**Rule**: Wrap upstream community charts to control versions and apply team
defaults without forking upstream.

**Implementation**:
- Declare the upstream chart as a `dependencies` entry in `Chart.yaml`
- Override defaults via `values.yaml` in the wrapper chart
- Lock the upstream chart version in `Chart.lock`
- Add team-standard labels, annotations, and security contexts via the wrapper

**References**: See @rule:devops/helm_wrapper_charts.md

### Template Helpers

**Rule**: Define reusable naming, labeling, and annotation helpers in `_helpers.tpl`.

**Implementation**:
- Use `{{ include "chart.fullname" . }}` patterns for consistent resource naming
- Define standard label sets (app, version, managed-by) in a shared helper
- Keep helpers idempotent and side-effect free

**References**: See @rule:devops/helm_template_helpers.md

### Packaging and Distribution

**Rule**: Package and release charts through an automated CI/CD pipeline.

**Implementation**:
- Use `helm package` and `helm push` in GitHub Actions on version tag
- Version charts using semantic versioning aligned with app versions
- Publish to an OCI registry (e.g., GHCR) or a dedicated chart repository

**References**: See @rule:devops/helm_packaging.md
