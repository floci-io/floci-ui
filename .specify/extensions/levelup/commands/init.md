---
description: Scan codebase and discover Context Directive Records (CDRs) for team-ai-directives contributions using multi-agent sub-system analysis
handoffs:
  - label: Resolve Ambiguities
    agent: adlc.levelup.clarify
    prompt: |
      Review CDRs discovered from brownfield codebase analysis.
      Ask questions about:
      - Pattern validity (are inferred patterns still relevant?)
      - Team scope (is this pattern team-wide or project-specific?)
      - Existing coverage (does team-ai-directives already have this?)
      - Priority (high-value vs nice-to-have patterns)
      Focus on validating assumptions, not suggesting new patterns.
      
      **Special attention to inconsistency CDRs**:
      - CDRs marked as "Inconsistency" type need resolution
      - Ask clarifying questions about conflicting implementations
      - Help team choose standard approach
    send: true
  - label: Refine from Feature Context
    agent: adlc.levelup.specify
    prompt: Refine CDRs using current feature spec context
    send: false
state:
  enabled: true
  location: ".specify/levelup/state.json"
  phases: ["discovery", "pattern_analysis", "synthesis"]
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

- `"Python FastAPI backend with PostgreSQL"` - Focus on Python patterns
- `"Focus on testing patterns"` - Narrow to testing-related CDRs
- `"--cdr-heuristic all"` - Document all patterns, not just surprising ones
- `"--focus rules"` - Only discover rule-type patterns
- `"--resume"` - Resume from previous state
- Empty input: Scan entire codebase for all context types

When users provide context, use it to focus the discovery effort.

## Goal

Scan an **existing codebase** (brownfield) using **multi-agent sub-system analysis** to discover patterns that could become contributions to team-ai-directives. Create **Context Directive Records (CDRs)** documenting discovered patterns with cross-sub-system analysis.

**Key Features**:
- **Sequential sub-agent execution**: Discovery → Pattern Analysis → Synthesis
- **Cross-sub-system detection**: Identifies patterns across multiple sub-systems
- **Inconsistency detection**: Flags conflicting implementations between sub-systems
- **Team-directives comparison**: Checks against existing TD to avoid duplicates
- **State persistence**: Resumable execution with checkpoint support

**Output**:

1. **Proposed modules** added to `{REPO_ROOT}/.specify/drafts/cdr.md` with status "Discovered"
2. **Cross-system analysis** documenting patterns across sub-systems
3. **Inconsistency CDRs** for conflicting implementations
4. **Summary** with statistics and next steps

### Flags

- `--cdr-heuristic HEURISTIC`: CDR generation strategy
  - `surprising` (default): Only document patterns not already in team-ai-directives
  - `all`: Document all discovered patterns
  - `minimal`: Only high-value/novel patterns

- `--focus AREA`: Focus on specific context type
  - `rules`: Only scan for coding rules
  - `personas`: Only scan for role patterns
  - `examples`: Only scan for example-worthy code
  - `constitution`: Only scan for governance patterns
  - `skills`: Only scan for skill-worthy capabilities

- `--no-decompose`: Disable automatic sub-system detection

- `--resume`: Resume from previous state (if interrupted)

- `--skip-constitution`: Skip constitution generation phase

## Role & Context

You are orchestrating a **multi-agent analysis pipeline** with three specialized agents:

1. **Discovery Agent**: Scans each sub-system for raw patterns
2. **Pattern Agent**: Classifies and scores patterns for reusability
3. **Synthesis Agent**: Performs cross-sub-system analysis and generates CDRs

### Three-Phase Architecture

```
Phase 0-3: Setup (Environment, Sub-system detection, TD loading)
    ↓
Phase 4: Discovery Agent (Per sub-system, sequential)
    ↓
Phase 5: Pattern Agent (Per sub-system, sequential)
    ↓
Phase 6: Synthesis Agent (Cross-sub-system, once)
    ↓
Phase 7: Constitution Generation (Once)
    ↓
Phase 8: Output (CDR generation and summary)
```

### Cross-Sub-System Analysis

The Synthesis Agent detects:

| Pattern Type | Criteria | Action |
|--------------|----------|--------|
| **Cross-cutting** | Pattern in ≥50% of sub-systems | High-priority CDR |
| **Inconsistent** | Same concern, different implementations | Inconsistency CDR |
| **Project-specific** | Only in 1 sub-system, low reuse | Lower priority |
| **Gap** | High value, not in team-directives | Recommended CDR |

