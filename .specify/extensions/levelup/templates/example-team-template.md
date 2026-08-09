---
type: Example
title: {example-title}
description: {example-description}
tags: {example-tags}
timestamp: {timestamp}
id: {example-id}
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
> This example is {age-days} days old. Verify before use:
> - [ ] Code still compiles/runs
> - [ ] API signatures unchanged
> - [ ] Best practices still current
> - [ ] Dependencies still available
>
> **Verification Date**: {verified-date}
> **Verify Again After**: {verify-after-date} (30 days)

# {Example Title}

## Context

{Context description from CDR - when to use this example}

## Code

```{language}
{Code example from CDR proposed content}
```

## Explanation

{Detailed explanation of the code}

## Usage

{How to use this example in practice}

## Source

- **Contributed from**: {project-name}
- **CDR**: {cdr-id}
- **Published**: {modified-date}
- **Signal Gate**: ✓ Team-wide | ✓ High Value | ✓ Unique | ✓ Evidence

## Evidence

{Evidence section from original CDR}

## Related Examples

- [Example 1](link)
- [Example 2](link)

## Verification Log

| Date | Verified By | Notes |
|------|-------------|-------|
| {verified-date} | {project-name} | Initial publication via /levelup.implement |

---

*This example is part of team-ai-directives. Last updated: {modified-date}*
