---
description: Discover relevant context from team-ai-directives for current feature
model-invocation: true
arguments: --no-write (optional, skip file persistence)
---


<!-- Extension: team-ai-directives -->
<!-- Config: .specify/extensions/team-ai-directives/ -->
## Goal

Discover relevant personas, rules, examples, and skills from team-ai-directives that apply to the current feature being specified or planned.

## CDR Index as Search Surface

`CDR.md` in the team-ai-directives knowledge base serves as the authoritative, LLM-readable catalog of all available context modules — analogous to how `.skills.json` is the index for skills. Each Accepted CDR row in the index table provides:

- **Target Module path**: the file to load if relevant
- **Type**: rule, persona, example
- **Descriptor**: a short "when to use" summary

The discovery process reads the index first, matches against it (using descriptor + path + type keywords), and loads full file content only for the modules selected as relevant. This progressive-disclosure approach keeps context lean and avoids scanning every file on every invocation.

If `CDR.md` is missing or cannot be parsed, the command falls back to scanning `context_modules/` directly.

## Discovery Process

### Step 1: Locate Knowledge Base

Read the file `.specify/init-options.json` directly. Do NOT use glob, find,
or any file-search tool to locate it — search tools may silently skip
dotfile-prefixed path segments. Read the file at the exact relative path
`.specify/init-options.json` from the current working directory.

If that read fails (file not found), walk up parent directories by reading
`../.specify/init-options.json`, then `../../.specify/init-options.json`,
and so on — up to 4 levels. Stop at the first successful read.

From the JSON, extract the `team_ai_directives` field.

- If present and the path exists: use it as the knowledge base root.
- If not found or path doesn't exist: output empty results and exit.

In subsequent steps, `{TEAM_AI_DIRECTIVES}` refers to this value, resolved
as a path relative to the current working directory. Read files at this
path directly — do NOT use glob, find, or any file-search tool to locate
them.

### Step 2: Load Feature Context

Read the feature description from:
- Environment variable: `${SPECIFY_FEATURE_DESCRIPTION}` (if set)
- Context file: `{REPO_ROOT}/specs/${SPECIFY_FEATURE}/context.md`
- Spec file: `{REPO_ROOT}/specs/${SPECIFY_FEATURE}/spec.md` (Mission Brief section)

**Fallback for plain-message invocation**: If none of the above sources
are available (no env var set, no feature directory, invoked as a skill
from team-boot rather than a spec workflow hook), extract the feature
context from the user's current message instead. The user's message is a
valid feature description — use it directly.

Extract the feature's:
- **Domain**: What business area is this? (e.g., payments, auth, analytics)
- **Technology**: What tech stack? (e.g., Java, Python, Kubernetes, React)
- **Patterns**: What architectural patterns? (e.g., REST, event-driven, CQRS)
- **Actions**: What is the feature doing? (e.g., create, validate, sync, process)

### Step 3: Load CDR Index (Primary Path)

Read `{TEAM_AI_DIRECTIVES}/CDR.md` and parse the CDR Index table into candidate records.

Extract each table row where `Status` is `Accepted`:
```json
{
  "id": "CDR-2026-001",
  "target_module": "context_modules/rules/security/sql_injection_prevention.md",
  "type": "Rule",
  "descriptor": "SQL injection prevention patterns for all languages"
}
```

Also read `{TEAM_AI_DIRECTIVES}/.skills.json` for the skill registry.

**Fallback**: If `CDR.md` is missing, unparseable, or contains no Accepted rows, read all files from `{TEAM_AI_DIRECTIVES}/context_modules/` directly (constitution.md, personas/, rules/, examples/) and use each file's name and path as the matching surface. This ensures the command works with any valid team-ai-directives knowledge base regardless of CDR maturity.

### Step 4: Match Against Index

For each candidate in the parsed CDR index, determine relevance based on:

**Personas** — Match when:
- Persona's domain (from descriptor or path) matches feature domain
- Persona's role aligns with feature users

**Rules** — Match when:
- Rule descriptor mentions matching technology
- Rule path category aligns with feature type (security, testing, style, etc.)
- Rule descriptor or path matches the patterns being used

**Examples** — Match when:
- Example descriptor/domain/technology overlaps with feature
- Similar feature type or pattern demonstrated

The **descriptor** column is the primary matching surface — it carries the condensed "when to use" summary authored during CDR publication. The **target module path** and **type** provide secondary matching signals.

**Skills**: Match from `.skills.json` against the feature context:
- **Default skills** (the `default` list): Check each skill's description
  against the feature's domain, technology, and patterns.
