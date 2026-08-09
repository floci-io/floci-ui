---
type: Skill
name: {skill-name}
title: {skill-title}
description: {skill-description}
tags: {skill-tags}
timestamp: {timestamp}
id: {skill-id}
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
> This skill is {age-days} days old. Verify before use:
> - [ ] Trigger keywords still relevant
> - [ ] Instructions still accurate
> - [ ] References still accessible
> - [ ] No better alternative exists
>
> **Verification Date**: {verified-date}
> **Verify Again After**: {verify-after-date} (30 days)

# {Skill Name}

## Description

{Skill description}

## Trigger Keywords

- {keyword1}
- {keyword2}
- {keyword3}

## Instructions

{Detailed instructions from CDR proposed content}

## Context

{When to use this skill}

## Examples

### Example 1

**Trigger**: {Example trigger phrase}

**Expected Behavior**: {What the agent should do}

### Example 2

**Trigger**: {Example trigger phrase}

**Expected Behavior**: {What the agent should do}

## References

- {Reference 1}
- {Reference 2}

## Source

- **Contributed from**: {project-name}
- **CDR**: {cdr-id}
- **Published**: {modified-date}
- **Signal Gate**: ✓ Team-wide | ✓ High Value | ✓ Unique | ✓ Evidence

## Evidence

{Evidence section from original CDR}

## Verification Log

| Date | Verified By | Notes |
|------|-------------|-------|
| {verified-date} | {project-name} | Initial publication via /levelup.implement |

---

*This skill is part of team-ai-directives. Last updated: {modified-date}*
