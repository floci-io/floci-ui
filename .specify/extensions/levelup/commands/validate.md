---
description: Scan team-ai-directives for rule conflicts and inconsistencies
handoffs:
  - label: Resolve Conflicts
    agent: adlc.levelup.clarify
    prompt: Resolve rule conflicts detected by validate command
    send: true
  - label: Create PR
    agent: adlc.levelup.implement
    prompt: Compile conflict resolution CDRs to team-ai-directives PR
    send: false
scripts:
  sh: .specify/extensions/levelup/scripts/bash/validate-directives.sh --json
  ps: .specify/extensions/levelup/scripts/powershell/validate-directives.ps1 -Json
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

**Examples of User Input**:

- `""` - Validate all rules (default)
- `"rules/python/"` - Validate only Python rules
- `"--severity critical"` - Only report critical conflicts
- `"--format json"` - Output as JSON
- Empty input: Validate all rules in team-ai-directives

## Goal

Scan **team-ai-directives** for rule conflicts and create CDRs for resolution. Additionally, update verification timestamps for rules that pass validation, tracking directive freshness per memory engineering principles.

**Input**: team-ai-directives repository

**Output**:
1. Conflict report (JSON or Markdown)
2. Conflict CDRs in `{REPO_ROOT}/.specify/drafts/cdr.md`
3. Updated verification timestamps in directive files (for rules passing validation)
4. Summary of conflicts by severity and verification status

**Key Concepts**:

- **Rule Conflict Detector**: Validates that team-ai-directives rules don't contradict each other
- **Memory Verification**: Updates `verified` timestamps and resets `age_days` for valid directives
- **Freshness Tracking**: Reports on directive age and stale entries (>30 days)

## Memory Engineering Integration

This command implements the **Verification Discipline** from agent memory engineering:

1. **Scan all directives** in team-ai-directives
2. **Check freshness** (age since last verification)
3. **Validate content** still applies (pattern exists, no conflicts)
4. **Update timestamps** for valid directives:
   - Set `verified` to today's date
   - Reset `age_days` to 0
   - Append entry to verification log
5. **Report stale directives** (>30 days without verification)

**Verification Process**:
- Parse YAML frontmatter from each directive file
- Check `age_days` against threshold (default: 30 days)
- Validate rule content (no conflicts, still applicable)
- Update frontmatter with new verification date
- Report which files were verified vs stale

### Flags

- `--severity LEVEL`: Minimum severity to report (critical, error, warning, info)
- `--format FORMAT`: Output format (json, markdown)
- `--rules-path PATH`: Path to rules directory (default: context_modules/rules)

## Role & Context

You are acting as a **Rule Validator** scanning team-ai-directives for conflicts. Your role involves:

- **Loading** all rules from team-ai-directives
- **Detecting** direct contradictions, semantic conflicts, and constitution conflicts
- **Reporting** conflicts with severity levels
- **Creating** CDRs for conflict resolution

### Conflict Types

| Level | Pattern | Example | Severity |
|-------|---------|---------|----------|
| 1: Direct Contradiction | `must X` vs `never X` | "Must cache" vs "Never cache" | CRITICAL |
| 2: Implicit Contradiction | Logical impossibility | "Cache <50ms" vs "Cache >100ms" | ERROR |
| 3: Exception Conflict | Base vs exception | "No secrets in logs" vs "Log for debug" | WARNING |
| 4: Scope Overlap | Overlapping rules | "All services stateless" vs "DB service stateful" | INFO |
| 5: Constitution Conflict | Rule vs principle | "Must cache" vs Principle: "No caching" | CRITICAL |

## Outline

1. **Environment Setup** (Phase 1): Resolve paths
2. **Load Constitution** (Phase 2): Load team principles
3. **Load Rules** (Phase 3): Load all rule files with YAML frontmatter
4. **Conflict Detection** (Phase 4): Run conflict detection
5. **Constitution Check** (Phase 5): Check rules against constitution
6. **Verification Update** (Phase 6): Update timestamps for valid rules
7. **CDR Generation** (Phase 7): Create conflict CDRs
8. **Report Generation** (Phase 8): Create conflict report
9. **Summary** (Phase 9): Present results

