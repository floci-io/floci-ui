---
description: Apply regression-gated CDRs — review, validate, and implement context
  changes
---


<!-- Extension: team-ai-directives -->
<!-- Config: .specify/extensions/team-ai-directives/ -->
## Goal

Read proposed CDRs from `.specify/drafts/cdr.md`, run regression gate against existing team-ai-directives content and project evals, implement passing CDRs as file modifications, and output a results summary.

**This command does NOT perform any Git operations** — no commit, push, or PR creation. Git operations are handled separately in the curation workflow.

**Input**:
- Proposed CDRs from `{REPO_ROOT}/.specify/drafts/cdr.md`
- Existing team-ai-directives content (for dedup and conflict check)
- Project evals (pytest, promptfoo) for regression testing

**Output**:
- Modified files in the repository
- Updated `.specify/drafts/cdr.md` with gate results
- Results summary

## Role & Context

You are a **Context Editor** — reviewing proposed CDRs and applying them to the repository. Your role involves:

- **Validating** CDRs against regression gates
- **Implementing** passing CDRs by modifying files
- **Rejecting** weak or duplicate CDRs
- **NOT** performing any Git operations

## Prerequisites

- `.specify/drafts/cdr.md` exists with at least one proposed CDR
- Team-ai-directives repository accessible (for dedup check)
- Evals pass (optional, only if evals are configured)

## Execution Steps

### Phase 1: Load Proposed CDRs

Read `{REPO_ROOT}/.specify/drafts/cdr.md` and list all CDRs with status "Proposed".

If no proposed CDRs exist:

```
No proposed CDRs found. Run /team.curate to scan traces for patterns.
```

### Phase 2: Regression Gate

For each proposed CDR, validate against these gates:

#### Gate 1: Dedup Check
Check if the CDR duplicates existing team-ai-directives content:

- Read `{TEAM_DIRECTIVES}/CDR.md` descriptor column
- Search `{TEAM_DIRECTIVES}/context_modules/` for similar content
- **FAIL**: CDR duplicates existing content → mark as `Rejected (Duplicate)`

#### Gate 2: Evidence Check
Verify the CDR has concrete evidence:
- Trace file references exist and are readable
- Contains specific patterns, decisions, or code references
- **FAIL**: No concrete evidence → mark as `Rejected (No Evidence)`

#### Gate 3: Team-Wide Applicability
Check if the CDR applies across projects, not just a single project:
- Pattern appears in multiple trace sources
- Decision is about team standards, not project-specific configuration
- **FAIL**: Project-specific → mark as `Rejected (Project-Specific)`

#### Gate 4: Evals Check (optional)
If project has evals configured (pytest, promptfoo):
- Run evals to check for regressions if CDR modifies existing content
- **FAIL**: Evals fail → mark as `Blocked (Evals)`

#### Gate Results Format

Update `.specify/drafts/cdr.md` with gate status for each CDR:

```markdown
### CDR-{YYYYMMDD-NNN}: {Title}

#### Status
Accepted | Rejected ({reason}) | Blocked ({reason})

#### Gate Results
| Gate | Result | Details |
|------|--------|---------|
| Dedup Check | ✅ Pass | No duplicate found |
| Evidence Check | ✅ Pass | References trace-001.md§Decisions |
| Team-Wide Applicability | ✅ Pass | Pattern in 3 project traces |
| Evals Check | ✅ Pass | All tests green |
```

### Phase 3: Implement Accepted CDRs

For each CDR with status "Accepted":

#### Step 1: Determine Target File

Based on CDR type:

| Type | Target Directory | File Naming |
|------|-----------------|-------------|
| Rule | `context_modules/rules/{domain}/` | `{slug}.md` |
| Persona | `context_modules/personas/` | `{slug}.md` |
| Example | `context_modules/examples/{category}/` | `{slug}.md` |
| Constitution | `context_modules/` | `constitution.md` |

Create the directory if it doesn't exist:

```bash
mkdir -p "context_modules/rules/{domain}"
```

#### Step 2: Create or Modify File

Generate the context module file from the CDR's Proposed Content:

```markdown
---
type: {Type}
title: {Title}
description: {Description}
timestamp: {timestamp}
cdr_ref: {CDR-ID}
source_traces:
  - traces/{trace-file}
---

# {Title}

{Proposed Content}
```

For **Constitution Amendment** CDRs, append to existing `constitution.md`:

```markdown
## {Amendment Title}

**CDR Reference**: {CDR-ID}
**Published**: {date}

{Proposed Content}
```

#### Step 3: Update CDR Status

Mark the CDR as "Implemented" in `.specify/drafts/cdr.md`:

```markdown
#### Status
Implemented

#### Target File
`context_modules/rules/{domain}/{slug}.md`
```

### Phase 4: Output Results Summary

```markdown
## Team Evolve Summary

| Metric | Value |
|--------|-------|
| CDRs Proposed | {N} |
| Accepted | {A} |
| Rejected (Duplicate) | {D} |
| Rejected (No Evidence) | {E} |
| Rejected (Project-Specific) | {P} |
| Implemented | {I} |

### Implemented CDRs

| CDR | Type | Target File |
|-----|------|-------------|
| CDR-{id} | Rule | context_modules/rules/python/error-handling.md |

### Rejected CDRs

| CDR | Reason |
|-----|--------|
| CDR-{id} | Duplicate — existing content at ... |

### Next Steps

Run **evals** (pytest / promptfoo) then create a PR:
1. `git.commit --message "Add context modules from curation"` (or shell: `git add . && git commit -m "..."`)
2. `git.publish --title "Curated context modules" --draft`
```

## Notes

- This command only modifies local files — NO Git operations
- All CDRs remain in `.specify/drafts/cdr.md` with updated status
- Rejected CDRs are not deleted — they stay for reference
- To reset and retry rejected CDRs, edit and re-run `team.evolve`

## Related

- `/team.curate` — Create CDR proposals from traces
- `/levelup.clarify` — Manual CDR refinement before implementation (in levelup extension)
- `/levelup.skill` — Build skills from accepted CDRs (in levelup extension)