## Outline

1. **Validate Environment** (Phase 1): Ensure team-ai-directives is configured
2. **Sub-System Detection** (Phase 2): Identify sub-systems from code structure
3. **Environment Setup** (Phase 3): Resolve paths and initialize state
4. **Load Team Directives** (Phase 4): Read existing TD for comparison
5. **Discovery Agent** (Phase 5): Scan each sub-system for patterns
6. **Pattern Agent** (Phase 6): Classify and score patterns per sub-system
7. **Synthesis Agent** (Phase 7): Cross-sub-system analysis
8. **Constitution Generation** (Phase 8): Generate/enhance team constitution from discovered patterns
9. **CDR Generation** (Phase 9): Generate final CDRs
10. **Output** (Phase 10): Write CDRs and present summary

## Execution Steps

### Phase 1: Validate Environment

**Objective**: Ensure team-ai-directives is configured

#### Step 1: Verify Team Directives

Check if TEAM_DIRECTIVES has a value from script output.

If empty, **STOP**:
```
Team AI directives repository not configured.
Run: specify init --team-ai-directives <path-or-url>
Or set: export SPECIFY_TEAM_DIRECTIVES=/path/to/team-ai-directives
```

### Phase 2: Sub-System Detection (Brownfield)

**Objective**: Identify sub-systems from existing code structure

#### Step 1: Directory Structure Analysis

Analyze the codebase for distinct sub-systems:

| Pattern | Likely Sub-System |
|---------|------------------|
| `src/auth/` | Authentication sub-system |
| `src/users/` | User management sub-system |
| `services/payment/` | Payment sub-system |
| `apps/api/`, `apps/web/` | Monorepo apps |

#### Step 2: Sub-System Proposal (Interactive)

Present detected sub-systems:

```markdown
## Detected Sub-Systems

| # | Sub-System | Detection Method | Evidence |
|---|------------|-----------------|----------|
| 1 | **auth** | Directory + Module | src/auth/ |
| 2 | **payments** | Directory | services/payment/ |

**Reply** with:
- `Y` to confirm
- `n` to disable decomposition (monolithic analysis)
- Specific changes (e.g., "merge 1+2", "add Notifications")
```

**Threshold Logic**:
- **≤3 sub-systems**: Auto-approve
- **4-6 sub-systems**: Show summary, confirm
- **>6 sub-systems**: Suggest grouping, confirm

#### Step 3: Output Sub-System List

```json
{
  "decomposition": "enabled",
  "subsystems": [
    {"id": "auth", "name": "Auth", "path": "src/auth/"},
    {"id": "payments", "name": "Payments", "path": "services/payment/"}
  ]
}
```

### Phase 3: Environment Setup

**Objective**: Resolve paths and initialize state

#### Step 1: Run Setup Script

Execute `{SCRIPT}` to get paths:

```json
{
  "REPO_ROOT": "/path/to/project",
  "TEAM_DIRECTIVES": "/path/to/team-ai-directives"
}
```

#### Step 2: Initialize State

Create `{REPO_ROOT}/.specify/levelup/state.json`:

```json
{
  "version": "1.1.0",
  "command": "init",
  "created_at": "2026-01-20T10:00:00Z",
  "phase": "discovery",
  "current_subsystem_index": 0,
  "subsystems": [
    {
      "id": "auth",
      "name": "Authentication",
      "path": "src/auth",
      "progress": {
        "discovery": "pending",
        "pattern_analysis": "pending"
      }
    }
  ],
  "constitution_generation": {
    "enabled": true,
    "completed": false,
    "skipped": false,
    "principles_derived": 0,
    "output_path": null
  },
  "workflow": {
    "init_completed": false,
    "total_subsystems": 2,
    "completed_subsystems": 0
  }
}
```

#### Step 3: Check for Resume

If `--resume` flag:
1. Load existing state.json
2. Find next incomplete phase
3. Skip completed sub-systems
4. Report: "Resuming from {phase}, {N} sub-systems remaining"

### Phase 4: Load Team Directives

**Objective**: Load existing TD for comparison

#### Step 1: Load Constitution

Read `{TEAM_DIRECTIVES}/context_modules/constitution.md`

#### Step 2: Load Existing Modules

