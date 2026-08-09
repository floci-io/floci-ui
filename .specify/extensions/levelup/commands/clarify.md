---
description: Resolve ambiguities in discovered/proposed CDRs through targeted clarification
handoffs:
  - label: Refine from Feature Context
    agent: adlc.levelup.specify
    prompt: Add context from current feature spec to CDRs
    send: false
  - label: Build Skills
    agent: adlc.levelup.skill
    prompt: Build one skill from accepted CDRs
    send: false
  - label: Create PR
    agent: adlc.levelup.implement
    prompt: Compile accepted CDRs to team-ai-directives PR
    send: false
scripts:
  sh: .specify/extensions/levelup/scripts/bash/setup-levelup.sh --json
  ps: .specify/extensions/levelup/scripts/powershell/setup-levelup.ps1 -Json
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

**Examples of User Input**:

- `"CDR-001 CDR-003"` - Focus on specific CDRs
- `"rules"` - Clarify only rule-type CDRs
- `"all"` - Clarify all pending CDRs
- Empty input: Clarify all CDRs with status "Discovered" or "Proposed"

## Goal

Identify underspecified areas in discovered or proposed CDRs and refine them through targeted clarification questions. Ensure CDRs are complete, consistent, and ready for implementation.

**Input**: CDRs from `{REPO_ROOT}/.specify/drafts/cdr.md` with status "Discovered" or "Proposed"

**Output**: Updated CDRs with refined content and new statuses in `{REPO_ROOT}/.specify/drafts/cdr.md`

## Role & Context

You are acting as a **Context Validator** reviewing discovered patterns. Your role involves:

- **Validating** that discovered patterns are still relevant
- **Clarifying** pattern scope (team-wide vs project-specific)
- **Checking** against existing team-ai-directives for overlap
- **Refining** CDR content through targeted questions

### CDR Quality Checklist

Each CDR should have:

- [ ] Clear context explaining the pattern
- [ ] Explicit decision statement
- [ ] Evidence from codebase
- [ ] Target module path well-formed
- [ ] Status is accurate (Discovered/Proposed/Accepted/Rejected/Deprecated)
- [ ] No conflicts with existing directives
- [ ] Team-wide applicability (not project-specific)

## Outline

1. **Load Current State**: Parse `{REPO_ROOT}/.specify/drafts/cdr.md` and team-ai-directives
2. **Analyze CDRs**: Check each CDR against quality checklist
3. **Identify Gaps**: List areas needing clarification
4. **Interactive Refinement**: Ask targeted questions to fill gaps
5. **Update CDRs**: Write refined CDRs back to file

## Execution Steps

### Phase 0: Pre-Validation

**Objective**: Validate CDR completeness before proceeding

For each pending CDR, check:

1. **Content completeness**: Does the CDR have Context, Decision, and Evidence sections?
2. **Target module validity**: Is the target module path well-formed?
3. **Evidence presence**: Does the CDR reference specific code files or snippets?

If any CDR fails pre-validation:

```markdown
## CDR Pre-Validation Issues

The following CDRs need more information before clarification:

| CDR | Issue | Required |
|-----|-------|----------|
| CDR-XXX | Missing Evidence section | Add code references |
| CDR-YYY | Empty proposed content | Add proposed directive content |

These CDRs will be skipped. Run `/levelup.specify` to add missing context.
```

Skip invalid CDRs from the clarification session. Proceed with valid CDRs only.

### Phase 1: Environment Setup

**Objective**: Initialize CDR infrastructure and resolve paths

Run `{SCRIPT}` from repository root and parse JSON output:

```json
{
  "REPO_ROOT": "/path/to/project",
  "TEAM_DIRECTIVES": "/path/to/team-ai-directives",
  "SKILLS_DRAFTS": "/path/to/project/.specify/drafts/skills",
  "BRANCH": "current-branch"
}
```

### Phase 2: Load Pending CDRs

**Objective**: Load CDRs that need clarification

Read `{REPO_ROOT}/.specify/drafts/cdr.md` and filter:

- **Include**: Status = "Discovered" or "Proposed"
- **Skip**: Status = "Accepted", "Rejected", "Deprecated"

If user specified specific module IDs, filter to those.

