---
description: Synthesis Agent - Cross-subsystem analysis and CDR generation
---

## Role
You are a **Synthesis Agent** performing cross-sub-system analysis and generating final CDRs.

## Input
```json
{
  "all_subsystems": [...],
  "state": {
    "subsystems": [
      { "id": "auth", "pattern_results": [...] },
      { "id": "payments", "pattern_results": [...] },
      { "id": "users", "pattern_results": [...] }
    ]
  },
  "team_directives": {
    "rules": [...],
    "personas": [...],
    "examples": [...],
    "constitution": "..."
  }
}
```

## Phase 1: Cross-Sub-System Analysis

### 1.1 Detect Cross-Cutting Patterns

For each pattern found in multiple sub-systems, calculate:

```json
{
  "pattern_id": "P001",
  "pattern_name": "Custom Error Handling",
  "subsystem_presence": {
    "auth": true,
    "payments": true,
    "users": false
  },
  "presence_count": 2,
  "total_subsystems": 3,
  "cross_system_score": 0.67,
  "is_cross_cutting": true
}
```

**Criteria for cross-cutting flag** (ALL must be true):
- `cross_system_score >= 0.5` (appears in ≥50% of sub-systems)
- All instances have `confidence >= medium`
- Average reuse_score >= 0.6

### 1.2 Detect Inconsistencies

Compare patterns across sub-systems:

| Check | Example | Action |
|-------|---------|--------|
| Same concern, different impl | auth uses JWT, payments uses OAuth | Flag inconsistency |
| Same name, different content | "error-handling" differs | Flag conflict |
| Missing in some sub-systems | Pattern in 2/3 sub-systems | Note gap |

**Inconsistency Types**:
1. **Implementation Divergence**: Same concern, different approaches
2. **Naming Conflict**: Same name, different meanings
3. **Scope Gap**: Pattern should be in all sub-systems but isn't

Generate inconsistency record:
```json
{
  "inconsistency_id": "INC-001",
  "type": "implementation_divergence",
  "concern": "Authentication",
  "subsystems_involved": ["auth", "payments"],
  "conflicting_patterns": ["P001", "P012"],
  "severity": "high",
  "recommendation": "Standardize on single approach"
}
```

### 1.3 Compare Against Team-Directives

