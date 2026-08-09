---
description: Build one skill from accepted CDRs
scripts:
  sh: .specify/extensions/levelup/scripts/bash/setup-levelup.sh --json
  ps: .specify/extensions/levelup/scripts/powershell/setup-levelup.ps1 -Json
---

## User Input

```text
$ARGUMENTS
```

**REQUIRED**: Skill name, CDR ID, or topic. STOP if empty.

| Input | Type | Action |
|-------|------|--------|
| `python-error-handling` | Skill name | Build skill with this name |
| `CDR-005` | CDR ID | Build from specific CDR |
| `testing patterns` | Topic | Match CDRs by topic |

## Goal

Build exactly **ONE** skill from accepted CDRs.

## Execution

### Phase 1: Setup

Run `{SCRIPT}` once and cache JSON output:

```json
{
  "REPO_ROOT": "/path/to/project",
  "TEAM_DIRECTIVES": "/path/to/team-ai-directives",
  "SKILLS_DRAFTS": "/path/to/project/.specify/drafts/skills",
  "BRANCH": "current-branch"
}
```

If TEAM_DIRECTIVES is empty, STOP:
```
Team AI directives not configured.
Run: specify init --team-ai-directives <path-or-url>
```

### Phase 2: Build

1. Read `.specify/drafts/cdr.md` -- filter status="Accepted"
2. Match CDRs to user input (ID, name, or topic keywords)
3. Present matches for confirmation
4. Generate skill files in `{SKILLS_DRAFTS}/{name}/`:
   - `SKILL.md`
   - `.skills-entry.json`

SKILL.md template:

```markdown
# {Name}

{Description with trigger keywords}

## When to Use
- {Condition 1}
- {Condition 2}

## Steps
1. {Step 1}
2. {Step 2}

## Example
{Minimal example using project conventions}

## Verification
{How to verify correctness}

## Related
- CDRs: {list}
- Commands: {list}
```

### Phase 3: Validate

- Ensure SKILL.md <= 200 lines
- Ensure no forbidden phrases ("as an AI language model", etc.)
- Ensure `## When to Use`, `## Steps`, `## Example`, `## Verification` exist

### Phase 4: Register

1. Append entry to `.skills.json`:
```json
{
  "name": "{name}",
  "description": "{description}",
  "trigger_keywords": ["..."],
  "source": "team-ai-directives",
  "version": "1.0.0",
  "cdr_ids": ["CDR-..."],
  "skill_path": "skills/{name}/SKILL.md",
  "entry_path": "skills/{name}/.skills-entry.json",
  "created_at": "{ISO8601}",
  "updated_at": "{ISO8601}"
}
```

2. Copy files to `{TEAM_DIRECTIVES}/skills/{name}/`
3. Add to AGENTS.md Skills section:
```markdown
| `{name}` | {description} | `skills/{name}/SKILL.md` |
```

## Output

```
Skill: {name}
Status: Created
Location: {SKILLS_DRAFTS}/{name}/
Registered: Yes
CDRs: {count} | Files: 2
```