## Execution Steps

### Phase 1: Environment Setup

**Objective**: Resolve paths and validate infrastructure

Run `{SCRIPT}` from repository root and parse JSON output:

```json
{
  "REPO_ROOT": "/path/to/project",
  "TEAM_DIRECTIVES": "/path/to/team-ai-directives",
  "BRANCH": "current-branch"
}
```

### Phase 2: Load Constitution

**Objective**: Load team principles for conflict checking

#### Step 1: Locate Constitution

Find `{TEAM_DIRECTIVES}/context_modules/constitution.md`

#### Step 2: Parse Principles

Extract principles using dynamic detection:

- Look for `###` headings (Markdown)
- Look for numbered sections (1. Principle, 2. Principle)
- Look for keywords: "principle", "shall", "must", "always"

#### Step 3: Build Principle Index

Create JSON index of principles:

```json
{
  "principles": [
    {"id": "p1", "text": "No caching", "source": "constitution.md:23"},
    {"id": "p2", "text": "Security first", "source": "constitution.md:45"}
  ]
}
```

### Phase 3: Load Rules

**Objective**: Load all rule files from team-ai-directives

#### Step 1: Find Rule Files

```bash
find "$TEAM_DIRECTIVES/context_modules/rules" -name "*.md" -type f
```

#### Step 2: Parse Each Rule

For each rule file, extract:

- Rule statement (what the rule requires/prohibits)
- Keywords for conflict detection
- File path and line number

#### Step 3: Build Rule Index

```json
{
  "rules": [
    {
      "id": "r1",
      "file": "rules/python/caching.md",
      "statement": "Must cache responses for 5 minutes",
      "keywords": ["cache", "must", "5 minutes"]
    }
  ]
}
```

### Phase 4: Conflict Detection

**Objective**: Detect conflicts between rules

#### Step 1: Direct Contradiction Detection

Check for opposing keywords:

| Keyword A | Contradiction |
|-----------|---------------|
| must | never, must not, prohibited |
| always | never, never |
| require | forbidden, disallow |
| allow | prohibit, deny |

#### Step 2: Implicit Contradiction Detection

Check for numeric/logical conflicts:

- Timing conflicts ("<50ms" vs ">100ms")
- Scope conflicts (overlapping but different requirements)

#### Step 3: Exception Conflict Detection

Check for base rule vs exception patterns:

- Base rule: "No X in Y"
- Exception: "Allow X in Y for Z"

### Phase 5: Constitution Check

**Objective**: Check rules against constitution principles

#### Step 1: Keyword Matching

Match rule keywords against principle keywords.

#### Step 2: Flag Conflicts

For each rule-principle match that contradicts:

- Flag as CRITICAL severity
- Include in conflict report

### Phase 6: Verification Update (Memory Engineering)

**Objective**: Update `verified` timestamps for rules passing validation (no conflicts)

#### Step 1: Identify Valid Directives

For each loaded rule/persona/example/skill:
- If NO conflicts detected → eligible for verification update
- If conflicts detected → skip (will be resolved via CDR)

#### Step 2: Parse YAML Frontmatter

Extract from each valid directive file:
```yaml
---
type: Rule
verified: 2026-04-15
age_days: 33
---
```

**Validation**: If `type` field is missing, flag as `[WARN] Missing OKF type field` but still proceed with verification update.

#### Step 3: Update Verification Metadata

For each valid directive:

1. Update `verified` to today's date (YYYY-MM-DD)
2. Update `timestamp` to current ISO 8601 datetime
3. Reset `age_days` to 0
4. Append to verification log table:
   ```markdown
   | Date | Verified By | Notes |
   |------|-------------|-------|
   | {today} | /levelup.validate | Validation passed, no conflicts |
   ```

#### Step 4: Write Updated Files

Write updated frontmatter back to directive files:
```yaml
---
verified: 2026-05-18
age_days: 0
timestamp: 2026-05-18T12:00:00Z
---
```

#### Step 5: Track Verification Results