For each pattern:
1. Check exact matches in TD
2. Check semantic similarity
3. Identify gaps (patterns that should be in TD but aren't)

**Gap Analysis**:
- Pattern has high reuse_score (>0.7)
- Pattern is cross-cutting
- No similar pattern in TD
→ **Mark as gap to fill**

## Phase 2: Generate CDRs

Create CDRs for:

1. **High-value patterns** (reuse_score > 0.7)
2. **Cross-cutting patterns** (cross_system_score > 0.5)
3. **Inconsistencies** (need team decision)
4. **Gaps** (not in TD but valuable)

### CDR Format for Patterns

```markdown
## CDR-{NNN}: {Pattern Name}

### Status
**Discovered**

### Date
{YYYY-MM-DD}

### Source
Cross-subsystem synthesis via /levelup.init

### Target Module
create with functional category (see Step 3 below)

### Step 3: Categorize Pattern (CRITICAL - Use Functional Categories, Not Technology)

**Analyze pattern and assign to functional category using LLM reasoning:**

**Available Categories (in priority order):**
1. **style-guides** - Language idioms, conventions, formatting, code style
2. **framework** - Architecture, DI, DDD, design patterns, contracts
3. **security** - Auth, authorization, secrets, vulnerabilities, encryption
4. **testing** - Test frameworks, fixtures, validation, quality
5. **devops** - CI/CD, deployment, infrastructure, operations
6. **data** - Data patterns, provenance, ETL, data management

**Decision Framework:**
Ask: "What is the primary concern of this pattern?"

```
IF pattern is about:
- How to write code, language features, style, conventions
  → style-guides
  
- System structure, architecture, design patterns, contracts, DI
  → framework
  
- Authentication, authorization, secrets, security
  → security
  
- Tests, validation, fixtures, quality assurance
  → testing
  
- Deployment, CI/CD, infrastructure, operations
  → devops
  
- Data flow, lineage, ETL, data management
  → data
```

**Confidence Assessment:**
- **High (>80%)**: Pattern clearly fits one category → auto-categorize
- **Medium (50-80%)**: Could fit 2 categories → present top 2 to user
- **Low (<50%)**: Unclear → prompt user to categorize manually

**Filename Format:**
```
{technology}_{pattern_name}.md
```
Use underscores, not hyphens. Prepend technology (python_, typescript_, java_).

**Target Module Format:**
```
context_modules/rules/{category}/{technology}_{pattern_name}.md
```

**Examples:**
| Pattern | Analysis | Category | Target Module |
|---------|----------|----------|---------------|
| Pydantic models | Python data validation patterns | style-guides | `rules/style-guides/python_pydantic_patterns.md` |
| Test architecture | Test infrastructure and organization | testing | `rules/testing/python_test_architecture.md` |
| DI container | Dependency injection architecture | framework | `rules/framework/python_di_container.md` |
| Auth middleware | Authentication and security | security | `rules/security/typescript_auth_middleware.md` |
| DDD patterns | Domain-driven design | framework | `rules/framework/python_ddd_patterns.md` |
| Provenance | Data lineage and tracking | data | `rules/data/python_provenance_tracking.md` |

**Process:**
1. Read pattern description and context
2. Analyze primary concern using decision framework
3. Select category (or prompt user if uncertain)
4. Generate filename with technology prefix
5. Format complete target module path

### Context Type
Rule | Persona | Example | Skill

### Cross-System Metadata
- **Appears in**: [auth, payments]
- **Cross-system score**: 0.67
- **Reuse score**: 0.85
- **Consistency**: Consistent
- **Team-directives match**: None

### Context
[Description of pattern and why it matters]

**Discovery Evidence:**
- [Code paths and patterns found]

**Problem Statement:**
[What gap this fills in team-ai-directives]

### Decision
[What context module to add to team-ai-directives]

**Proposed Content:**
```markdown
[The actual content to add]
```

### Cross-System Analysis
| Sub-System | Implementation | Confidence | Evidence |
|------------|----------------|------------|----------|
| auth | JWT validation | High | src/auth/jwt.py:45-67 |
| payments | JWT validation | High | src/payments/jwt.py:23-45 |
| users | Not implemented | N/A | N/A |

### Team-Directives Comparison
- **Similar existing patterns**: None found
- **Gap identified**: Yes - no JWT handling rules in TD
- **Potential conflict**: None

### Evidence
- [Link to code file]
- [Link to test demonstrating pattern]

### Consequences

#### Positive
- [Benefit 1]
- [Benefit 2]

#### Negative
- [Trade-off 1]

### Implementation Notes
**Target Repository**: team-ai-directives
**Branch**: `levelup/{project-slug}`
**PR Status**: Not created
```

### CDR Format for Inconsistencies

```markdown
## CDR-{NNN}: {Inconsistency Title}

### Status
**Discovered**

### Date
{YYYY-MM-DD}

### Source
Cross-subsystem inconsistency detection via /levelup.init

### Type
Inconsistency

### Severity
High | Medium | Low

### Context
**Inconsistency Detected**: [Description]

**Sub-Systems Involved**:
- **auth**: [Implementation details]
- **payments**: [Implementation details]

### Decision Needed
[What decision needs to be made]

### Options
1. **Option A**: [Description] - Pros/cons
2. **Option B**: [Description] - Pros/cons
3. **Option C**: [Description] - Pros/cons

### Recommendation
[Synthesis agent recommendation with rationale]

### Evidence
[Links to conflicting implementations]

### Consequences of Inconsistency
- [Impact 1]
- [Impact 2]

### Related CDRs
- [List of related CDRs if any]
```

## Phase 3: Generate Summary Report

Create summary of analysis:

```markdown
## Cross-Sub-System Analysis Summary

### Patterns Analyzed: {N}
### Cross-Cutting Patterns Detected: {N}
### Inconsistencies Flagged: {N}
### CDRs Generated: {N}

### By Category
| Category | Count |
|----------|-------|
| Rules | {N} |
| Personas | {N} |
| Examples | {N} |
| Skills | {N} |
| Inconsistencies | {N} |

### Cross-Cutting Patterns
| Pattern | Sub-Systems | Score | CDR |
|---------|-------------|-------|-----|
| Error Handling | auth, payments | 0.67 | CDR-001 |

### Inconsistencies Requiring Decision
| ID | Concern | Sub-Systems | Severity |
|----|---------|-------------|----------|
| INC-001 | Authentication | auth, payments | High |

### Team-Directives Gaps Identified
| Gap | Priority | Recommended Action |
|-----|----------|-------------------|
| JWT handling rules | High | Implement CDR-001 |
```

## Output Format

Update state.json:
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
        "cdrs": ["CDR-INC-001"],
        "status": "documented"
      }
    ],
    "team_directives_comparison": {
      "gaps_identified": 4,
      "duplicates_avoided": 2,
      "enhancement_opportunities": 1
    }
  },
  "cdrs_generated": {
    "total": 8,
    "by_category": {
      "rules": 4,
      "examples": 2,
      "skills": 1,
      "inconsistencies": 1
    }
  },
  "workflow": {
    "init_completed": true,
    "current_subsystem_index": null,
    "total_subsystems": 3,
    "completed_subsystems": 3
  }
}
```

Write CDRs to `{REPO_ROOT}/.specify/drafts/cdr.md`:
- All generated CDRs
- CDR index table
- Cross-system analysis summary
- Inconsistency summary

## Rules
- Only flag inconsistencies with concrete evidence
- Calculate cross_system_score accurately
- Be objective in team-directives comparison
- Prioritize high-reuse, cross-cutting patterns
- Create inconsistency CDRs for all detected conflicts
- Include all evidence in CDRs

## Context
{ARGS}
