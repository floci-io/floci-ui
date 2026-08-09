# Executable Team Standard Template

This template follows the four-part anatomy from "Encoding Team Standards"
([https://martinfowler.com/articles/reduce-friction-ai/encoding-team-standards.html](https://martinfowler.com/articles/reduce-friction-ai/encoding-team-standards.html)).

## Overview

Executable Team Standards encode tacit team knowledge into AI instructions that execute consistently, regardless of who is prompting. This differs from general skills by emphasizing **prioritized standards** and **structured output format**.

## When to Use This Template

Use this template when creating skills for:

- **Generation**: How team generates new code (services, functions, tests)
- **Review**: How team reviews code (PR reviews, quality checks)
- **Refactor**: How team improves existing code (clean-up, optimization)
- **Security**: How team checks for vulnerabilities (auditing, scanning)

For general capabilities that don't fit these categories, use the standard skill format instead.

---

## Template: Executable Team Standard

```markdown
---
name: {skill-name}
description: >
  {Short description of what this standard provides}
  Use when {trigger phrases}.
instruction_type: {Generation|Review|Refactor|Security}
priority_structure: true
---

# {Standard Name}

**Instruction Type**: {Generation | Review | Refactor | Security}

{Brief description with trigger keywords for activation}

## Part 1: Role Definition

Role: {senior engineer | reviewer | security expert} following team patterns for {instruction type}

This role sets the expertise level and perspective through which all subsequent instructions are applied.

## Part 2: Context Requirements

### Required Context

- {Code context needed - e.g., the codebase, relevant files}
- {Project architecture - e.g., service structure, layers}
- {Team conventions - e.g., naming, error handling patterns}

### Optional Context

- {Additional constraints or considerations}

## Part 3: Categorized Standards

### Critical (Must Follow)

Non-negotiable patterns that block merge if violated:

- {Critical pattern 1}
- {Critical pattern 2}
- {Security requirement if applicable}

### Standard (Should Follow)

Conventions that are frequently corrected in code review:

- {Standard convention 1}
- {Standard convention 2}

### Preference (Nice to Have)

Style variations and minor optimizations:

- {Preference 1}
- {Preference 2}

## Part 4: Output Format

For Generation instructions, output the code with these conventions:

- {Code structure requirements}
- {Naming conventions}
- {Error handling approach}

For Review/Refactor/Security instructions, output structured findings:

```text
## Summary
{Brief overview of what was done}

## Categorized Findings

### Critical (Must Fix)
- {Finding 1}
- {Finding 2}

### Standard (Should Fix)
- {Finding 1}
- {Finding 2}

### Preference (Nice to Have)
- {Finding 1}

## Next Steps
- {Action item 1}
- {Action item 2}
```

## Trigger Keywords

- {keyword/phrase 1}
- {keyword/phrase 2}
- {keyword/phrase 3}

## Examples

### Example 1: {Example Title}

```text
{Code example or scenario}
```

### Example 2: {Example Title}

```text
{Code example or scenario}
```

## Source

- Original pattern discovered in: {file/path}
- Related CDRs: {CDR-XXX}
- Article reference: <https://martinfowler.com/articles/reduce-friction-ai/encoding-team-standards.html>

---

*Template Version: 1.0.0*
*Compatible with team-ai-directives and LevelUp extension*

---

## Quick Reference Card

| Instruction Type | Trigger Phrases | Output |
|-----------------|-----------------|--------|
| **Generation** | "create new", "implement", "write function" | Code with team conventions |
| **Review** | "review PR", "check quality", "audit code" | Categorized findings |
| **Refactor** | "clean up", "simplify", "optimize" | Categorized improvements |
| **Security** | "check security", "vulnerability audit" | Categorized by severity |

### Priority Levels

| Priority | Meaning | Action |
|----------|---------|--------|
| **Critical** | Must follow | Block merge if violated |
| **Standard** | Should follow | Require in code review |
| **Preference** | Nice to have | Suggest but don't require |

## Reference

"Encoding Team Standards" by Rahul Garg (Martin Fowler, 2026)
