---
description: Compile accepted CDRs into a draft PR to team-ai-directives repository
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

- `"--ready"` - Create ready PR instead of draft
- `"--skip-skills"` - Don't include skills from `{REPO_ROOT}/.specify/drafts/skills/`
- `"CDR-001 CDR-003"` - Only implement specific CDRs
- Empty input: Implement all accepted CDRs as draft PR

## Goal

Compile accepted CDRs into a **draft PR** to the team-ai-directives repository. Create or update context modules based on CDR decisions.

**Input**:
- Accepted CDRs from `{REPO_ROOT}/.specify/drafts/cdr.md` (with status "Accepted")
- Draft skills from `{REPO_ROOT}/.specify/drafts/skills/`
- Team-ai-directives repository

**Output** (ALL of these MUST be created):
- New branch in team-ai-directives
- ✅ `context_modules/rules/**/*.md` - Rule files (one per accepted Rule CDR)
- ✅ `context_modules/personas/*.md` - Persona files (one per accepted Persona CDR)
- ✅ `context_modules/examples/**/*.md` - Example files (one per accepted Example CDR)
- ✅ `context_modules/constitution.md` - Create or amend (if Constitution CDR accepted)
- ✅ `skills/*/` - Skill directories (if draft skills exist and not --skip-skills)
- ✅ `CDR.md` - Index of accepted CDRs at ROOT (create LAST)

**⚠️ CRITICAL**: You must create ALL of the above. Do NOT create CDR.md first and skip the actual module files.

**Git Extension Integration**:

This command delegates Git operations to the git extension:
- `git.commit --message` — Commit changes with explicit message
- `git.publish` — Push branch and create PR (GitHub) or MR (GitLab)

## Role & Context

You are acting as a **Context Publisher** - moving accepted CDRs from local drafts to team-ai-directives. Your role involves:

- **Validating** that CDRs are accepted and ready
- **Creating** context module files from CDR content
- **Managing** Git operations (branch, commit, push)
- **Creating** PR with proper description

### Prerequisites

Before running:
1. At least one CDR with status "Accepted" in `{REPO_ROOT}/.specify/drafts/cdr.md`
2. Team-ai-directives repository configured and accessible
3. Working tree at team-ai-directives is clean
4. Git credentials configured for push

## Execution Steps

### Phase 0: Environment Setup

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

**IMPORTANT**: Run this script only ONCE. Use the JSON output to get all paths.

### Phase 1: Validate Environment

**Objective**: Ensure prerequisites are met

#### Step 1: Verify Team Directives

Check if TEAM_DIRECTIVES has a value from script output.

If empty, **STOP**:
```
Team AI directives repository not configured.
Run: specify init --team-ai-directives <path-or-url>
Or set: export SPECIFY_TEAM_DIRECTIVES=/path/to/team-ai-directives
```

#### Step 2: Check Working Tree

Use TEAM_DIRECTIVES from script output:

```bash
cd "{TEAM_DIRECTIVES}"
git status --porcelain
```

If not clean, **STOP**:
```
Team-ai-directives has uncommitted changes.
Please commit or stash changes before running /levelup.implement.
```

#### Step 3: Load Accepted CDRs

Read `{REPO_ROOT}/.specify/drafts/cdr.md` and filter CDRs with:
- Status = "accepted"

If no accepted modules, **STOP**:
```
No accepted CDRs found.
Run /levelup.clarify to review and accept CDRs first.
```

### Phase 1.5: Signal Gate Validation

**Objective**: Apply signal gate to filter high-signal CDRs (strict mode - skip if no concrete evidence)

For each Accepted CDR, validate against signal gate criteria:

| Check | Description | Strict Mode Action |
|-------|-------------|-------------------|
| **Team-wide** | Pattern applicable across projects, not project-specific | SKIP if fails |
| **High Value** | Will save >30min per future use | SKIP if fails |
| **Unique** | Not duplicate of existing team-ai-directives content | SKIP if fails |
| **Evidence** | Has concrete commits and/or file references | **SKIP** (strict) |