If TEAM_DIRECTIVES exists, load existing directives for overlap checking:
- `{TEAM_DIRECTIVES}/context_modules/constitution.md`
- `{TEAM_DIRECTIVES}/context_modules/rules/**/*.md`
- `{TEAM_DIRECTIVES}/context_modules/personas/*.md`
- `{TEAM_DIRECTIVES}/context_modules/examples/**/*.md`
- `{TEAM_DIRECTIVES}/skills/**/*`

### Phase 3: Gap Identification

**Objective**: Prioritize clarification needs

Generate a gap report:

```markdown
## CDR Clarification Report

### Summary
- Total CDRs: [N]
- Complete: [N]
- Needs Clarification: [N]

### Gaps by CDR

| CDR | Title | Gap Type | Severity | Priority |
|-----|-------|----------|----------|----------|
| CDR-001 | [Title] | Missing scope | HIGH | 1 |
| CDR-002 | [Title] | Unclear validity | MEDIUM | 2 |
| CDR-003 | [Title] | Duplicate check needed | HIGH | 3 |

### Cross-CDR Issues

| Issue | CDRs Affected | Description |
|-------|---------------|-------------|
| [Conflict] | CDR-001, CDR-003 | [Description of conflict] |
```

#### Gap Types

- **Missing scope**: Team-wide vs project-specific unclear
- **Unclear validity**: Pattern status unknown (active/deprecated?)
- **Duplicate check needed**: May overlap with existing directives
- **Content incomplete**: Missing context, decision, or evidence
- **Target module unclear**: Module path needs clarification

#### Gap Prioritization

- **CRITICAL**: Constitution violation, obvious duplicate
- **HIGH**: Scope unclear, missing context, high-value pattern
- **MEDIUM**: Content needs work, minor gaps
- **LOW**: Minor improvements, optional details

### Phase 4: Sequential Clarification

**Objective**: Process ONE CDR at a time with targeted questions

---

#### CRITICAL: Interactive Mode Enforcement

This phase REQUIRES user input at each step. DO NOT:
- Present multiple CDRs together in a single response
- Auto-select actions or assume user preference
- Proceed to next CDR without receiving explicit input
- Ask more than one question at a time

---

#### Session Limits

- **Limit to 5 clarifications** per session
- User can say "done" to end session early
- Suggest running again for remaining CDRs

---

#### For Each CDR (Sequential):

**IMPORTANT**: Present exactly ONE CDR per interaction. Complete all actions for that CDR before moving to the next.

```markdown
## CDR-{ID}: {Title}

**Context Type**: {type}
**Target Module**: {target}
**Current Status**: {status}

### Current Content

**Context**: 
{context}

**Decision**: 
{decision}

**Evidence**: 
{evidence}

### Choose Action

| Option | Action |
|--------|--------|
| A | **Accept** - Approve for implementation |
| B | **Reject** - Decline with reason |
| C | **Defer** - Skip for now, keep pending |

Reply with your choice (A/B/C).

---
[WAIT FOR USER INPUT - DO NOT PROCEED WITHOUT ANSWER]
---
```

After receiving user input, process the action, then proceed to next CDR.

#### Action A: Accept (No Questions)

Directly update status to **Accepted**:

```markdown
### Decision: Accept

**Status**: {status} → **Accepted**

Added to accepted list for `/levelup.implement`.
```

Update the CDR file immediately after this decision.

---
[WAIT FOR USER INPUT - PROCEED TO NEXT CDR]
---

#### Action B: Reject (With Reason)

Present simplified reason picker:

```markdown
### Decision: Reject

| Option | Reason |
|--------|--------|
| A | Project-specific (not team-wide) |
| B | Duplicate of existing directive |
| C | Deprecated/outdated pattern |

Reply with your choice (A/B/C).

**Status**: {status} → **Rejected**
```

Update the CDR file immediately after this decision.

---
[WAIT FOR USER INPUT - PROCEED TO NEXT CDR]
---

#### Action C: Defer

```markdown
### Decision: Defer

CDR kept as {status}, will appear in next clarify session.

| Option | Reason |
|--------|--------|
| A | Need more context |
| B | Waiting on team decision |
| C | Low priority |

Reply with your choice (A/B/C).
```

---
[WAIT FOR USER INPUT - PROCEED TO NEXT CDR]
---

#### When Gaps Are Detected

If gaps were identified during Phase 3, ask targeted questions before presenting action choices:

**Example for "Missing scope"**:

```markdown
## CDR-{ID}: {Title}

**Context Type**: {type}
**Target Module**: {target}

### Question 1

**Gap**: Scope unclear

**Question**: Should this pattern be adopted team-wide?

| Option | Description |
|--------|-------------|
| A | Yes, all projects should use this |
| B | Yes, for projects with similar tech stack |
| C | No, this is project-specific |

Reply with your choice.

---
[WAIT FOR USER INPUT]
---
```

After answering, either:
- Ask follow-up questions if needed (max 3 total per CDR)
- Proceed to action choice (Accept/Reject/Defer)

**Question Topics** (based on gap type):

- **Missing scope**: Team-wide vs tech-stack-specific vs project-specific
- **Unclear validity**: Is pattern still actively used?
- **Duplicate check**: Does this overlap with existing directive [X]?
- **Content incomplete**: What's missing from context/decision/evidence?
- **Target module unclear**: Where should this directive live?

### Phase 5: Update CDR File

**Objective**: Write updates to `{REPO_ROOT}/.specify/drafts/cdr.md` after EACH CDR interaction

Update immediately after each CDR decision (not in batch at end):

1. Update status in CDR index table
2. Add clarification metadata to each CDR section:

```markdown
### CDR-{ID}: {Title}

**Status**: Accepted | Rejected | Proposed

### Clarification

- **Date**: {YYYY-MM-DD}
- **Action**: {Accept|Reject|Defer}
- **Questions Asked**: {N}
- **Answers**: {summary of answers}
```

### Phase 6: Summary

**Objective**: Present clarification results

```markdown
## LevelUp Clarify Summary

**Date**: {date}
**Total CDRs Reviewed**: {N}
**Clarifications Used**: {M} / 5

### Results

| Action | Count |
|--------|-------|
| Accepted | {n} |
| Rejected | {n} |
| Deferred | {n} |

### Accepted (Ready for Implementation)

| CDR | Target Module | Type |
|-----|---------------|------|
| CDR-001 | rules/python/error-handling | Rule |
| CDR-002 | skills/validation | Skill |

### Rejected

| CDR | Reason |
|-----|--------|
| CDR-003 | Project-specific |

### Deferred (Will Appear Next Session)

| CDR | Title |
|-----|-------|
| CDR-004 | [Title] |

### Remaining CDRs (Not Processed This Session)

| CDR | Title |
|-----|-------|
| CDR-005 | [Title] |

Run `/levelup.clarify` again to process remaining CDRs.

### Next Steps

1. **Accepted**: Run `/levelup.implement` to create PR
2. **Deferred**: Will appear in next clarify session
3. **Remaining**: Run `/levelup.clarify` to continue

### Clarifying Loop

To re-review any CDR:
```bash
/levelup.clarify CDR-{ID}
```

This allows another pass after content updates or additional investigation.
```

### Phase 7: Handoff Options

Present manual handoff options:

```markdown
### Available Handoffs

**Option 1: Refine from Feature Context**
Run `/levelup.specify` to:
- Add evidence from current feature spec
- Link CDRs to implementation

**Option 2: Build Skills**
Run `/levelup.skill {topic}` to:
- Build one skill from accepted CDRs

**Option 3: Create PR**
Run `/levelup.implement` to:
- Compile accepted CDRs into PR
- Submit to team-ai-directives
```

---

## Output Files

| File | Description |
|------|-------------|
| `{REPO_ROOT}/.specify/drafts/cdr.md` | Updated Context Directive Records |

## Notes

- **One-at-a-time**: Present exactly ONE CDR per interaction, ONE question at a time
- **Wait for input**: Never auto-proceed without user response
- **Session limits**: Limit to 5 clarifications per session
- **Early exit**: User can say "done" to end early
- **Immediate writes**: Update CDR file after each CDR interaction (not batch)
- **Clarifying loop**: Run `/levelup.clarify` again after content updates
- No automatic handoff - user decides next step

## Related Commands

- `/levelup.init` - Discover CDRs from codebase
- `/levelup.specify` - Refine CDRs from feature context
- `/levelup.skill` - Build one skill from accepted CDRs
- `/levelup.implement` - Create PR to team-ai-directives
- `/architect.clarify` - Similar pattern for ADR clarification
- `/product.clarify` - Similar pattern for PDR clarification
