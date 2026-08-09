---
description: "Scan execution traces and propose new Context Directive Records (CDRs)"
arguments: "--dry-run (optional, report only)"
---


<!-- Extension: team-ai-directives -->
<!-- Config: .specify/extensions/team-ai-directives/ -->
## Goal

Scan `traces/` directory for execution trace files, analyze them for patterns, decisions, and conventions worth capturing, and propose Context Directive Records (CDRs) in `.specify/drafts/cdr.md`.

**Input**:
- Execution traces from `{REPO_ROOT}/traces/*.md`
- Existing team-ai-directives content (for dedup check)
- CDR index at `{TEAM_DIRECTIVES}/CDR.md` (for duplicate detection)

**Output**:
- Proposed CDRs in `{REPO_ROOT}/.specify/drafts/cdr.md`

## Role & Context

You are a **Pattern Analyst** — reviewing execution traces to identify reusable team knowledge. Your goal is to surface patterns, conventions, and decisions that should be formalized as context modules (rules, personas, examples, constitution amendments).

### What to Look For

| Signal | Description | CDR Type |
|--------|-------------|----------|
| **Decision** | Team agreed on an approach or standard | Rule |
| **Pattern** | Repeated code/convention across traces | Rule |
| **Persona** | Team member expertise or role definition | Persona |
| **Example** | Concrete implementation worth preserving | Example |
| **Gap** | Missing team-ai-directives content that would help | Rule |
| **Inconsistency** | Different approaches to same problem | Inconsistency |

### What NOT to Create CDRs For

- Project-specific configuration (not team-wide applicable)
- Trivial or obvious patterns
- Duplicates of existing team-ai-directives content
- Patterns with no concrete evidence in traces

## Prerequisites

- `{REPO_ROOT}/traces/` directory exists with at least one `.md` file
- Team-ai-directives repository accessible (optional, for dedup check)

## Execution Steps

### Phase 1: Discover Traces

Scan for unprocessed traces:

```bash
TRACES_DIR="{REPO_ROOT}/traces"
ls -1 "$TRACES_DIR"/*.md 2>/dev/null || echo "No traces found"
```

Read each trace file to understand what was done:
- What commands were executed?
- What decisions were made?
- What patterns or conventions emerged?

### Phase 2: Check Existing CDRs (Dedup)

If team-ai-directives is configured, load existing CDR index:

```bash
CDR_INDEX="{TEAM_DIRECTIVES}/CDR.md"
if [ -f "$CDR_INDEX" ]; then
    echo "Existing CDRs found — checking for duplicates"
fi
```

Read `CDR.md` descriptor column for each CDR. Flag any proposed CDRs that duplicate existing ones.

### Phase 3: Generate CDR Drafts

For each distinct pattern/decision found:

**1. Create CDR Entry**:

```markdown
### CDR-{YYYYMMDD-NNN}: {Title}

#### Status
Proposed

#### Type
Rule | Persona | Example | Constitution Amendment | Inconsistency

#### Source Traces
- `traces/{trace-file-1}`
- `traces/{trace-file-2}`

#### Context
Describe the situation where this pattern was discovered. Include:
- What triggered the decision?
- What alternatives were considered?
- What was the outcome?

#### Proposed Content
The actual content for the context module. This should be:
- Concise and actionable
- Written for AI agent consumption
- Referencing specific files/patterns where possible

#### Evidence
- Trace references with specific sections
- Code snippets or file paths from traces
- Commit SHAs if available

#### Cross-System Metadata (optional)
```json
{
  "appears_in": ["trace-sources"],
  "cross_system_score": 0.5
}
```
```

**2. Add CDR to Drafts File**:

Append each CDR to `{REPO_ROOT}/.specify/drafts/cdr.md`:

```bash
mkdir -p "{REPO_ROOT}/.specify/drafts"
```

### Phase 4: Output Summary

```markdown
## Team Curate Summary

| Metric | Value |
|--------|-------|
| Traces Scanned | {N} |
| CDRs Proposed | {M} |
| Duplicates Skipped | {D} |
| Draft File | .specify/drafts/cdr.md |

### Proposed CDRs

| ID | Type | Title |
|----|------|-------|
| CDR-{date}-{n} | Rule | {title} |

### Next Steps

Run **team.evolve** to review and implement proposed CDRs.
```

## Related

- `/team.evolve` — Review, gate, and implement CDRs
- `/levelup.clarify` — Manual CDR refinement before implementation (in levelup extension)
- `/levelup.skill` — Build skills from accepted CDRs (in levelup extension)