**Evidence Parsing**:
Parse CDR Evidence section for:
- Commit references (SHA patterns: `abc123`, `[a-f0-9]{7,40}`)
- File paths (patterns: `src/`, `lib/`, `*.py`, `*.js`, etc.)
- Code snippets or URLs

**Signal Gate Results**:

```markdown
## Signal Gate Validation

**CDRs Passing Signal Gate**: {N} | **Skipped**: {M}

### Skipped CDRs (No-Op is Valid)

| CDR | Reason | Details |
|-----|--------|---------|
| CDR-003 | No evidence | No commits or files referenced |
| CDR-005 | Project-specific | Only applies to single project |
| CDR-007 | Duplicate | Overlaps with existing rule X |

> ℹ️ Skipped CDRs remain in local drafts. Run `/levelup.clarify` to improve and retry.
```

**Extract Metadata for Passing CDRs**:

For each passing CDR, extract:
- `created`: Oldest commit date from evidence (or CDR acceptance date if no commits)
- `modified`: Current date (publication date)
- `verified`: Current date (initial verification)
- `age_days`: Days between created and modified
- `evidence`: Structured list of commits and files

Store metadata for use in file generation.

### Phase 1.8: Cross-Sub-System Validation

**Objective**: Detect conflicts across sub-system CDRs before implementation

#### Load CDRs with Cross-System Metadata

Read `{REPO_ROOT}/.specify/drafts/cdr.md` and parse cross-system data for all accepted CDRs:

```json
{
  "cdr_id": "CDR-001",
  "target_module": "context_modules/rules/python/error-handling.md",
  "cross_system_metadata": {
    "appears_in": ["auth", "payments"],
    "cross_system_score": 0.67,
    "is_cross_cutting": true
  }
}
```

#### Check for Conflicts

**1. Duplicate Targets**:
Multiple CDRs targeting the same file path.

| Target Module | CDRs | Conflict Type |
|---------------|------|---------------|
| `rules/python/logging.md` | CDR-002, CDR-007 | Duplicate target |

**2. Rule Conflicts**:
Same concern, different implementations in different sub-systems.

| Concern | Conflicting CDRs | Sub-Systems | Issue |
|---------|------------------|-------------|-------|
| Authentication | CDR-001 (JWT), CDR-005 (OAuth2) | auth, api | Inconsistent approach |
| Error Handling | CDR-003 (exceptions), CDR-008 (result types) | payments, users | Different patterns |

**3. Inconsistency CDRs**:
CDRs with type "Inconsistency" need resolution before implementation.

| CDR | Type | Issue | Status |
|-----|------|-------|--------|
| CDR-INC-001 | Inconsistency | Auth pattern divergence | **Unresolved** |

#### Conflict Detection Algorithm

For each pair of CDRs:

```python
# Duplicate Target Check
if cdr1.target_module == cdr2.target_module:
    flag_duplicate_target(cdr1, cdr2)

# Rule Conflict Check
if similar_concern(cdr1, cdr2) and different_implementation(cdr1, cdr2):
    flag_rule_conflict(cdr1, cdr2)

# Inconsistency Check
if cdr.type == "Inconsistency" and cdr.status != "Resolved":
    flag_unresolved_inconsistency(cdr)
```

#### Cross-System Conflict Report

If any conflicts detected, output:

```markdown
## Cross-Sub-System Conflict Report ⚠️

**Status**: BLOCKED - Conflicts must be resolved before proceeding

### Duplicate Targets
| Target Module | CDRs | Resolution Required |
|---------------|------|---------------------|
| rules/python/logging.md | CDR-002, CDR-007 | Merge or choose one |

### Rule Conflicts
| Concern | Conflicting CDRs | Sub-Systems Involved | Recommended Action |
|---------|------------------|---------------------|-------------------|
| Authentication | CDR-001 (JWT), CDR-005 (OAuth2) | auth, api | Run /levelup.clarify |
| Error Handling | CDR-003, CDR-008 | payments, users | Run /levelup.clarify |

### Unresolved Inconsistencies
| CDR | Issue | Blocking |
|-----|-------|----------|
| CDR-INC-001 | Authentication pattern inconsistency | YES |

### Resolution Steps

1. **For Duplicate Targets**:
   - Edit CDRs to target different modules, OR
   - Merge content into single CDR

2. **For Rule Conflicts**:
   - Run `/levelup.clarify` to resolve which approach to standardize on
   - Update CDRs to reflect team decision
   - Mark rejected CDRs as "Rejected"

3. **For Inconsistencies**:
   - Run `/levelup.clarify` to make decision
   - Update inconsistency CDR with resolution
   - Mark as "Resolved" in CDR content

### Next Steps
```
STOP and prompt user to resolve conflicts before proceeding.