Scan and load:
- `{TEAM_DIRECTIVES}/context_modules/rules/**/*.md`
- `{TEAM_DIRECTIVES}/context_modules/personas/*.md`
- `{TEAM_DIRECTIVES}/context_modules/examples/**/*.md`
- `{TEAM_DIRECTIVES}/skills/**/*`

Store in memory for comparison by Pattern Agent.

### Phase 5: Discovery Agent (Per Sub-System, Sequential)

**Objective**: Scan each sub-system for raw patterns

**Execution**: For each sub-system in order:

#### Step 1: Check State

Load state.json and check `progress.discovery`:
- If `"completed"`: Skip this sub-system
- If `"pending"` or `"in_progress"`: Proceed

#### Step 2: Run Discovery Agent

Use template: `templates/subagents/discovery-prompt.md`

**Input to Agent**:
```json
{
  "subsystem": {
    "id": "auth",
    "name": "Authentication",
    "path": "src/auth"
  },
  "tech_stack": ["Python", "FastAPI"],
  "focus": "rules|personas|examples|skills|all"
}
```

**Agent Tasks**:
1. Scan all files in sub-system path
2. Identify patterns by category
3. Document concrete evidence
4. Assign confidence scores

#### Step 3: Update State

Save discovery results:

```json
{
  "subsystems": [
    {
      "id": "auth",
      "progress": {
        "discovery": "completed"
      },
      "discovery_results": {
        "patterns_found": 5,
        "patterns": [...],
        "files_analyzed": 12
      }
    }
  ]
}
```

#### Step 4: Progress Report

Output:
```
Discovery Agent: auth sub-system
├── Files analyzed: 12
├── Patterns found: 5
├── High confidence: 3
└── Status: ✓ Completed
```

#### Step 5: Continue to Next Sub-System

Increment `current_subsystem_index` and repeat.

**When all sub-systems complete**: Set `phase` to `"pattern_analysis"`

### Phase 6: Pattern Agent (Per Sub-System, Sequential)

**Objective**: Classify and score patterns for each sub-system

**Execution**: For each sub-system in order:

#### Step 1: Check State

Load state.json and check `progress.pattern_analysis`:
- If `"completed"`: Skip this sub-system
- If `"pending"`: Proceed

#### Step 2: Run Pattern Agent

Use template: `templates/subagents/pattern-prompt.md`

**Input to Agent**:
```json
{
  "subsystem": {
    "id": "auth",
    "discovery_results": {...}
  },
  "team_directives": {
    "rules": [...],
    "personas": [...],
    "examples": [...],
    "constitution": "..."
  }
}
```

**Agent Tasks**:
1. Classify each pattern into context type
2. Calculate reusability score (0.0-1.0)
3. Check for matches in team-directives
4. Flag potential duplicates

#### Step 3: Update State

Save pattern analysis:

```json
{
  "subsystems": [
    {
      "id": "auth",
      "progress": {
        "pattern_analysis": "completed"
      },
      "pattern_results": {
        "patterns": [
          {
            "pattern_id": "P001",
            "category": "Rule",
            "reuse_score": 0.85,
            "team_directives_check": {...},
            "recommendation": "high_value"
          }
        ]
      }
    }
  ]
}
```

#### Step 4: Progress Report

Output:
```
Pattern Agent: auth sub-system
├── Patterns analyzed: 5
├── High value (>0.7): 3
├── Medium value (0.5-0.7): 1
├── Project specific (<0.5): 1
└── Status: ✓ Completed
```

#### Step 5: Continue to Next Sub-System

When all sub-systems complete: Set `phase` to `"synthesis"`

### Phase 7: Synthesis Agent (Cross-Sub-System)

**Objective**: Perform cross-sub-system analysis and generate CDRs

#### Step 1: Load All Data

Load from state.json:
- All sub-system pattern results
- Team-directives content

#### Step 2: Run Synthesis Agent

Use template: `templates/subagents/synthesis-prompt.md`

**Agent Tasks**:

**1. Cross-Cutting Pattern Detection**:
For each pattern found in multiple sub-systems:
```json
{
  "pattern_id": "P001",
  "pattern_name": "Error Handling",
  "cross_system_score": 0.67,
  "is_cross_cutting": true
}
```

**2. Inconsistency Detection**:
Compare patterns across sub-systems:

| Check | Example | Action |
|-------|---------|--------|
| Same concern, different impl | auth uses JWT, payments uses OAuth | Flag inconsistency |

