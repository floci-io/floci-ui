---
type: Rule
title: {rule-title}
description: {rule-description}
tags: {rule-tags}
timestamp: {timestamp}
id: {rule-id}
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
> This directive is {age-days} days old. Before applying:
> - [ ] Pattern still exists in current codebase
> - [ ] Rule is actively followed by team
> - [ ] No conflicting rules introduced
> - [ ] Examples are still valid and tested
>
> **Verification Date**: {verified-date}
> **Verify Again After**: {verify-after-date} (30 days)

# {Rule Title}

{Rule content from CDR proposed content}

## Scope

{Scope information from CDR}

## Rationale

{Rationale from CDR decision section}

## Examples

### Compliant

```
{Example of compliant code}
```

### Non-Compliant

```
{Example of non-compliant code}
```

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

*This rule is part of team-ai-directives. Last updated: {modified-date}*