**If no conflicts detected**:
```markdown
## Cross-Sub-System Validation ✓

- **Duplicate targets**: None
- **Rule conflicts**: None  
- **Unresolved inconsistencies**: None
- **Status**: PASSED - Proceeding to implementation
```

#### Gate Decision

- **If conflicts found**: STOP, output conflict report, suggest running clarify
- **If no conflicts**: Proceed to Phase 2

### Phase 2: Prepare Changes

**Objective**: Create context module files from CDRs

#### Step 1: Generate Project Slug

Create branch name from project:

```bash
PROJECT_NAME=$(basename "$(pwd)")
BRANCH_NAME="levelup/${PROJECT_NAME}"
```

#### Step 2: Create Branch

```bash
cd "$TEAM_DIRECTIVES"
git checkout -b "$BRANCH_NAME" main
```

If branch exists, check if it was created in this session or reuse.

#### Step 3: Ensure AGENTS.md Exists

**Objective**: Create AGENTS.md if missing in team-ai-directives

```bash
cd "$TEAM_DIRECTIVES"

if [ ! -f "AGENTS.md" ]; then
  echo "Creating AGENTS.md from template..."
  cp "{TEAM_DIRECTIVES}/templates/agents-template.md" "AGENTS.md"
  echo "✅ AGENTS.md created"
else
  echo "✅ AGENTS.md already exists"
fi
```

**Note**: AGENTS.md is only created if missing. Existing content is never overwritten.

#### Step 4: Process Each CDR (with Memory Engineering)

For each CDR that passed signal gate, create/update the target file with YAML frontmatter and verification metadata.

**Metadata Variables**:
- `{type}`: OKF concept type (Rule, Persona, Example, Skill, Constitution)
- `{title}`: Human-readable display name
- `{description}`: One-line summary
- `{tags}`: YAML list of categorization tags
- `{timestamp}`: ISO 8601 datetime (YYYY-MM-DDTHH:MM:SSZ)
- `{id}`: Unique identifier (e.g., `rule-python-error-handling`)
- `{cdr_ref}`: Original CDR ID (e.g., `CDR-2026-001`)
- `{created}`: Evidence date (YYYY-MM-DD)
- `{modified}`: Today (YYYY-MM-DD)
- `{verified}`: Today (YYYY-MM-DD)
- `{age_days}`: Computed age
- `{evidence}`: YAML list of commits/files
- `{warning_threshold}`: From config (default: 30 days)

**Rules** (`context_modules/rules/{domain}/{file}.md`):
```markdown
---
type: Rule
title: {title}
description: {description}
tags: {tags}
timestamp: {timestamp}
id: {id}
cdr_ref: {cdr_ref}
created: {created}
modified: {modified}
verified: {verified}
age_days: {age_days}
evidence:
{evidence}
---

> ⚠️ **Memory Verification**
> This directive is {age_days} days old. Before applying:
> - [ ] Pattern still exists in current codebase
> - [ ] Rule is actively followed by team
> - [ ] No conflicting rules introduced
> 
> **Verification Date**: {verified}
> **Verify Again After**: {verify_after_date} (30 days)

# {Rule Title}

{Content from CDR proposed content}

## Source

Contributed from: {project-name}
CDR: {cdr_ref}
Date: {modified}

## Evidence

{Evidence section from CDR}

## Verification Log

| Date | Verified By | Notes |
|------|-------------|-------|
| {verified} | {project-name} | Initial publication via /levelup.implement |
```