**3. Team-Directives Comparison**:
- Check for exact matches
- Calculate similarity scores
- Identify gaps

**4. CDR Generation**:

Generate CDRs for:
- **High-value patterns** (reuse_score > 0.7)
- **Cross-cutting patterns** (cross_system_score > 0.5)
- **Inconsistencies** (need team decision)
- **Gaps** (not in TD but valuable)

#### Step 3: Update State

```json
{
  "phase": "synthesis_completed",
  "cross_system_analysis": {
    "completed": true,
    "patterns_analyzed": 15,
    "cross_cutting_detected": 3,
    "inconsistencies": [
      {
        "id": "INC-001",
        "type": "implementation_divergence",
        "concern": "authentication",
        "cdrs": ["CDR-INC-001"]
      }
    ]
  },
  "cdrs_generated": {
    "total": 8,
    "by_category": {
      "rules": 4,
      "examples": 2,
      "skills": 1,
      "inconsistencies": 1
    }
  }
}
```

### Phase 8: Constitution CDR Generation

**Objective**: Create Constitution CDRs from discovered patterns for team review

**Skip Conditions** (skip this phase if ANY are true):
- `--skip-constitution` flag provided
- `--focus` flag set to value other than `constitution` or `all`
- Config `discovery.constitution: false`

**IMPORTANT**: This phase creates Constitution CDRs (Context Directive Records) in `.specify/drafts/cdr.md`, NOT the final constitution file. Constitution changes require team review and acceptance before being published to team-ai-directives via `/levelup.implement`.

#### Step 1: Check Constitution Exists

Check if `{TEAM_DIRECTIVES}/context_modules/constitution.md` exists.

| Status | CDR Type |
|--------|----------|
| **Missing** | Constitution Creation |
| **Exists** | Constitution Amendment |

#### Step 2: Read Constitution Template

Read `.specify/templates/constitution-template.md` for structure. Key placeholders:
- `[PROJECT_NAME]` → Team/directories name
- `[PRINCIPLE_N_NAME]` → Derived from cross-cutting patterns
- `[PRINCIPLE_N_DESCRIPTION]` → Derived from pattern evidence
- `[CONSTITUTION_VERSION]` → Start at `1.0.0` (new) or increment existing
- `[RATIFICATION_DATE]` → Today's date (new) or preserve existing
- `[LAST_AMENDED_DATE]` → Today's date

#### Step 3: Derive Principles from Patterns

**Input from Synthesis Agent state**:
- Cross-cutting patterns (patterns in ≥50% of sub-systems)
- Inconsistencies detected
- High-value patterns (reuse_score > 0.7)

**Principle Derivation Logic**:

| Cross-Cutting Pattern | → Constitution Principle |
|----------------------|-------------------------|
| Error handling consistent across subsystems | **Robust Error Handling** |
| Logging/observability patterns | **Observability First** |
| Security/auth patterns | **Security by Default** |
| Testing patterns | **Tests Drive Confidence** |
| API/interface patterns | **Interface Consistency** |
| Inconsistencies detected | **Standardization Mandate** |

**Derivation Process**:
```json
{
  "cross_cutting_patterns": [
    {
      "pattern": "Custom Error Handling",
      "subsystems": ["auth", "payments", "users"],
      "cross_system_score": 1.0,
      "consistency": "consistent"
    }
  ],
  "inconsistencies": [
    {
      "id": "INC-001",
      "concern": "Authentication",
      "subsystems": ["auth", "payments", "users"]
    }
  ],
  "derived_principles": [
    {
      "name": "Robust Error Handling",
      "description": "All services MUST implement consistent error handling with custom exception classes, error codes, and structured logging. Evidence: Custom error classes found in 3/3 sub-systems.",
      "source": "cross_cutting_pattern",
      "evidence": ["auth/errors.py", "payments/exceptions.py", "users/errors.py"]
    },
    {
      "name": "Standardization Mandate",
      "description": "When patterns are adopted across multiple sub-systems, they MUST be implemented consistently. Divergent implementations require team review and reconciliation.",
      "source": "inconsistency_resolution",
      "evidence": ["INC-001: Authentication divergence between sub-systems"]
    }
  ]
}
```

#### Step 4: Compare with Existing Constitution

If constitution exists:

1. Read existing principles from `{TEAM_DIRECTIVES}/context_modules/constitution.md`
2. Check for overlap with derived principles
3. Determine action for each derived principle:

| Overlap Status | Action |
|----------------|--------|
| **New concern** | Add as new principle |
| **Enhances existing** | Append to existing principle description |
| **Already covered** | Skip (add evidence as reinforcement note) |

Output comparison:
```json
{
  "existing_principles_count": 10,
  "new_principles_proposed": 2,
  "principles_enhanced": 1,
  "principles_preserved": 10,
  "version_bump": "minor"
}
```

#### Step 5: Generate Constitution CDR Content

**When constitution MISSING** - Create Constitution Creation CDR:

```markdown
## CDR-CONST-001: Team Constitution Creation

### Status
**Discovered**

### Date
{today}

### Source
Cross-sub-system analysis via /levelup.init

### Cross-System Metadata
- **Appears in**: [List of sub-systems analyzed]
- **Cross-system score**: [0.0-1.0]
- **Consistency**: [Pattern consistency across sub-systems]
- **Reuse score**: [0.0-1.0]

### Target Module
`context_modules/constitution.md`

### Context Type
Constitution Creation

### Context
Team constitution missing. Deriving foundational principles from cross-cutting patterns discovered in codebase.

**Discovery Evidence:**
- [Cross-cutting pattern 1 with evidence]
- [Cross-cutting pattern 2 with evidence]
- [Resolved inconsistencies]

**Problem Statement:**
Team lacks documented governance principles. Constitution will establish baseline standards based on proven patterns.

### Decision
Create new team constitution with principles derived from codebase patterns.

**Proposed Content:**
```markdown
---
type: Constitution
title: Team Constitution
description: Core principles governing all AI agent behavior and team interactions
tags: [governance, principles, constitution]
timestamp: {today}T00:00:00Z
id: constitution
cdr_ref: CDR-CONST-001
created: {today}
modified: {today}
verified: {today}
age_days: 0
evidence: []
---

# Team Constitution

## Core Principles

### I. [Derived Principle 1 Name]
[Derived description with evidence]

**Source**: Cross-sub-system analysis via /levelup.init
**Evidence**: [File paths from codebase]

### II. [Derived Principle 2 Name]
...

## Governance

This constitution was generated from codebase analysis and should be reviewed by the team.

**Version**: 1.0.0 | **Ratified**: {today} | **Last Amended**: {today}
```

### Constitution Strategy

#### Constitution Status
- **Current constitution**: Missing
- **Action**: Create new
- **Derived principles count**: [N]

#### Derived Principles
| Principle Name | Source | Evidence | Action |
|----------------|--------|----------|--------|
| [Principle 1] | Cross-cutting pattern | [file paths] | New |
| [Principle 2] | Inconsistency resolution | [INC-XXX] | New |

#### Version Strategy
- **Current version**: None
- **Version bump**: N/A (new constitution)
- **Rationale**: First constitution derived from codebase analysis
```

**When constitution EXISTS** - Create Constitution Amendment CDR:

```markdown
## CDR-CONST-001: Constitution Amendment - [Principle Name]

### Status
**Discovered**

### Date
{today}

### Source
Cross-sub-system analysis via /levelup.init

### Cross-System Metadata
- **Appears in**: [List of sub-systems with pattern]
- **Cross-system score**: [0.0-1.0]
- **Consistency**: [Pattern consistency]
- **Reuse score**: [0.0-1.0]

### Target Module
`context_modules/constitution.md`

### Context Type
Constitution Amendment

### Context
Existing constitution can be enhanced with principles derived from newly discovered patterns.

**Discovery Evidence:**
- [Pattern evidence from codebase]
- [Inconsistency resolutions]

**Problem Statement:**
Cross-cutting patterns identified that should be elevated to constitutional principles.

### Decision
Append derived section to existing constitution.

**Proposed Content:**
```markdown
## Derived from Codebase Analysis

*The following principles were derived from patterns discovered in the codebase via /levelup.init on {date}. Review and ratify as needed.*

### [Principle Name]
[Description]

**Source**: Cross-cutting pattern / Inconsistency resolution
**Evidence**: [File paths]
**Status**: Proposed (pending team review)

---