Build verification report:
```json
{
  "verification_updates": {
    "updated": 12,
    "stale": 3,
    "skipped": 2
  },
  "stale_directives": [
    {"file": "rules/old-pattern.md", "age_days": 45}
  ]
}
```

### Phase 7: CDR Generation

**Objective**: Create CDRs for detected conflicts

For each conflict, generate a CDR:

```markdown
## CDR-{NNN}: Resolve Rule Conflict: {conflict_title}

### Status
**Discovered**

### Date
{TODAY}

### Source
Rule conflict detection via /levelup.validate

### Target Module
context_modules/rules/{domain}/

### Context Type
Rule

### Context
**Conflict Details:**
- Rule A: {path}:{line} - "{statement}"
- Rule B: {path}:{line} - "{statement}"
- Type: {critical|error|warning|info}

**Conflict Level:** {1-5 as defined above}

### Decision
**Proposed Resolution:**

1. **Add Exception**: Modify rule to document exception
2. **Edit Rule**: Reword to avoid conflict
3. **Mark Intentional**: Document overlap as intentional
4. **Deprecate Rule**: Remove one rule

### Constitution Alignment
| Principle | Alignment | Notes |
|-----------|-----------|-------|
| {Principle} | Conflict | {Explanation} |
```

### Phase 8: Report Generation

**Objective**: Create conflict and verification report

#### JSON Format

```json
{
  "overall_status": "warn",
  "total_rules": 42,
  "conflicts_detected": 3,
  "conflicts": [
    {
      "id": "conflict-001",
      "level": "critical",
      "type": "direct_contradiction",
      "rule_a": "cache/strategy.md: Must cache for 5min",
      "rule_b": "data-freshness.md: Never cache sensitive data",
      "contradiction": "Must cache vs Never cache",
      "created_cdr": "CDR-001"
    }
  ]
}
```

#### Markdown Format

```markdown
## Conflict Report

**Total Rules**: 42
**Conflicts Detected**: 3

### Critical Conflicts

| ID | Type | Rule A | Rule B |
|----|------|--------|--------|
| 001 | Direct Contradiction | Must cache 5min | Never cache sensitive |

### Errors

...

### Warnings

...
```

### Phase 9: Summary

**Objective**: Present validation and verification results

```markdown
## LevelUp Validate Summary

**Date**: {date}
**Team Directives**: {path}

### Overall Status

| Status | Count |
|--------|-------|
| CRITICAL | {n} |
| ERROR | {n} |
| WARNING | {n} |
| INFO | {n} |

### Conflicts by Type

| Type | Count |
|------|-------|
| Direct Contradiction | {n} |
| Implicit Contradiction | {n} |
| Exception Conflict | {n} |
| Scope Overlap | {n} |
| Constitution Conflict | {n} |

### Memory Verification Status

| Metric | Count |
|--------|-------|
| Directives Updated | {n} |
| Stale Directives (>30d) | {n} |
| Skipped (has conflicts) | {n} |

### Stale Directives (Action Required)

| File | Age | Last Verified |
|------|-----|---------------|
| rules/old-pattern.md | 45d | 2026-04-01 |
| personas/legacy-role.md | 38d | 2026-04-08 |

### CDRs Created

| CDR | Conflict | Severity |
|-----|----------|----------|
| CDR-001 | Must cache vs Never cache | CRITICAL |

### Next Steps

1. **Run `/levelup.clarify`** to resolve conflicts
2. **Review stale directives** and update or deprecate
3. **Run `/levelup.implement`** to create PR with:
   - Conflict resolutions
   - Verification timestamp updates
```

## Notes

- **Conflict Detection**: Scans for contradictions, overlaps, and constitution violations
- **Memory Verification**: Updates `verified` timestamps for rules passing validation
- **Stale Detection**: Reports directives >30 days without verification
- **Strict Mode**: Skipped directives (with conflicts) must be resolved before verification
- **Idempotent**: Re-running updates timestamps again for valid directives

## Related Commands

- `/levelup.clarify` - Resolve detected conflicts
- `/levelup.implement` - Create PR with conflict resolutions and verification updates
- `/levelup.init` - Discover new patterns from codebase