**Personas** (`context_modules/personas/{file}.md`):
```markdown
---
type: Persona
title: {title}
description: {description}
tags: {tags}
timestamp: {timestamp}
id: {id}
cdr_ref: {cdr_ref}
created: {created}
modified: {modified}
verified: {verified}
age_days: {age_days}
evidence:
{evidence}
---

> ⚠️ **Memory Verification**
> This persona is {age_days} days old. Verify before use:
> - [ ] Role definition still accurate
> - [ ] Expertise areas current
> - [ ] Communication style still applies

# {Persona Name}

{Content from CDR proposed content}

## Source

Contributed from: {project-name}
CDR: {cdr_ref}
Date: {modified}
```

**Examples** (`context_modules/examples/{category}/{file}.md`):
```markdown
---
type: Example
title: {title}
description: {description}
tags: {tags}
timestamp: {timestamp}
id: {id}
cdr_ref: {cdr_ref}
created: {created}
modified: {modified}
verified: {verified}
age_days: {age_days}
evidence:
{evidence}
---

> ⚠️ **Memory Verification**
> This example is {age_days} days old. Verify before use:
> - [ ] Code still compiles/runs
> - [ ] API signatures unchanged
> - [ ] Best practices still current

# {Example Title}

{Content from CDR proposed content}

## Source

CDR: {cdr_ref}
Date: {modified}
```

**Constitution** (`context_modules/constitution.md`):

**For Constitution Creation CDRs** (constitution does not exist):

Create new constitution file:
```markdown
---
type: Constitution
title: {title}
description: {description}
tags: {tags}
timestamp: {timestamp}
id: {id}
cdr_ref: {cdr_ref}
created: {created}
modified: {modified}
verified: {verified}
age_days: {age_days}
evidence:
  principles:
    - name: {principle_1_name}
      source: {pattern_source}
      evidence: {file_paths}
---

> ⚠️ **Memory Verification**
> This constitution is {age_days} days old. Verify before applying:
> - [ ] Principles still align with team values
> - [ ] Evidence still valid in current codebase
> - [ ] No conflicting principles introduced

# Team Constitution

{Content from CDR proposed content - full constitution}

## Governance

This constitution was generated from codebase analysis via /levelup.init.
Amendments require team review and approval.

**Version**: 1.0.0 | **Ratified**: {created} | **Last Amended**: {modified}

## Source

Contributed from: {project-name}
CDR: {cdr_ref}
Date: {modified}

## Verification Log

| Date | Verified By | Notes |
|------|-------------|-------|
| {verified} | {project-name} | Initial constitution via /levelup.implement |
```

**For Constitution Amendment CDRs** (constitution exists):

Append to existing constitution:
```markdown

## {Amendment Title}

> **CDR Reference**: {cdr_ref}
> **Published**: {modified}
> **Age**: {age_days} days
> **Verification**: Check if principle still aligns with team values

{Content from CDR proposed content}

<!-- CDR: {cdr_ref}, Date: {modified}, ID: {id} -->

**Version**: {incremented_version} | **Last Amended**: {modified}
```

**Constitution Update Process**:

1. Check if `{TEAM_DIRECTIVES}/context_modules/constitution.md` exists
2. For **Constitution Creation** CDRs:
   - Create new file from CDR proposed content
   - Set initial version to 1.0.0
   - Set ratification date to today
3. For **Constitution Amendment** CDRs:
   - Read existing constitution
   - Append new section (preserve existing content)
   - Increment version according to CDR strategy
   - Update "Last Amended" date
4. Add verification metadata and CDR reference

#### ⚠️ Step 4: VERIFY Context Modules Created

**MUST DO BEFORE PROCEEDING**: Verify all context module files were created.

Run this command and report the count:
```bash
cd "$TEAM_DIRECTIVES"
echo "Constitution: $(test -f context_modules/constitution.md && echo '1' || echo '0')"
echo "Rules: $(find context_modules/rules -name '*.md' 2>/dev/null | wc -l)"
echo "Personas: $(find context_modules/personas -name '*.md' 2>/dev/null | wc -l)"  
echo "Examples: $(find context_modules/examples -name '*.md' 2>/dev/null | wc -l)"
```

