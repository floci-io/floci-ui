---
type: Persona
title: {persona-title}
description: {persona-description}
tags: {persona-tags}
timestamp: {timestamp}
id: {persona-id}
cdr_ref: {cdr-id}
created: {created-date}
modified: {modified-date}
verified: {verified-date}
age_days: {age-days}
evidence:
  - commit: {commit-sha}
    file: {file-path}
    description: {evidence-description}
---

> ⚠️ **Memory Verification**
> This persona is {age-days} days old. Verify before use:
> - [ ] Role definition still accurate
> - [ ] Expertise areas current
> - [ ] Communication style still applies
> - [ ] Domain knowledge still relevant
>
> **Verification Date**: {verified-date}
> **Verify Again After**: {verify-after-date} (30 days)

# {Persona Name}

## Role

{Role description from CDR}

## Expertise

- {Expertise area 1}
- {Expertise area 2}
- {Expertise area 3}

## Communication Style

{Communication style from CDR}

## Decision-Making Approach

{Decision-making approach from CDR}

## Source

- **Contributed from**: {project-name}
- **CDR**: {cdr-id}
- **Published**: {modified-date}
- **Signal Gate**: ✓ Team-wide | ✓ High Value | ✓ Unique | ✓ Evidence

## Evidence

{Evidence section from original CDR}

## Example Interactions

### Example 1: {Scenario}

**User**: {User prompt}

**Response**: {Expected response style}

### Example 2: {Scenario}

**User**: {User prompt}

**Response**: {Expected response style}

## Verification Log

| Date | Verified By | Notes |
|------|-------------|-------|
| {verified-date} | {project-name} | Initial publication via /levelup.implement |

---

*This persona is part of team-ai-directives. Last updated: {modified-date}*