**Version**: {incremented} | **Last Amended**: {today}
```

### Constitution Strategy

#### Constitution Status
- **Current constitution**: Exists
- **Action**: Append section
- **Derived principles count**: [N]

#### Derived Principles
| Principle Name | Source | Evidence | Action |
|----------------|--------|----------|--------|
| [Principle 1] | Cross-cutting pattern | [file paths] | New/Enhances existing |

#### Version Strategy
- **Current version**: [X.Y.Z]
- **Version bump**: [MINOR]
- **Rationale**: New principles added from codebase analysis
```

#### Step 6: Write Constitution CDR

**CRITICAL**: Write to `.specify/drafts/cdr.md` (NOT to team-ai-directives).

Append Constitution CDR to `{REPO_ROOT}/.specify/drafts/cdr.md`:
- Use CDR template from `templates/cdr-template.md`
- Set Status: "Discovered"
- Set Context Type: "Constitution Creation" or "Constitution Amendment"
- Include Constitution Strategy section

**Do NOT write to team-ai-directives.** Constitution changes require:
1. Team review via `/levelup.clarify`
2. Acceptance via status change to "Accepted"
3. Publication via `/levelup.implement`

#### Step 7: Update State

```json
{
  "constitution_cdr_generation": {
    "completed": true,
    "skipped": false,
    "existing_constitution": true,
    "cdr_type": "Constitution Amendment",
    "cdr_id": "CDR-CONST-001",
    "principles_derived": 2,
    "principles_enhanced": 1,
    "output_file": "{REPO_ROOT}/.specify/drafts/cdr.md",
    "requires_review": true,
    "requires_acceptance": true,
    "next_step": "Run /levelup.clarify to review constitution changes, then /levelup.implement to publish to team-ai-directives"
  }
}
```

### Phase 9: Write CDRs

**Objective**: Write generated CDRs to file (excluding Constitution CDRs which are created in Phase 8)

**Note**: Constitution CDRs are created in Phase 8. This phase writes Rule, Persona, Example, Skill, and Inconsistency CDRs.

For each generated CDR, use template from `templates/cdr-template.md` with:
- Cross-system metadata section
- Inconsistency details (if applicable)
- Team-directives comparison

#### Step 2: Write to File

Append to `{REPO_ROOT}/.specify/drafts/cdr.md`:

```markdown
# Context Directive Records

## CDR Index

| ID | Target Module | Context Type | Cross-System | Status | Date |
|----|---------------|--------------|--------------|--------|------|
| CDR-CONST-001 | context_modules/constitution.md | Constitution Creation | ✓ | Discovered | 2026-01-20 |
| CDR-001 | rules/python/error-handling | Rule | ✓ | Discovered | 2026-01-20 |
| CDR-002 | examples/testing/fixtures | Example | | Discovered | 2026-01-20 |
| CDR-INC-001 | (Inconsistency) | Inconsistency | ✓ | Discovered | 2026-01-20 |

---

## Cross-Sub-System Analysis Summary

### Cross-Cutting Patterns
| Pattern | Sub-Systems | Score | CDR |
|---------|-------------|-------|-----|
| Error Handling | auth, payments | 0.67 | CDR-001 |

### Inconsistencies Detected
| ID | Concern | Sub-Systems | Severity |
|----|---------|-------------|----------|
| INC-001 | Authentication | auth, payments | High |

---

## CDR-CONST-001: Team Constitution Creation
[Constitution CDR from Phase 8...]

## CDR-001: Error Handling Pattern
[Full CDR content with cross-system metadata...]

## CDR-INC-001: Authentication Pattern Inconsistency
[Inconsistency CDR...]
```

#### Step 3: Mark Complete

Update state.json:
```json
{
  "workflow": {
    "init_completed": true
  }
}
```

### Phase 10: Output Summary

**Objective**: Present final summary