**If any count is 0 but you have accepted CDRs for that type, you MUST go back and create the files.**

**Special cases**:
- **Constitution**: If Constitution CDR is accepted, verify file exists (count should be 1)
- **Inconsistency CDRs**: These don't create files directly; they inform other CDRs

#### Step 5: Process Draft Skills

If SKILLS_DRAFTS (from script output) contains skills (and not `--skip-skills`):

1. Copy skill directory to `{TEAM_DIRECTIVES}/skills/`
2. Read `.skills-entry.json` and merge into `.skills.json`

```bash
cp -r {SKILLS_DRAFTS}/{skill-name} "{TEAM_DIRECTIVES}/skills/"
```

Update `.skills.json`:
```json
{
  "skills": {
    "local:./skills/{skill-name}": {
      "version": "1.0.0",
      "description": "{description}"
    }
  }
}
```

#### ⚠️ Step 6: VERIFY Skills Copied

If you have draft skills (and didn't use --skip-skills), verify they were copied:

```bash
cd "$TEAM_DIRECTIVES"
echo "Skills: $(find skills -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
```

**If skills should exist but count is 0, you MUST go back and copy them.**

#### Step 7: Extract Accepted CDRs to CDR.md (with Memory Tracking)

Extract only CDRs that **passed signal gate** from `{REPO_ROOT}/.specify/drafts/cdr.md` and create `{TEAM_DIRECTIVES}/CDR.md`:

1. Parse the source cdr.md file
2. Filter to only include CDRs that passed signal gate validation
3. Generate new CDR.md with the published CDRs and memory metadata

```markdown
# Context Directive Records

Context Directive Records tracking approved contributions to team-ai-directives.

> **Memory Engineering**: This index tracks directive freshness. Run `/levelup.validate` to update verification timestamps.

## CDR Index

| ID | Target Module | Type | Status | Created | Verified | Age | Descriptor |
|----|---------------|------|--------|---------|----------|-----|------------|
| CDR-001 | context_modules/rules/python/error-handling.md | Rule | Accepted | 2026-04-15 | 2026-05-18 | 33d | Python error handling patterns and best practices |

**Stats**: {N} CDRs | Last Updated: {date}

---

## CDR-001: {Title}

### Status

**Accepted** | Proposed | Rejected

### Dates

- **Created**: {created} (from evidence)
- **Modified**: {modified} (publication date)
- **Verified**: {verified} (initial verification)
- **Age**: {age_days} days

### Source

{project-name}

### Target Module

`context_modules/rules/{domain}/{file}.md`

### Context Type

Rule | Persona | Example | Constitution Creation | Constitution Amendment

### Descriptor

One-line "when to use" summary. This becomes the search surface in the CDR Index table for the `adlc.team-ai-directives.discover` command. Derive from the `### Context` and `### Decision` sections — e.g., "SQL injection prevention patterns for all languages" or "Java Google style guide conventions for new projects".

### Signal Gate

✓ Team-wide applicable | ✓ High value | ✓ Unique | ✓ Concrete evidence

### Context

{Content from CDR}

### Decision

{Decision from CDR}

### Evidence

{Evidence from CDR}

---

```

### ⚠️ Phase 3: VERIFY ALL OUTPUTS CREATED

**MUST DO BEFORE COMMITTING**: Run this verification:

```bash
cd "$TEAM_DIRECTIVES"
echo "=== Context Module Files ==="
echo "Rules: $(find context_modules/rules -name '*.md' 2>/dev/null | wc -l)"
echo "Personas: $(find context_modules/personas -name '*.md' 2>/dev/null | wc -l)"
echo "Examples: $(find context_modules/examples -name '*.md' 2>/dev/null | wc -l)"
echo "Constitution: $(wc -l < context_modules/constitution.md 2>/dev/null || echo 0)"
echo "=== Skills ==="
echo "Skill directories: $(find skills -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
echo "=== CDR Index ==="
echo "CDR.md exists: $(test -f CDR.md && echo YES || echo NO)"
echo "==="
echo "Files to be committed:"
git status --porcelain
```

**STOP if**:
- Any context module category shows 0 files but you have accepted CDRs for that type
- Skills directory is empty but you have draft skills
- CDR.md does not exist

**If any check fails, you MUST go back and create the missing files before proceeding.**

### Phase 4: Record Execution Trace

**Objective**: Preserve execution trace for curation agent consumption

Copy the execution log as a trace file to `{REPO_ROOT}/traces/`:

```bash
mkdir -p "{REPO_ROOT}/traces"
TRACE_FILE="{REPO_ROOT}/traces/$(date -u +%Y%m%d-%H%M%S)-${PROJECT_NAME}-levelup-implement.md"
```

Write the trace content:

```markdown
# LevelUp Implement Trace

**Timestamp**: {timestamp}
**Project**: {project-name}
**Branch**: {BRANCH_NAME}
**Team Directives**: {TEAM_DIRECTIVES}

## Summary

- **CDRs Implemented**: {N}
- **CDRs Skipped (Signal Gate)**: {M}
- **Skills Published**: {S}
- **Target Branch**: {BRANCH_NAME} → main

## CDRs Implemented

| CDR | Type | Target Module |
|-----|------|---------------|
| CDR-{N} | {type} | {module} |

## Evidence

- Project: {project-repo-url}
- Implementation branch: {BRANCH_NAME}
```

After writing, optionally stage it:

```bash
cd "{REPO_ROOT}"
git add traces/
```

### Phase 5: Commit and Publish

**Objective**: Commit changes in team-ai-directives and create PR/MR using git extension commands

#### Step 1: Commit with `git.commit --message`

Use the git extension command with an explicit message:

- **slash command**: `git.commit --message "Add context modules from {project-name}"`
- **hook equivalent**: `.specify/extensions/git/scripts/bash/auto-commit.sh --message "Add context modules from {project-name}" after_implement`

Generate the commit message:

```
Add context modules from {project-name}

CDRs implemented:
- CDR-{N}: {title} ({type})
- CDR-{N}: {title} ({type})

Skills added:
- {skill-name}

Source: {project-repo-url}
```

#### Step 2: Publish with `git.publish`

Use the git extension command to push and create PR/MR:

- **slash command**: `git.publish --title "Add context modules from {project-name}" [--draft]`
- **script equivalent**: `.specify/extensions/git/scripts/bash/publish.sh --title "Add context modules from {project-name}" [--draft]`

The command accepts:
- `--draft` — Create as draft PR (default unless `--ready` flag)
- `--title "..."` — PR title (generated from branch name if absent)
- `--body "..."` — PR description

**PR Body Template**:

```markdown
## Summary

Context module contributions from **{project-name}**.

### CDRs Implemented

| CDR | Type | Target Module |
|-----|------|---------------|
| CDR-001 | Rule | context_modules/rules/python/error-handling.md |
| CDR-002 | Example | context_modules/examples/testing/fixtures.md |

### CDR Records

Accepted CDRs are recorded in `CDR.md` (at repository root) for tracking.

### Skills Added

- `{skill-name}`: {description}

### Evidence

These contributions were discovered and validated through:
- `/levelup.init` - Brownfield codebase analysis
- `/levelup.clarify` - Team validation
- `/levelup.specify` - Feature implementation evidence

### Checklist

- [ ] Context aligns with team constitution
- [ ] No duplicate content
- [ ] Examples are tested and working
- [ ] Skills have trigger keywords

### Source

- Project: {project-name}
- Repository: {repo-url}
- Branch: {branch-name}
```

#### Step 3: Stage Trace File (in source repo)

```bash
cd "{REPO_ROOT}"
git add traces/
```

### Phase 6: Summary

**Objective**: Present implementation results

```markdown
## LevelUp Implement Summary

**Date**: {date}
**Project**: {project-name}
**Team Directives**: {path}

### Git Operations

| Operation | Status |
|-----------|--------|
| Branch created | `{BRANCH_NAME}` |
| Files changed | {N} |
| Commit | via `git.commit --message` |
| Push + PR | via `git.publish` |
| Trace | `traces/{trace-file}` |

### CDRs Implemented

| CDR | Target Module | Status |
|-----|---------------|--------|
| CDR-001 | rules/python/error-handling.md | Implemented |
| CDR-002 | examples/testing/fixtures.md | Implemented |

### Signal Gate Results

**Passing**: 2 | **Skipped**: 1

| Skipped CDR | Reason |
|-------------|--------|
| CDR-003 | No concrete evidence |

### Skills Published

| Skill | Location |
|-------|----------|
| {skill-name} | skills/{skill-name}/ |

### PR Details

**URL**: {PR-URL}
**Status**: Draft (ready for review)

### Next Steps

1. **Review PR** at {PR-URL}
2. **Request reviews** from team members
3. **Merge** when approved
4. **Clean up** local drafts after merge:
   ```bash
   rm -rf {REPO_ROOT}/.specify/drafts/skills/{skill-name}
   ```
```

### Phase 7: Cleanup (when NOT configured)

**When team-ai-directives is NOT configured:**

**Objective**: Archive accepted CDRs and clean up drafts

1. **Copy Accepted CDRs**:
   - Filter CDRs with status "Accepted" from `{REPO_ROOT}/.specify/drafts/cdr.md`
   - Copy to `{REPO_ROOT}/.specify/memory/cdr.md`

2. **Cleanup Drafts**:
   - Check if `{REPO_ROOT}/.specify/drafts/cdr.md` has any remaining non-accepted CDRs
   - Check if `{REPO_ROOT}/.specify/drafts/skills/` has any draft skills
   - If no remaining drafts → remove `{REPO_ROOT}/.specify/drafts/` directory

## Output Files

| File | Description |
|------|-------------|
| `{TEAM_DIRECTIVES}/CDR.md` | Accepted CDRs from this contribution (at ROOT) |
| `{TEAM_DIRECTIVES}/context_modules/**` | New/updated context modules |
| `{TEAM_DIRECTIVES}/skills/**` | New skills |
| `{TEAM_DIRECTIVES}/.skills.json` | Updated manifest |

## Flags

| Flag | Description |
|------|-------------|
| `--ready` | Create ready PR instead of draft |
| `--skip-skills` | Don't include draft skills |

## Notes

- Creates draft PR by default for review before merge
- Only implements CDRs with status "Accepted" from `{REPO_ROOT}/.specify/drafts/cdr.md`
- **Signal Gate (Strict Mode)**: Skips CDRs without concrete evidence (commits/files)
- **Memory Engineering**: Published files include YAML frontmatter with `created`, `verified`, `age_days`
- **Verification**: Run `/levelup.validate` to refresh `verified` timestamps
- When TD configured: Copies only signal-gate-passing CDRs to `{TEAM_DIRECTIVES}/CDR.md`
- When NOT configured: Copies accepted CDRs to `{REPO_ROOT}/.specify/memory/cdr.md` and cleans up drafts
- Skills from `{REPO_ROOT}/.specify/drafts/skills/` are included unless `--skip-skills`
- If MCP unavailable, provides manual instructions
- Working tree must be clean before running

## Memory Engineering

This command applies agent memory engineering principles:

1. **Signal Gate**: Filters noisy CDRs (strict mode - no evidence = skip)
2. **Verification Metadata**: YAML frontmatter tracks freshness (`created`, `verified`, `age_days`)
3. **Freshness Warnings**: Published files include verification checklists
4. **Age Tracking**: CDR index shows age in days; warnings at 30+ days

Run `/levelup.validate` to update verification timestamps and check directive freshness.

## Related Commands

- `/levelup.init` - Discover CDRs from codebase
- `/levelup.clarify` - Accept CDRs for implementation
- `/levelup.specify` - Enrich CDRs with feature context
- `/levelup.skill` - Build one skill from accepted CDRs