- **External skills** (the `external` map): Check each entry's `description`
  and `categories` fields against the feature's technology stack. Surface
  any external skill whose categories overlap with the feature's technology
  or patterns. For example, a React frontend feature should surface skills
  with `frontend`, `react`, or `ui` categories.

Include matched skills in the discovery output table with Type "Skill".

### Step 4b: Load Selected Module Bodies

For every module selected as relevant in Step 4, read the full file content from:
`{TEAM_AI_DIRECTIVES}/{target_module}`

Include the full content in the output so the AI agent has the complete directive text without needing a second file read.

### Modes

The command supports two modes:

- **Persist mode** (default): Writes the discovered context to a `team-context.md` file for reuse.
- **No-write mode** (`--no-write` in `$ARGUMENTS`): Outputs the discovery table inline only.
  No files are created or modified. Used by the `before_implement` hook where feature directories
  may not exist and Quick workflows forbid file artifacts.

Mode is detected in this order:
1. If `$ARGUMENTS` contains `--no-write`: no-write mode.
2. If the environment variable `SPECIFY_FEATURE_DIRECTORY` is set: persist mode to feature dir.
3. If run via `before_specify` hook (feature dir unknown): persist mode to staging path.
4. If run via `before_implement` hook (Quick context): no-write mode.
5. **If invoked as a skill** (no `$ARGUMENTS`, no env vars, no hook context):
   no-write mode. Output the discovery table inline. Do not write any files.

### Step 5: Output Discovered Context

Output structured discovery results as a markdown table:

```markdown
## Discovered Team Context

| ID | Module | Type | Descriptor | Relevance |
|----|--------|------|------------|-----------|
| CDR-2026-003 | context_modules/personas/admin.md | Persona | Admin user persona for backend features | High |
| CDR-2026-020 | context_modules/rules/security/api-security.md | Rule | API security patterns for web services | High |
```

- **ID**: The CDR identifier from `CDR.md` (omitted in legacy fallback mode).
- **Module**: Path to the full context module file relative to knowledge base root.
- **Type**: Rule, Persona, or Example.
- **Descriptor**: The "when to use" summary from the CDR index.
- **Relevance**: High / Medium / Low based on keyword overlap.

For personas and rules with **High** relevance, load the full module file content and
include it directly under the table so the agent has the complete directive text
without a second file read.

Include a `search_metadata` section after the table:

```markdown
_Searched 42 CDR entries, 8 matches found._
```

### Step 6: Persist Team Context (Extension-Owned)

The `team-ai-directives` extension owns the entire lifecycle for discovered context.

**Canonical artifact**: `team-context.md`

**Persistence rules (in order of priority)**:

1. **If `--no-write` detected**: Skip all file persistence. Output inline only.
2. **If feature directory is known** (`SPECIFY_FEATURE_DIRECTORY` is set):
   Write to `SPECIFY_FEATURE_DIRECTORY/team-context.md`.
   If `.specify/drafts/team-context.md` exists, delete it after successful write.
3. **Otherwise** (feature directory not yet known, e.g. `before_specify`):
   Write to `.specify/drafts/team-context.md`.

**Delta awareness**: Before writing, read the existing `team-context.md` file from the
target location (staging or feature dir, whichever is applicable). Compare the new
discovery results against the previous file. Include a delta section in the output:

```markdown
### Changes from Previous Discovery

- **New**: CDR-2026-042 — Python logging patterns (Rule)
- **Dropped**: CDR-2026-015 — Deprecated ORM rules (Rule)
- **Changed**: CDR-2026-003 — relevance Medium → High
```

This enables the agent to quickly understand what's new or changed without re-reading
the entire context.

### Step 7: Agent Integration

The discovered context is available to the agent through the persisted `team-context.md`
file (in persist mode) or inline output (in no-write mode). The agent should use the
relevance scores to prioritize which modules to read in full.

The `before_plan` and `before_specify` hooks automatically run discover before their
respective workflows. Quick workflows invoke discover via `before_implement` in
no-write mode — the agent receives inline context without file artifacts.

## Usage

This command is automatically executed via extension hooks:
- **before_specify**: Runs before `/spec.specify` to discover context for specification
- **before_plan**: Runs before `/spec.plan` to discover context for planning
- **before_implement** (optional): Runs before `/quick.implement` — no-write mode,
  outputs inline context without file persistence

Manual invocation:
```
/team.discover               # Persist mode (writes team-context.md)
/team.discover --no-write    # Inline only, no file persistence
```

## Failure Handling

If team-ai-directives is not configured or files cannot be read:
1. Output empty results with all arrays empty
2. Include search_metadata showing 0 files searched
3. Exit successfully (code 0) - don't block the preset command