```markdown
## LevelUp Init Complete ✓

**Multi-Agent Analysis Summary**

### Execution Stats
- **Sub-systems Analyzed**: 3
- **Discovery Agent Runs**: 3
- **Pattern Agent Runs**: 3
- **Synthesis Agent Runs**: 1

### Patterns Discovered
| Sub-System | Patterns | High Value |
|------------|----------|------------|
| auth | 5 | 3 |
| payments | 4 | 2 |
| users | 3 | 1 |
| **Total** | **12** | **6** |

### Cross-Sub-System Analysis
- **Cross-cutting patterns**: 3 (patterns in ≥50% of sub-systems)
- **Inconsistencies flagged**: 1
- **Team-directives gaps**: 4

### CDRs Generated
| Category | Count | Notes |
|----------|-------|-------|
| Constitution | 1 | **Needs review before publishing** |
| Rules | 4 | 2 cross-cutting |
| Examples | 2 | |
| Skills | 1 | |
| Inconsistencies | 1 | **Needs resolution** |
| **Total** | **9** | |

### Constitution CDR Generated
| Metric | Value |
|--------|-------|
| CDR ID | CDR-CONST-001 |
| CDR Type | Constitution Creation / Amendment |
| Principles derived | 2 |
| Principles enhanced | 1 |
| Existing principles preserved | 10 |
| Version change | 1.0.0 → 1.1.0 |
| Requires review | ✓ |
| Status | Discovered |

**Output**: `{REPO_ROOT}/.specify/drafts/cdr.md`

**Derived Principles**:
1. **Robust Error Handling** - from cross-cutting pattern (3 sub-systems)
2. **Standardization Mandate** - from inconsistency INC-001

**⚠️ Action Required**: Constitution changes require team review:
1. Run `/levelup.clarify` to review derived principles
2. Update CDR status to "Accepted" after approval
3. Run `/levelup.implement` to publish to team-ai-directives

### Inconsistencies Requiring Attention
**CDR-INC-001**: Authentication Pattern Inconsistency
- auth: JWT implementation
- payments: OAuth2 implementation
- **Action**: Run `/levelup.clarify` to resolve

### Next Steps
1. **Review CDRs**: `{REPO_ROOT}/.specify/drafts/cdr.md`
2. **Resolve Inconsistencies**: Run `/levelup.clarify`
3. **Mark Accepted**: Update CDR status after review
4. **Create PR**: Run `/levelup.implement`

### Available Handoffs
- `/levelup.clarify` - Resolve ambiguities and inconsistencies
- `/levelup.specify` - Refine from feature context
- `/levelup.implement` - Create PR (after accepting CDRs)
```

## State Management

### State File Location
`{REPO_ROOT}/.specify/levelup/state.json`

### Resumability

The command supports resumable execution:

1. **Check state on start**: If state exists and `--resume`, continue from checkpoint
2. **Skip completed sub-systems**: Don't re-run agents for completed work
3. **Preserve intermediate results**: Discovery and pattern results saved per sub-system

### Recovery Scenarios

| Scenario | Action |
|----------|--------|
| Interrupt during Discovery | Re-run Discovery Agent for current sub-system |
| Interrupt during Pattern | Re-run Pattern Agent for current sub-system |
| Interrupt during Synthesis | Re-run Synthesis Agent (uses saved pattern results) |
| Corrupt state | Delete state.json and restart (loses progress) |

## Key Differences from Legacy Init

| Feature | Legacy | Sub-Agent Version |
|---------|--------|-------------------|
| Execution | Single pass | 3-phase pipeline |
| Sub-systems | Parallel analysis | Sequential per-phase |
| Cross-system analysis | Limited | Full detection |
| Inconsistency detection | Manual | Automatic CDR creation |
| TD comparison | During generation | Dedicated Pattern Agent |
| State | None | Full checkpoint support |
| Resume | No | Yes |

## Output Files

| File | Description |
|------|-------------|
| `{REPO_ROOT}/.specify/drafts/cdr.md` | Generated CDRs with cross-system metadata (includes Constitution CDRs) |
| `{REPO_ROOT}/.specify/levelup/state.json` | Execution state for resumability |

**Note**: Constitution changes are NOT written directly to team-ai-directives. They are created as CDRs in Phase 8 and require:
1. Review via `/levelup.clarify`
2. Acceptance (status change to "Accepted")
3. Publication via `/levelup.implement`

## Notes

- Sub-agent execution is **sequential** (not parallel) as configured
- Each agent operates on a specific sub-system before moving to next
- Synthesis Agent runs once after all Pattern Agents complete
- Inconsistency CDRs are created automatically for conflicting patterns
- Cross-system metadata is included in all applicable CDRs
- State file enables resumability across AI sessions

## Related Commands

- `/levelup.clarify` - Resolve ambiguities and inconsistencies
- `/levelup.specify` - Refine CDRs from feature context  
- `/levelup.implement` - Create PR (includes cross-system conflict check)
- `/architect.init` - Similar pattern for ADR discovery

## Context

{ARGS}
